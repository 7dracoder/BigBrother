export function startupStep<T>(
  work: Promise<T>,
  signal: AbortSignal,
  label: string,
  timeoutMs = 15_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () =>
      finish(() =>
        reject(new DOMException("Microphone startup cancelled.", "AbortError")),
      );
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error(`${label} timed out. Cancel and try again.`)),
        ),
      timeoutMs,
    );
    const finish = (complete: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      complete();
    };
    work.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    if (signal.aborted) aborted();
    else signal.addEventListener("abort", aborted, { once: true });
  });
}
type Handlers = {
  onStatus?: (status: string) => void;
  onUtteranceStart?: (id: string) => void;
  onTranscript: (id: string, text: string) => void;
  onPartial: (text: string) => void;
  onLevel: (value: number) => void;
  onError: (message: string) => void;
};
export class AmbientMicrophone {
  private stream?: MediaStream;
  private peer?: RTCPeerConnection;
  private audio?: AudioContext;
  private frame = 0;
  private stopped = false;
  private controller = new AbortController();
  private partials = new Map<string, string>();
  private completed = new Set<string>();
  constructor(private handlers: Handlers) {}

  async start(sessionId: string): Promise<boolean> {
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Microphone access requires localhost or HTTPS and a supported browser.",
        );
      this.handlers.onStatus?.("Opening microphone");
      // Start both browser audio operations while the click still has user activation.
      const audio = (this.audio = new AudioContext());
      const capture = navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        .then((stream) => {
          if (this.stopped) stream.getTracks().forEach((track) => track.stop());
          else this.stream = stream;
          return stream;
        });
      const [stream] = await Promise.all([
        startupStep(
          capture,
          this.controller.signal,
          "Microphone permission/device access",
          20_000,
        ),
        startupStep(
          audio.resume(),
          this.controller.signal,
          "Browser audio activation",
          10_000,
        ),
      ]);
      if (this.stopped) return false;
      const analyser = audio.createAnalyser();
      analyser.fftSize = 256;
      audio.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (this.stopped) return false;
        analyser.getByteFrequencyData(samples);
        this.handlers.onLevel(
          samples.reduce((a, b) => a + b, 0) / samples.length / 128,
        );
        this.frame = requestAnimationFrame(tick);
      };
      tick();
      this.handlers.onStatus?.("Starting transcription service");
      const tokenResponse = await startupStep(
        fetch("/api/realtime", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
          signal: this.controller.signal,
        }),
        this.controller.signal,
        "Transcription service connection",
        20_000,
      );
      const token = await startupStep(
        tokenResponse.json(),
        this.controller.signal,
        "Transcription session response",
      );
      if (!tokenResponse.ok)
        throw new Error(token.error || "Could not start transcription.");
      if (this.stopped) return false;
      const peer = (this.peer = new RTCPeerConnection());
      for (const track of stream.getTracks()) peer.addTrack(track, stream);
      peer.onconnectionstatechange = () => {
        if (
          !this.stopped &&
          ["failed", "disconnected"].includes(peer.connectionState)
        ) {
          this.stop();
          this.handlers.onError(
            "Microphone connection lost. Start listening again to reconnect.",
          );
        }
      };
      const channel = peer.createDataChannel("oai-events");
      channel.onmessage = ({ data }) => {
        if (this.stopped) return false;
        try {
          const event = JSON.parse(data);
          if (
            event.type === "conversation.item.input_audio_transcription.delta"
          ) {
            if (!this.partials.has(event.item_id))
              this.handlers.onUtteranceStart?.(event.item_id);
            this.partials.set(
              event.item_id,
              (this.partials.get(event.item_id) || "") + event.delta,
            );
            this.handlers.onPartial([...this.partials.values()].join(" "));
          }
          if (
            event.type ===
            "conversation.item.input_audio_transcription.completed"
          ) {
            this.partials.delete(event.item_id);
            this.handlers.onPartial([...this.partials.values()].join(" "));
            if (
              !this.completed.has(event.item_id) &&
              event.transcript?.trim()
            ) {
              this.completed.add(event.item_id);
              this.handlers.onTranscript(
                event.item_id,
                event.transcript.trim(),
              );
            }
          }
          if (
            event.type === "error" ||
            event.type === "conversation.item.input_audio_transcription.failed"
          ) {
            this.stop();
            this.handlers.onError(
              "Transcription failed. Check the connection and try again.",
            );
          }
        } catch {
          /* Ignore malformed non-transcript events. */
        }
      };
      this.handlers.onStatus?.("Connecting live audio");
      const offer = await startupStep(
        peer.createOffer(),
        this.controller.signal,
        "Audio offer",
      );
      await startupStep(
        peer.setLocalDescription(offer),
        this.controller.signal,
        "Local audio setup",
      );
      const response = await startupStep(
        fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${token.value}`,
            "Content-Type": "application/sdp",
          },
          signal: this.controller.signal,
        }),
        this.controller.signal,
        "OpenAI audio connection",
        20_000,
      );
      if (!response.ok)
        throw new Error(
          `The audio connection failed (${response.status}). Try again.`,
        );
      if (this.stopped) return false;
      const answer = await startupStep(
        response.text(),
        this.controller.signal,
        "Audio connection response",
      );
      await startupStep(
        peer.setRemoteDescription({ type: "answer", sdp: answer }),
        this.controller.signal,
        "Remote audio setup",
      );
      this.handlers.onStatus?.("Finishing audio connection");
      await startupStep(
        new Promise<void>((resolve) => {
          if (channel.readyState === "open") resolve();
          else channel.onopen = () => resolve();
        }),
        this.controller.signal,
        "Live audio channel",
      );
      return !this.stopped;
    } catch (e) {
      if (this.stopped) return false;
      this.stop();
      if (e instanceof DOMException && e.name === "NotAllowedError")
        throw new Error(
          "Microphone access was blocked. Allow microphone access for this page in your browser and macOS settings, then try again.",
        );
      if (e instanceof DOMException && e.name === "NotFoundError")
        throw new Error(
          "No microphone was found. Connect or select a microphone and try again.",
        );
      throw e;
    }
  }
  stop() {
    this.stopped = true;
    this.controller.abort();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.peer?.close();
    void this.audio?.close().catch(() => {});
    cancelAnimationFrame(this.frame);
    this.handlers.onLevel(0);
    this.handlers.onPartial("");
  }
}
