import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST as transcript } from "../src/app/api/transcript/route";
import { POST as proposals } from "../src/app/api/proposals/route";
import { POST as recall } from "../src/app/api/recall/route";
import { snapshot } from "../src/lib/store";
import type { Snapshot } from "../src/lib/types";
process.env.BIGBROTHER_DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "bigbrother-routes-"),
);
const request = (route: string, data: unknown) =>
  new Request(`http://localhost:3000/api/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(data),
  });
test("demo capture → deduplicate → approve → recall works without API keys", async () => {
  const sessionId = crypto.randomUUID();
  const input = {
    sessionId,
    mode: "demo",
    id: "realtime-item-1",
    text: "Yeah Tan, let's grab lunch Thursday at 12:30.",
    timezone: "America/New_York",
  };
  const first = await transcript(request("transcript", input));
  assert.equal(first.status, 200);
  const state = (await first.json()) as Snapshot;
  assert.equal(state.transcripts.length, 1);
  assert.equal(state.proposals.length, 1);
  const repeated = await transcript(request("transcript", input));
  const repeatState = (await repeated.json()) as Snapshot;
  assert.equal(repeatState.transcripts.length, 1);
  assert.equal(repeatState.proposals.length, 1);
  const approval = {
    sessionId,
    mode: "demo",
    id: state.proposals[0].id,
    action: "approve",
    start: new Date(Date.now() + 86400_000).toISOString(),
    end: new Date(Date.now() + 90000_000).toISOString(),
  };
  const approved = await proposals(request("proposals", approval));
  assert.equal(approved.status, 200);
  const approvedState = (await approved.json()) as Snapshot;
  assert.equal(approvedState.proposals[0].status, "approved");
  assert.match(approvedState.proposals[0].result!, /No external event/);
  assert.equal((await proposals(request("proposals", approval))).status, 409);
  const recalled = await recall(
    request("recall", {
      sessionId,
      mode: "demo",
      question: "What did I agree to?",
    }),
  );
  assert.equal(recalled.status, 200);
  const memory = await recalled.json();
  assert.equal(memory.sources.length, 1);
  assert.match(memory.answer, /demo data/);
  assert.equal(snapshot(sessionId, "live").transcripts.length, 0);
});
test("invalid inputs are rejected before persistence", async () => {
  const sessionId = crypto.randomUUID();
  const response = await transcript(
    request("transcript", {
      sessionId,
      mode: "live",
      id: "x",
      text: "",
      timezone: "not-a-timezone",
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(snapshot(sessionId, "live").transcripts.length, 0);
});
