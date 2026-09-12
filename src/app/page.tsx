"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  AudioLines,
  Brain,
  Check,
  CircleHelp,
  Clock3,
  LoaderCircle,
  Mic,
  MicOff,
  Play,
  Radio,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { AmbientMicrophone } from "@/lib/realtime";
import { ProposalCard, type ApprovalEdits } from "@/components/proposal-card";
import type { Configuration, Mode, Snapshot, Transcript } from "@/lib/types";

const empty: Snapshot = { transcripts: [], proposals: [], activities: [] };
const sample = [
  {
    speaker: "Tan",
    text: "It’s been a busy week. We should catch up away from our screens.",
  },
  { speaker: "You", text: "Yeah Tan, let's grab lunch Thursday at 12:30." },
  {
    speaker: "Tan",
    text: "Perfect. There’s a little place around the corner I’ve been wanting to try.",
  },
];
async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(
    path,
    data
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : { cache: "no-store" },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}
function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Home() {
  const [clearing, setClearing] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [mode, setMode] = useState<Mode>("live");
  const [data, setData] = useState<Snapshot>(empty);
  const [config, setConfig] = useState<Configuration>({
    transcription: false,
    detection: false,
    calendar: false,
  });
  const [recording, setRecording] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionStage, setConnectionStage] = useState(
    "Connecting microphone",
  );
  const [demoRunning, setDemoRunning] = useState(false);
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState("");
  const [pendingUtterances, setPendingUtterances] = useState(0);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [targetId, setTargetId] = useState<string>();
  const [manualReview, setManualReview] = useState(false);
  const [featuredId, setFeaturedId] = useState<string>();
  type VoiceContext = {
    review?: { id: string; version: number };
    targetId?: string;
    previousRequest?: string;
  };
  const voiceContext = useRef<VoiceContext>({});
  const utteranceContext = useRef(new Map<string, VoiceContext>());
  const dataRef = useRef(data);
  const captureEpoch = useRef(0);
  const [question, setQuestion] = useState("");
  const [recalling, setRecalling] = useState(false);
  const [recall, setRecall] = useState<{
    kind: string;
    proposalId?: string;
    request: string;
    answer: string;
    sources: Transcript[];
  } | null>(null);
  const [manual, setManual] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const mic = useRef<AmbientMicrophone | null>(null);
  const queue = useRef(Promise.resolve());
  const demoGeneration = useRef(0);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const currentMode = useRef<Mode>("live");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    let id = localStorage.getItem("bigbrother.session.v1");
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem("bigbrother.session.v1", id);
    }
    setSessionId(id);
    api<Configuration>("/api/config")
      .then(setConfig)
      .catch((e) => setError(e.message));
    return () => {
      mic.current?.stop();
      mic.current = null;
      demoGeneration.current++;
    };
  }, []);
  const refresh = useCallback(
    async (selectedMode = mode) => {
      if (!sessionId) return;
      const next = await api<Snapshot & { cleared?: boolean }>(
        `/api/session?sessionId=${sessionId}&mode=${selectedMode}`,
      );
      if (next.cleared) {
        mic.current?.stop();
        mic.current = null;
        localStorage.setItem("bigbrother.session.v1", crypto.randomUUID());
        window.location.reload();
        return;
      }
      if (currentMode.current === selectedMode) setData(next);
    },
    [mode, sessionId],
  );
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    if (!pendingUtterances) return;
    // The server persists before model inference. Show saved words while inference runs.
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [pendingUtterances, refresh]);
  useEffect(() => {
    const scroller = transcriptEnd.current?.parentElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [data.transcripts, partial]);
  useEffect(() => {
    if (!recording && !demoRunning) return;
    const timer = setInterval(() => setElapsed((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [recording, demoRunning]);
  useEffect(() => {
    if (!demoRunning) return;
    const timer = setInterval(() => setLevel(0.15 + Math.random() * 0.45), 120);
    return () => {
      clearInterval(timer);
      setLevel(0);
    };
  }, [demoRunning]);
  function stop() {
    captureEpoch.current++;
    utteranceContext.current.clear();
    mic.current?.stop();
    mic.current = null;
    setRecording(false);
    setConnecting(false);
    setPartial("");
    setLevel(0);
    demoGeneration.current++;
    setDemoRunning(false);
  }
  async function clearHistory() {
    stop();
    setClearing(true);
    setError("");
    try {
      const result = await api<{ sessionId: string }>("/api/session", {
        sessionId,
        action: "clear",
      });
      localStorage.setItem("bigbrother.session.v1", result.sessionId);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t clear history.");
      setClearing(false);
    }
  }
  function switchMode(next: Mode) {
    stop();
    currentMode.current = next;
    setMode(next);
    setData(empty);
    setRecall(null);
    setTargetId(undefined);
    setFeaturedId(undefined);
    setError("");
    setElapsed(0);
  }
  function ingest(
    id: string,
    text: string,
    selectedMode: Mode,
    speaker = "Conversation",
    context?: VoiceContext,
  ) {
    const timestamp = new Date().toISOString();
    const epoch = captureEpoch.current;
    setPendingUtterances((n) => n + 1);
    queue.current = queue.current.then(async () => {
      try {
        const next = await api<
          Snapshot & {
            assistant?: {
              kind: string;
              answer: string;
              sources: Transcript[];
              proposalId?: string;
            };
          }
        >("/api/transcript", {
          id,
          text,
          speaker,
          sessionId,
          mode: selectedMode,
          timezone,
          timestamp,
          assistant: speaker === "Conversation" || speaker === "You (typed)",
          ...context,
          review: epoch === captureEpoch.current ? context?.review : undefined,
        });
        if (currentMode.current === selectedMode) {
          const changed = next.proposals
            .filter(
              (p) =>
                p.status === "pending" &&
                !dataRef.current.proposals.some(
                  (old) =>
                    old.id === p.id && (old.version ?? 0) === (p.version ?? 0),
                ),
            )
            .at(-1);
          setData(next);
          dataRef.current = next;
          if (changed) reveal(changed.id);
          if (next.assistant)
            setRecall({
              ...next.assistant,
              request: context?.previousRequest
                ? `${context.previousRequest}. ${text}`.slice(-2000)
                : text,
            });
        }
      } catch (e) {
        setError(
          `${e instanceof Error ? e.message : "Couldn’t save transcript."} Unsaved utterance: “${text}”`,
        );
      } finally {
        setPendingUtterances((n) => n - 1);
      }
    });
    return queue.current;
  }
  async function listen() {
    if (mic.current) return;
    if (!config.transcription) {
      setError(
        "Add OPENAI_API_KEY to .env.local to enable live transcription, then refresh this page. You can try the demo now.",
      );
      return;
    }
    setError("");
    setConnecting(true);
    setConnectionStage("Opening microphone");
    const audio = new AmbientMicrophone({
      onStatus: (status) => {
        if (mic.current === audio) setConnectionStage(status);
      },
      onLevel: setLevel,
      onPartial: setPartial,
      onUtteranceStart: (id) => {
        utteranceContext.current.set(id, { ...voiceContext.current });
      },
      onTranscript: (id, text) => {
        const context = utteranceContext.current.get(id) ?? {
          targetId: voiceContext.current.targetId,
          previousRequest: voiceContext.current.previousRequest,
        };
        utteranceContext.current.delete(id);
        void ingest(id, text, "live", "Conversation", context);
      },
      onError: (message) => {
        if (mic.current !== audio) return;
        setError(message);
        setRecording(false);
        setConnecting(false);
        mic.current = null;
      },
    });
    mic.current = audio;
    try {
      const ready = await audio.start(sessionId);
      if (ready && mic.current === audio) {
        setRecording(true);
        setElapsed(0);
      }
    } catch (e) {
      if (mic.current === audio) {
        setError(
          e instanceof Error ? e.message : "Couldn’t access the microphone.",
        );
        mic.current = null;
        setRecording(false);
        setConnecting(false);
      }
    } finally {
      if (mic.current === audio) setConnecting(false);
    }
  }

  async function runDemo() {
    stop();
    currentMode.current = "demo";
    setMode("demo");
    setData(empty);
    setFeaturedId(undefined);
    setTargetId(undefined);
    setRecall(null);
    setError("");
    setElapsed(0);
    setDemoRunning(true);
    const generation = demoGeneration.current;
    const runId = crypto.randomUUID();
    for (let i = 0; i < sample.length; i++) {
      if (generation !== demoGeneration.current) break;
      const utterance = sample[i];
      setPartial(utterance.text);
      await new Promise((resolve) => setTimeout(resolve, 1700));
      if (generation !== demoGeneration.current) break;
      setPartial("");
      await ingest(`${runId}-${i}`, utterance.text, "demo", utterance.speaker);
    }
    if (generation === demoGeneration.current) {
      setDemoRunning(false);
      setPartial("");
    }
  }
  async function act(
    id: string,
    action: "approve" | "dismiss" | "delete",
    edits: ApprovalEdits,
  ) {
    setBusyId(id);
    setError("");
    try {
      await api("/api/proposals", {
        sessionId,
        mode,
        id,
        action,
        version: data.proposals.find((p) => p.id === id)?.version ?? 0,
        ...edits,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t update proposal.");
      await refresh().catch(() => {});
    } finally {
      setBusyId("");
    }
  }
  async function ask(value = question) {
    if (!value.trim() || recalling) return;
    setQuestion(value);
    setRecalling(true);
    setError("");
    try {
      const response = await api<{
        kind: string;
        answer: string;
        sources: Transcript[];
        proposalId?: string;
      }>("/api/assist", {
        sessionId,
        mode,
        text: value,
        timezone,
        targetId,
        review: voiceContext.current.review,
        ...(recall?.kind === "clarify"
          ? { previousRequest: recall.request }
          : {}),
      });
      setRecall({
        ...response,
        request:
          recall?.kind === "clarify"
            ? `${recall.request}. ${value}`.slice(-2000)
            : value,
      });
      setQuestion("");
      await refresh();
      if (response.proposalId) reveal(response.proposalId);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn’t recall this conversation.",
      );
    } finally {
      setRecalling(false);
    }
  }
  function reveal(id: string) {
    setFeaturedId(id);
    setTargetId(id);
    requestAnimationFrame(() =>
      document
        .getElementById("current-action")
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }
  function editWithAssistant(id: string) {
    reveal(id);
    setTargetId(id);
    setRecall(null);
    setQuestion("");
    document
      .getElementById("assistant-desk")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("assistant-input")?.focus({ preventScroll: true });
  }
  const featured = data.proposals.find(
    (p) => p.id === featuredId && !["dismissed", "applied"].includes(p.status),
  );
  useEffect(() => {
    dataRef.current = data;
    voiceContext.current = {
      targetId,
      review:
        featured &&
        ["pending", "approved"].includes(featured.status) &&
        !manualReview
          ? { id: featured.id, version: featured.version ?? 0 }
          : undefined,
      previousRequest: recall?.kind === "clarify" ? recall.request : undefined,
    };
  }, [data, featured, targetId, recall, manualReview]);
  const assistantProposal = data.proposals.find(
    (p) => p.id === recall?.proposalId,
  );
  const pending = data.proposals.filter((p) => p.status === "pending");
  const approved = data.proposals.filter((p) => p.status === "approved");
  const active = recording || demoRunning;
  const duration = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="BigBrother home">
          <span className="brand-eye">
            <span />
          </span>
          bigbrother<span className="brand-period">.</span>
        </a>
        <div className="topbar-right">
          <span className="edition">YOUR AMBIENT COMPANION</span>
          <span className="version">MVP / 001</span>
        </div>
      </header>
      <main>
        <section className="hero">
          <div>
            <div className="eyebrow">
              <span className="tiny-dot" /> LESS NOTE-TAKING. MORE LIVING.
            </div>
            <h1>
              Be here.
              <br />
              <span>We’ll remember.</span>
            </h1>
            <p>
              The little things you say become things you get done.
              <br />
              An extra pair of ears. Always your call.
            </p>
          </div>
          <div className="hero-note">
            <ShieldCheck size={18} />
            <p>
              Present in the conversation.
              <br />
              <strong>You stay in control.</strong>
            </p>
          </div>
        </section>
        <div className="voice-workspace">
          <section
            className={`listening-panel ${active ? "active" : ""}`}
            aria-label="Recording controls"
          >
            <div className="listening-main">
              <div className={`mic-orb ${active ? "active" : ""}`}>
                {active ? <AudioLines size={25} /> : <MicOff size={23} />}
              </div>
              <div>
                <div className="listening-label">
                  <span className={`record-dot ${active ? "on" : ""}`} />
                  {connecting
                    ? connectionStage
                    : recording
                      ? "Listening to your world"
                      : demoRunning
                        ? "Playing a sample conversation"
                        : "A little quiet right now"}
                </div>
                <p>
                  {recording
                    ? "Recording is on. Only complete utterances become memories."
                    : demoRunning
                      ? "Simulated transcript · your microphone is off"
                      : "Start listening when everyone’s ready."}
                </p>
              </div>
            </div>
            <div
              className="waveform"
              aria-label={
                recording
                  ? "Live microphone waveform"
                  : demoRunning
                    ? "Simulated demo waveform"
                    : "Microphone off"
              }
            >
              {Array.from({ length: 46 }, (_, i) => (
                <span
                  key={i}
                  style={{
                    height: `${4 + (active ? level * (16 + Math.sin(i * 1.9) * 12 + Math.cos(i * 0.7) * 10) * 2.4 : 2 + Math.sin(i * 1.9) * 2)}px`,
                    opacity: active ? 0.45 + (i % 5) / 10 : 0.2 + (i % 4) / 12,
                  }}
                />
              ))}
            </div>
            <div className="listen-actions">
              {active && <span className="duration">{duration}</span>}
              {recording || connecting || demoRunning ? (
                <button className="mute-button" onClick={stop}>
                  <MicOff size={16} />
                  {connecting
                    ? "Cancel"
                    : demoRunning
                      ? "Stop demo"
                      : "Hard mute"}
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={!sessionId}
                  onClick={() => (mode === "demo" ? runDemo() : listen())}
                >
                  {mode === "demo" ? <Play size={15} /> : <Mic size={16} />}
                  {mode === "demo" ? "Play demo" : "Start listening"}
                </button>
              )}
            </div>
          </section>
          <div className="under-listening">
            <span>
              <ShieldCheck size={12} />
              Nothing sends without your approval. Hard mute stops the
              microphone.
            </span>
            <button
              onClick={runDemo}
              disabled={
                active || connecting || pendingUtterances > 0 || !sessionId
              }
            >
              <Play size={11} />
              Try a 10-second demo <ArrowRight size={12} />
            </button>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <CircleHelp size={17} />
              <span>{error}</span>
              <button
                aria-label="Dismiss error"
                className="icon-button"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <section
            id="assistant-desk"
            className="recall-panel panel assistant-desk"
          >
            <div className="panel-heading">
              <h2>
                <Brain size={17} />A thought away.
              </h2>
              <span className="subtle-badge">ASK · REMEMBER · PLAN</span>
            </div>
            <p className="recall-intro">
              Recall something now, plan a reminder for later, or change a plan.
            </p>
            {targetId && (
              <div className="assistant-context">
                Current action:{" "}
                {data.proposals.find((p) => p.id === targetId)?.title}
                <button
                  className="icon-button"
                  aria-label="Clear selected plan"
                  onClick={() => {
                    setTargetId(undefined);
                    setFeaturedId(undefined);
                    setRecall(null);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <form
              className="recall-input"
              onSubmit={(e) => {
                e.preventDefault();
                void ask();
              }}
            >
              <input
                id="assistant-input"
                aria-label="Ask about your conversation or plans"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                  recall?.kind === "clarify"
                    ? "Your answer…"
                    : "Remind me what Tan said…"
                }
                maxLength={2000}
              />
              <button
                aria-label="Ask assistant"
                disabled={recalling || !question.trim() || !sessionId}
              >
                {recalling ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <ArrowRight size={17} />
                )}
              </button>
            </form>
            <small className="assistant-hint">
              {mode === "demo"
                ? "Demo: typed examples only. No microphone or calendar access."
                : recording
                  ? "One microphone: ask a question, make a plan, or say ‘approve it’ for a proposal or ‘delete it’ for the selected calendar event."
                  : "Start listening once to capture conversation, ask questions, and approve actions by voice."}
            </small>
            <button
              className="suggested-question"
              onClick={() => ask("What did I agree to in this conversation?")}
              disabled={recalling || !sessionId}
            >
              What did I agree to? <ArrowRight size={11} />
            </button>
            {recording && partial && (
              <p className="voice-status" role="status">
                {partial}
              </p>
            )}
            {pendingUtterances > 0 && (
              <p className="assistant-hint" role="status">
                Processing your words… Keep talking.
              </p>
            )}
            {recall && (
              <div className="recall-answer" aria-live="polite">
                <small>
                  {recall.kind === "clarify"
                    ? "QUICK QUESTION"
                    : recall.kind === "proposal"
                      ? assistantProposal &&
                        assistantProposal.status !== "pending"
                        ? assistantProposal.status.toUpperCase()
                        : "READY TO REVIEW"
                      : recall.kind === "action"
                        ? "ACTION RESULT"
                        : recall.kind === "error"
                          ? "COULDN’T COMPLETE"
                          : "FROM YOUR MEMORY"}
                </small>
                <p>
                  {assistantProposal &&
                  [
                    "approved",
                    "applied",
                    "dismissed",
                    "uncertain",
                    "deleted",
                  ].includes(assistantProposal.status)
                    ? assistantProposal.result || "Proposal dismissed."
                    : recall.answer}
                </p>
                {recall.proposalId && (
                  <a
                    className="assistant-review"
                    href={`#proposal-${assistantProposal?.status === "applied" ? assistantProposal.targetProposalId : recall.proposalId}`}
                  >
                    Review{" "}
                    {
                      data.proposals.find((p) => p.id === recall.proposalId)
                        ?.title
                    }{" "}
                    <ArrowRight size={14} />
                  </a>
                )}
                <button
                  className="icon-button"
                  aria-label="Clear assistant response"
                  onClick={() => {
                    setRecall(null);
                    setTargetId(undefined);
                  }}
                >
                  <X size={14} />
                </button>
                {recall.sources.map((source) => (
                  <a
                    key={source.id}
                    className="source"
                    href={`#memory-${source.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document
                        .querySelector(`[data-memory-id="${source.id}"]`)
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                    }}
                  >
                    <Clock3 size={11} />
                    {time(source.timestamp)}
                    <span>“{source.text}”</span>
                  </a>
                ))}
              </div>
            )}
            {featured && (
              <div
                id="current-action"
                className="current-action"
                aria-label="Current action"
              >
                <p className="assistant-hint">
                  {manualReview
                    ? "Use the approval button to include your manual edits."
                    : featured.status === "pending"
                      ? "Review this action, then say ‘approve it’ or use the button."
                      : "Action result"}
                </p>
                <ProposalCard
                  key={`${featured.id}:${featured.version ?? 0}`}
                  proposal={featured}
                  onEditingChange={setManualReview}
                  busy={!!busyId || recalling}
                  onEdit={() => editWithAssistant(featured.id)}
                  onAction={(action, edits) => act(featured.id, action, edits)}
                />
              </div>
            )}
          </section>
        </div>
        <div className="workspace-toolbar">
          <div className="workspace-heading">
            <span className="tiny-dot" />
            Your conversation{" "}
            <span className="workspace-date">
              {sessionId
                ? new Date().toLocaleDateString([], {
                    month: "short",
                    day: "numeric",
                  })
                : "Today"}
            </span>
          </div>
          <button
            className="edit-toggle"
            disabled={clearing || !!busyId || !sessionId}
            onClick={() => void clearHistory()}
            title="Clear this browser’s live and demo history. Calendar events stay in your calendar."
          >
            {clearing ? "Clearing…" : "Clear history"}
          </button>
          <div className="mode-switch" aria-label="Conversation mode">
            <button
              className={mode === "live" ? "selected" : ""}
              disabled={pendingUtterances > 0 || !!busyId || recalling}
              onClick={() => switchMode("live")}
            >
              <Radio size={12} />
              Live
            </button>
            <button
              className={mode === "demo" ? "selected" : ""}
              disabled={pendingUtterances > 0 || !!busyId || recalling}
              onClick={() => switchMode("demo")}
            >
              <Play size={11} />
              Demo
            </button>
          </div>
        </div>
        {mode === "demo" && (
          <div className="demo-banner">
            DEMO MODE{" "}
            <span>
              Sample conversation. Simulated approvals. No microphone or
              external actions.
            </span>
          </div>
        )}
        <div className="workspace-grid">
          <div className="left-column">
            <section className="transcript-panel panel">
              <div className="panel-heading">
                <h2>
                  <AudioLines size={16} />
                  Live transcript
                </h2>
                <span className="subtle-badge">
                  {data.transcripts.length} moments
                </span>
              </div>
              <div
                className="transcript-scroll"
                role="log"
                aria-label="Conversation transcript"
                aria-live="polite"
              >
                {data.transcripts.length === 0 && !partial && (
                  <div className="empty-transcript">
                    <div className="empty-lines">
                      <span />
                      <span />
                      <span />
                    </div>
                    <h3>Room for a real conversation.</h3>
                    <p>
                      Your words will appear here as you speak.
                      <br />
                      No wake words. No interruptions.
                    </p>
                  </div>
                )}
                {data.transcripts.map((t) => (
                  <div
                    className={`utterance ${t.detected ? "detected" : ""}`}
                    key={t.id}
                    data-memory-id={t.id}
                  >
                    <div className="utterance-meta">
                      <span
                        className={`avatar ${t.speaker === "Tan" ? "tan" : ""}`}
                      >
                        {t.speaker === "Conversation" ? (
                          <Mic size={11} />
                        ) : (
                          t.speaker.slice(0, 1)
                        )}
                      </span>
                      <strong>{t.speaker}</strong>
                      <time>{time(t.timestamp)}</time>
                      {t.detected && (
                        <span className="caught">
                          <Sparkles size={10} />
                          Caught a commitment
                        </span>
                      )}
                    </div>
                    <p>{t.text}</p>
                  </div>
                ))}
                {partial && (
                  <div className="utterance partial">
                    <div className="utterance-meta">
                      <span className="avatar">
                        <AudioLines size={12} />
                      </span>
                      <strong>
                        {demoRunning ? "Sample conversation" : "Hearing you"}
                      </strong>
                      <span className="typing-dots">•••</span>
                    </div>
                    <p>
                      {partial}
                      <span className="cursor" />
                    </p>
                  </div>
                )}
                <div ref={transcriptEnd} />
              </div>
              <div className="transcript-footer">
                <span className="tiny-dot" />
                {pendingUtterances > 0 ? (
                  <>
                    <LoaderCircle className="spin" size={12} />
                    Saving & finding commitments…
                  </>
                ) : (
                  "Every saved moment is a memory you can come back to."
                )}
                <ArrowDown size={12} />
              </div>
            </section>
          </div>
          <section className="proposals-panel">
            <div className="panel-heading">
              <h2>
                <Sparkles size={17} />A little ahead of you
              </h2>
              <span className="count">{pending.length}</span>
            </div>
            <p className="proposals-intro">
              Caught in conversation. Ready when you are.
            </p>
            {data.proposals.filter(
              (p) =>
                p.status !== "dismissed" &&
                p.status !== "applied" &&
                p.id !== featured?.id,
            ).length === 0 && (
              <div className="empty-proposals">
                <div className="sparkle-orbit">
                  <Sparkles size={24} />
                  <span />
                </div>
                <h3>
                  Good things start with
                  <br />
                  “we should…”
                </h3>
                <p>
                  When a plan comes up, we’ll get the details
                  <br />
                  ready. You decide what happens next.
                </p>
                <div className="example-quote">
                  “Let’s grab lunch Thursday.”
                </div>
                <span className="example-arrow">↓</span>
                <div className="example-result">
                  <CalendarDaysIcon />A calendar hold, ready to approve
                </div>
              </div>
            )}
            <div className="proposal-list">
              {data.proposals
                .filter(
                  (p) =>
                    p.status !== "dismissed" &&
                    p.status !== "applied" &&
                    p.id !== featured?.id,
                )
                .sort(
                  (a, b) =>
                    Number(b.status === "pending") -
                    Number(a.status === "pending"),
                )
                .map((p) => (
                  <ProposalCard
                    key={`${p.id}:${p.version ?? 0}`}
                    onEdit={() => editWithAssistant(p.id)}
                    onReview={() => reveal(p.id)}
                    proposal={p}
                    busy={!!busyId || recalling}
                    onAction={(action, edits) => act(p.id, action, edits)}
                  />
                ))}
            </div>
            <div className="approval-promise">
              <ShieldCheck size={14} />
              <span>Proposed by BigBrother. Decided by you.</span>
            </div>
          </section>
        </div>
        <section className="activity-panel">
          <div className="activity-title">
            <Terminal size={13} />
            <span>BEHIND THE SCENES</span>
            <span className="activity-count">
              {approved.length}{" "}
              {mode === "demo" ? "demo approvals" : "holds created"}
            </span>
          </div>
          <div className="activity-list">
            {data.activities.length === 0 ? (
              <span className="activity-idle">
                Ready to listen. Nothing has been recorded.
              </span>
            ) : (
              data.activities
                .slice(-4)
                .reverse()
                .map((a) => (
                  <div key={a.id} className={`activity ${a.kind}`}>
                    <time>{time(a.timestamp)}</time>
                    {a.kind === "success" ? (
                      <Check size={12} />
                    ) : (
                      <span className="tiny-dot" />
                    )}
                    <span>{a.text}</span>
                  </div>
                ))
            )}
          </div>
        </section>
        <details className="developer-tools">
          <summary>Test with a typed utterance</summary>
          <p>
            Simulates a completed microphone utterance through the shared
            conversation, request, and approval flow.{" "}
            {mode === "demo"
              ? "Demo supports the sample lunch, recall, dated reminders, edits, and “approve it”."
              : "Live detection requires OpenRouter."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (manual.trim()) {
                void ingest(
                  crypto.randomUUID(),
                  manual.trim(),
                  mode,
                  "You (typed)",
                  { ...voiceContext.current },
                );
                setManual("");
              }
            }}
          >
            <input
              aria-label="Test utterance"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              maxLength={6000}
              placeholder="Yeah Tan, let’s grab lunch Thursday at 12:30."
            />
            <button
              className="secondary"
              disabled={!manual.trim() || pendingUtterances > 0 || !sessionId}
            >
              Add utterance
              <ArrowRight size={13} />
            </button>
          </form>
        </details>
        <footer>
          <span className="footer-brand">
            A little presence. A lot less on your mind.
          </span>
          <div className="connections">
            <span className={config.transcription ? "connected" : ""}>
              <span className="tiny-dot" />
              Microphone {config.transcription ? "configured" : "needs key"}
            </span>
            <span className={config.detection ? "connected" : ""}>
              <span className="tiny-dot" />
              Agent {config.detection ? "configured" : "needs key"}
            </span>
            <span className={config.calendar ? "connected" : ""}>
              <span className="tiny-dot" />
              Calendar {config.calendar ? "configured" : "not connected"}
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
function CalendarDaysIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4m8-4v4" />
    </svg>
  );
}
