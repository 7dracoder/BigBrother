import test from "node:test";
import assert from "node:assert/strict";
import { AmbientMicrophone, startupStep } from "../src/lib/realtime";
test("startup steps time out, abort promptly, and preserve successful results", async () => {
  const controller = new AbortController();
  const never = new Promise<void>(() => {});
  await assert.rejects(
    startupStep(never, controller.signal, "Audio activation", 5),
    /Audio activation timed out/,
  );
  const pending = startupStep(never, controller.signal, "Permission");
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(
    startupStep(never, controller.signal, "Already cancelled"),
    { name: "AbortError" },
  );
  assert.equal(
    await startupStep(
      Promise.resolve(42),
      new AbortController().signal,
      "Ready",
    ),
    42,
  );
});
test("cancelling pending permission finishes immediately and stops a late microphone stream", async (t) => {
  let resolveCapture!: (value: MediaStream) => void;
  let tracksStopped = 0;
  const replace = (name: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
  };
  replace("navigator", {
    mediaDevices: {
      getUserMedia: () =>
        new Promise((resolve) => {
          resolveCapture = resolve;
        }),
    },
  });
  replace(
    "AudioContext",
    class {
      resume() {
        return new Promise<void>(() => {});
      }
      close() {
        return Promise.resolve();
      }
    },
  );
  replace("cancelAnimationFrame", () => {});
  const mic = new AmbientMicrophone({
    onTranscript: () => {},
    onPartial: () => {},
    onLevel: () => {},
    onError: () => {},
  });
  const starting = mic.start("test");
  mic.stop();
  assert.equal(await starting, false);
  resolveCapture({
    getTracks: () => [{ stop: () => tracksStopped++ }],
  } as unknown as MediaStream);
  await Promise.resolve();
  assert.equal(tracksStopped, 1);
});
test("startup reaches ready only after the audio channel is open and mute closes resources", async (t) => {
  const replace = (name: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
  };
  let tracksStopped = 0,
    closed = 0;
  const stages: string[] = [];
  replace("navigator", {
    mediaDevices: {
      getUserMedia: async () => ({
        getTracks: () => [{ stop: () => tracksStopped++ }],
      }),
    },
  });
  replace(
    "AudioContext",
    class {
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
      createAnalyser() {
        return {
          fftSize: 0,
          frequencyBinCount: 1,
          getByteFrequencyData: () => {},
        };
      }
      createMediaStreamSource() {
        return { connect: () => {} };
      }
    },
  );
  replace("requestAnimationFrame", () => 0);
  replace("cancelAnimationFrame", () => {});
  replace(
    "RTCPeerConnection",
    class {
      channel = { readyState: "connecting" };
      addTrack() {}
      createDataChannel() {
        return this.channel;
      }
      async createOffer() {
        return { sdp: "offer" };
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.channel.readyState = "open";
      }
      close() {
        closed++;
      }
    },
  );
  replace("fetch", async (url: string) =>
    url === "/api/realtime"
      ? Response.json({ value: "test-only-token" })
      : new Response("answer"),
  );
  const mic = new AmbientMicrophone({
    onStatus: (s) => stages.push(s),
    onTranscript: () => {},
    onPartial: () => {},
    onLevel: () => {},
    onError: () => {},
  });
  assert.equal(await mic.start("test"), true);
  assert.equal(stages.at(-1), "Finishing audio connection");
  mic.stop();
  assert.equal(tracksStopped, 1);
  assert.equal(closed, 1);
});
