import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { POST as transcript } from "../src/app/api/transcript/route";
import { isApproval } from "../src/lib/voice-approval";
import { snapshot } from "../src/lib/store";
process.env.BIGBROTHER_DATA_DIR = mkdtempSync(`${tmpdir()}/bb-voice-`);
const request = (input: unknown) =>
  new Request("http://localhost:3000/api/transcript", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
const base = () => ({
  sessionId: crypto.randomUUID(),
  mode: "demo" as const,
  timezone: "America/New_York",
  assistant: true,
});
async function utterance(
  input: ReturnType<typeof base>,
  text: string,
  extra = {},
) {
  const response = await transcript(
    request({ ...input, id: crypto.randomUUID(), text, ...extra }),
  );
  assert.equal(response.status, 200);
  return response.json();
}
test("shared transcript handles conversation, recall, a reminder, and explicit approval", async () => {
  const input = base();
  let state = await utterance(
    input,
    "Yeah Tan, let's grab lunch Thursday at 12:30.",
  );
  assert.equal(state.proposals.length, 1);
  state = await utterance(input, "Remind me what Tan said");
  assert.equal(state.assistant.kind, "answer");
  assert.equal(state.proposals.length, 1);
  state = await utterance(
    input,
    "Remind me in three days to follow up with Tan",
  );
  assert.equal(state.assistant.kind, "proposal");
  assert.equal(state.proposals.length, 2);
  const id = state.assistant.proposalId;
  state = await utterance(input, "Approve it");
  assert.equal(state.assistant.kind, "clarify");
  assert.equal(
    state.proposals.filter((p: any) => p.status === "approved").length,
    0,
  );
  const upstream = crypto.randomUUID();
  state = await utterance(input, "Approve it", {
    id: upstream,
    review: { id, version: 0 },
  });
  assert.equal(state.assistant.kind, "action");
  assert.equal(
    state.proposals.find((p: any) => p.id === id).status,
    "approved",
  );
  const repeated = await utterance(input, "Approve it", {
    id: upstream,
    review: { id, version: 0 },
  });
  assert.equal(
    repeated.proposals.filter((p: any) => p.status === "approved").length,
    1,
  );
  state = await utterance(input, "Approve it", { review: { id, version: 0 } });
  assert.equal(state.assistant.kind, "clarify");
});
test("stale, foreign, and missing card context cannot approve", async () => {
  const input = base();
  let state = await utterance(input, "Remind me in three days to call Tan");
  const id = state.assistant.proposalId;
  state = await utterance(input, "Move it to 3 PM", { targetId: id });
  assert.equal(state.proposals[0].version, 1);
  state = await utterance(input, "Approve it", { review: { id, version: 0 } });
  assert.equal(state.assistant.kind, "clarify");
  assert.equal(state.proposals[0].status, "pending");
  const foreign = await utterance(base(), "Approve it", {
    review: { id, version: 1 },
  });
  assert.equal(foreign.assistant.kind, "clarify");
  assert.equal(
    snapshot(input.sessionId, "demo").proposals[0].status,
    "pending",
  );
  state = await utterance(input, "Yeah sounds good", {
    review: { id, version: 1 },
  });
  assert.equal(state.proposals[0].status, "pending");
});
test("approval phrases require explicit, unqualified approval", () => {
  for (const text of [
    "Approve it",
    "Yes, approve it please.",
    "Go ahead and add it",
    "Confirm that!",
  ])
    assert.equal(isApproval(text), true, text);
  for (const text of [
    "yes",
    "okay",
    "Do not approve it",
    "Should I approve it?",
    "He said approve it",
    "Approve it tomorrow",
    "Approve it but move it first",
    "Remind me to approve it",
    '"approve it"',
  ])
    assert.equal(isApproval(text), false, text);
});
