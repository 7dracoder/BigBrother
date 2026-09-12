import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { POST as act } from "../src/app/api/proposals/route";
import { processAssistant } from "../src/lib/assistant-action";
import { deletionTarget, matchDeletion } from "../src/lib/voice-delete";
import { deleteCalendarHold } from "../src/lib/calendar";
import { save, snapshot } from "../src/lib/store";
import type { Proposal } from "../src/lib/types";
process.env.BIGBROTHER_DATA_DIR = mkdtempSync(`${tmpdir()}/bb-delete-`);
const p = (): Proposal => ({
  id: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  transcriptId: "sample",
  mode: "demo",
  title: "Lunch with Jamie",
  who: "Jamie",
  when: "Tomorrow at 3 PM",
  start: "2026-09-13T19:00:00Z",
  end: "2026-09-13T20:00:00Z",
  timezone: "America/New_York",
  draft: "",
  evidence: "sample",
  assumptions: [],
  status: "approved",
  createdAt: new Date().toISOString(),
  version: 0,
});
const req = (input: unknown) =>
  new Request("http://localhost:3000/api/proposals", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
test("web deletes immediately once and invalidates pending edits", async () => {
  const original = p();
  save(original, original.sessionId, "demo", "proposal");
  const edit = {
    ...original,
    id: crypto.randomUUID(),
    status: "pending" as const,
    operation: "update" as const,
    targetProposalId: original.id,
    targetVersion: 0,
  };
  save(edit, original.sessionId, "demo", "proposal");
  const input = {
    sessionId: original.sessionId,
    mode: "demo",
    id: original.id,
    version: 0,
    action: "delete",
  };
  assert.equal((await act(req(input))).status, 200);
  const state = snapshot(original.sessionId, "demo");
  assert.equal(
    state.proposals.find((x) => x.id === original.id)?.status,
    "deleted",
  );
  assert.equal(
    state.proposals.find((x) => x.id === edit.id)?.status,
    "dismissed",
  );
  assert.equal((await act(req(input))).status, 409);
});
test("spoken deletion needs one matching event, and selected deletion checks version", async () => {
  const original = p();
  save(original, original.sessionId, "demo", "proposal");
  const second = {
    ...original,
    id: crypto.randomUUID(),
    start: "2026-09-14T19:00:00Z",
    end: "2026-09-14T20:00:00Z",
  };
  save(second, original.sessionId, "demo", "proposal");
  const input = {
    sessionId: original.sessionId,
    mode: "demo" as const,
    timezone: original.timezone,
    text: "Delete my lunch with Jamie",
  };
  let result = await processAssistant(input, req(input));
  assert.equal((await result.json()).kind, "clarify");
  assert.equal(
    snapshot(original.sessionId, "demo").proposals.filter(
      (x) => x.status === "approved",
    ).length,
    2,
  );
  result = await processAssistant(
    { ...input, text: "Delete it", review: { id: original.id, version: 9 } },
    req(input),
  );
  assert.equal((await result.json()).kind, "clarify");
  result = await processAssistant(
    { ...input, text: "Delete it", review: { id: original.id, version: 0 } },
    req(input),
  );
  assert.equal((await result.json()).kind, "action");
  assert.equal(
    snapshot(original.sessionId, "demo").proposals.find(
      (x) => x.id === original.id,
    )?.status,
    "deleted",
  );
});
test("spoken matching respects dates, word boundaries, and direct commands", () => {
  const original = p();
  const other = { ...p(), title: "Lunch with Joanna", who: "Joanna" };
  assert.equal(
    matchDeletion(
      "my meeting with Jamie tomorrow",
      [original, other],
      "America/New_York",
      new Date("2026-09-12T17:00:00Z"),
    ).length,
    1,
  );
  assert.equal(
    matchDeletion("meeting with Ann", [other], "America/New_York").length,
    0,
  );
  for (const text of [
    "Delete my meeting with Jamie tomorrow",
    "Can you please remove this event?",
  ])
    assert.ok(deletionTarget(text));
  for (const text of [
    "Do not delete it",
    "He said delete it",
    "Delete it if Jamie agrees",
    "Maybe delete my event",
    '"Delete it"',
  ])
    assert.equal(deletionTarget(text), null);
});
test("provider deletion checks original ID, calls delete_event, verifies absence, and blocks recurring events", async () => {
  const original = { ...p(), eventId: crypto.randomUUID() };
  const names: string[] = [];
  const event = {
    id: original.eventId,
    title: original.title,
    start_at: original.start,
    end_at: original.end,
    calendar_id: crypto.randomUUID(),
  };
  const client = {
    callTool: async (input: {
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      names.push(input.name);
      if (input.name === "get_event")
        return { structuredContent: event, content: [] };
      if (input.name === "delete_event") {
        assert.deepEqual(input.arguments, { id: original.eventId });
        return { structuredContent: { success: true }, content: [] };
      }
      return { structuredContent: { data: [], has_more: false }, content: [] };
    },
  };
  let dispatched = 0;
  await deleteCalendarHold(original, () => dispatched++, client);
  assert.equal(dispatched, 1);
  assert.deepEqual(names, [
    "get_event",
    "delete_event",
    "list_calendar_events",
  ]);
  await assert.rejects(
    deleteCalendarHold(original, () => dispatched++, {
      callTool: async () => ({
        structuredContent: { ...event, recurrence_rule: "FREQ=WEEKLY" },
        content: [],
      }),
    }),
    /recurring/,
  );
  assert.equal(dispatched, 1);
});
