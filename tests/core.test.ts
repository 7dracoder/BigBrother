import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveTime } from "../src/lib/detection";
import { calendarArguments } from "../src/lib/calendar";
import { sameOrigin } from "../src/lib/http";
import {
  claimProposal,
  clearSession,
  sessionCleared,
  dismissProposal,
  getProposal,
  save,
  snapshot,
} from "../src/lib/store";
import type { Proposal } from "../src/lib/types";

process.env.BIGBROTHER_DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "bigbrother-test-"),
);
const proposal = (): Proposal => ({
  id: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  transcriptId: "utterance-1",
  title: 'Lunch with "Jamie"',
  who: "Jamie",
  when: "Thursday at 12:30",
  start: "2026-09-17T16:30:00.000Z",
  end: "2026-09-17T17:30:00.000Z",
  timezone: "America/New_York",
  draft: "Lunch?",
  evidence: "Let's grab lunch Thursday",
  assumptions: [],
  mode: "demo",
  status: "pending",
  createdAt: new Date().toISOString(),
});
test("relative Thursday is resolved in the speaker's timezone", () => {
  const result = resolveTime(
    "Thursday at 12:30 PM",
    "America/New_York",
    new Date("2026-09-12T17:00:00Z"),
  );
  assert.equal(result.start, "2026-09-17T16:30:00.000Z");
  assert.equal(result.end, "2026-09-17T17:30:00.000Z");
});
test("unknown dates require human input and missing times are disclosed", () => {
  assert.equal(
    resolveTime("sometime", "America/New_York", new Date()).start,
    null,
  );
  const result = resolveTime(
    "lunch Thursday",
    "America/New_York",
    new Date("2026-09-12T17:00:00Z"),
  );
  assert.equal(result.start, "2026-09-17T16:30:00.000Z");
  assert.ok(result.assumptions.some((a) => a.includes("wasn’t specified")));
});
test("only one execution can claim an approval and dismiss cannot overwrite it", () => {
  const p = proposal();
  save(p, p.sessionId, p.mode, "proposal");
  assert.equal(claimProposal(p), true);
  assert.equal(claimProposal(p), false);
  assert.equal(dismissProposal(p), false);
  assert.equal(getProposal(p.id, p.sessionId, p.mode)?.status, "executing");
});
test("dismissed proposals cannot execute", () => {
  const p = proposal();
  save(p, p.sessionId, p.mode, "proposal");
  assert.equal(dismissProposal(p), true);
  assert.equal(claimProposal(p), false);
});
test("session and demo/live partitions isolate private history", () => {
  const p = proposal();
  save(p, p.sessionId, p.mode, "proposal");
  assert.equal(snapshot(p.sessionId, "demo").proposals.length, 1);
  assert.equal(snapshot(p.sessionId, "live").proposals.length, 0);
  assert.equal(snapshot(crypto.randomUUID(), "demo").proposals.length, 0);
  assert.equal(getProposal(p.id, crypto.randomUUID(), "demo"), undefined);
});
test("MCP template substitutes values without injecting JSON structure", () => {
  const p = proposal();
  p.title = 'Lunch", "attendees": ["attacker@example.com"]';
  const args = calendarArguments(
    '{"title":"{{title}}","start":"{{start}}","nested":{"notes":"{{description}}"}}',
    p,
  );
  assert.equal(args.title, p.title);
  assert.deepEqual(args.attendees, []);
  assert.throws(() => calendarArguments('{"title":"{{unknown}}"}', p));
});
test("same-origin accepts Next host normalization and blocks cross-site writes", () => {
  assert.doesNotThrow(() =>
    sameOrigin(
      new Request("http://localhost:3000/api/transcript", {
        headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
      }),
    ),
  );
  assert.throws(() =>
    sameOrigin(
      new Request("http://localhost:3000/api/transcript", {
        headers: { origin: "https://evil.example" },
      }),
    ),
  );
});

test("clearing removes both modes and blocks late writes without affecting another session", () => {
  const p = proposal();
  const other = proposal();
  save(p, p.sessionId, "demo", "proposal");
  save(
    { ...p, id: crypto.randomUUID(), mode: "live" },
    p.sessionId,
    "live",
    "proposal",
  );
  save(other, other.sessionId, "demo", "proposal");
  clearSession(p.sessionId);
  assert.equal(snapshot(p.sessionId, "demo").proposals.length, 0);
  assert.equal(snapshot(p.sessionId, "live").proposals.length, 0);
  assert.equal(sessionCleared(p.sessionId), true);
  assert.throws(() => save(p, p.sessionId, "demo", "proposal"), /cleared/);
  assert.equal(snapshot(other.sessionId, "demo").proposals.length, 1);
});
test("clear waits for an executing calendar action", () => {
  const p = proposal();
  save(p, p.sessionId, p.mode, "proposal");
  claimProposal(p);
  assert.throws(() => clearSession(p.sessionId), /still finishing/);
  assert.equal(sessionCleared(p.sessionId), false);
  assert.equal(getProposal(p.id, p.sessionId, p.mode)?.status, "executing");
});
