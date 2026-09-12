import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { POST as assist } from "../src/app/api/assist/route";
import { POST as act } from "../src/app/api/proposals/route";
import { commandTime } from "../src/lib/assistant";
import { snapshot } from "../src/lib/store";
import { updateCalendarHold } from "../src/lib/calendar";
import type { Proposal } from "../src/lib/types";
process.env.BIGBROTHER_DATA_DIR = mkdtempSync(`${tmpdir()}/bb-assistant-`);
const request = (route: string, input: unknown) =>
  new Request(`http://localhost:3000/api/${route}`, {
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
});
test("recall and ambiguous reminders never create calendar proposals", async () => {
  const input = base();
  for (const [text, kind] of [
    ["Remind me what Jamie said", "answer"],
    ["Remind me about Jamie", "clarify"],
  ]) {
    const r = await assist(request("assist", { ...input, text }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).kind, kind);
  }
  assert.equal(snapshot(input.sessionId, "demo").proposals.length, 0);
});
test("dated reminder → pending edit → approval → approved edit updates one original", async () => {
  const input = base();
  const r = await assist(
    request("assist", {
      ...input,
      text: "Remind me in three days to follow up with Jamie",
    }),
  );
  assert.equal(r.status, 200);
  const { proposalId } = await r.json();
  let p = snapshot(input.sessionId, "demo").proposals[0];
  assert.equal(p.kind, "reminder");
  assert.equal(p.status, "pending");
  assert.equal(Date.parse(p.end!) - Date.parse(p.start!), 15 * 60000);
  const date = p.start!.slice(0, 10);
  const edited = await assist(
    request("assist", {
      ...input,
      targetId: proposalId,
      text: "Move it to 3 PM",
    }),
  );
  assert.equal(edited.status, 200);
  p = snapshot(input.sessionId, "demo").proposals[0];
  assert.equal(p.version, 1);
  assert.equal(p.start, `${date}T19:00:00.000Z`);
  assert.equal(
    (
      await act(
        request("proposals", {
          ...input,
          id: p.id,
          version: 0,
          action: "approve",
        }),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await act(
        request("proposals", {
          ...input,
          id: p.id,
          version: 1,
          action: "approve",
        }),
      )
    ).status,
    200,
  );
  const revision = await assist(
    request("assist", { ...input, targetId: p.id, text: "Move it to 4 PM" }),
  );
  const { proposalId: editId } = await revision.json();
  let state = snapshot(input.sessionId, "demo");
  assert.equal(state.proposals.find((x) => x.id === p.id)?.start, p.start);
  assert.equal(
    (
      await act(
        request("proposals", { ...input, id: editId, action: "approve" }),
      )
    ).status,
    200,
  );
  state = snapshot(input.sessionId, "demo");
  assert.equal(
    state.proposals.filter((x) => x.status === "approved").length,
    1,
  );
  assert.equal(
    state.proposals.find((x) => x.id === p.id)?.start,
    `${date}T20:00:00.000Z`,
  );
  assert.equal(state.proposals.find((x) => x.id === editId)?.status, "applied");
  const stranger = await assist(
    request("assist", { ...base(), targetId: p.id, text: "Move it to 5 PM" }),
  );
  assert.equal((await stranger.json()).kind, "clarify");
});
test("time-only edits keep date and duration; dates across DST use Eastern offset", () => {
  const original = {
    start: "2026-11-05T17:30:00.000Z",
    end: "2026-11-05T18:00:00.000Z",
  } as Proposal;
  const time = commandTime(
    "3 PM",
    "America/New_York",
    new Date("2026-09-12T17:00:00Z"),
    original,
  )!;
  assert.equal(time.start, "2026-11-05T20:00:00.000Z");
  assert.equal(time.end, "2026-11-05T20:30:00.000Z");
});
test("calendar edits use update_event on original ID and verify result; stale remote events block writes", async () => {
  const original = {
    id: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    title: "Meeting",
    start: "2026-09-17T19:00:00Z",
    end: "2026-09-17T20:00:00Z",
  } as Proposal;
  const revised = {
    ...original,
    start: "2026-09-17T20:00:00Z",
    end: "2026-09-17T21:00:00Z",
  };
  const calls: string[] = [];
  let changed = false,
    dispatches = 0;
  const client = {
    callTool: async (input: {
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      calls.push(input.name);
      assert.equal(input.arguments?.id, original.eventId);
      if (input.name === "update_event") changed = true;
      const p = changed ? revised : original;
      return {
        structuredContent: {
          id: p.eventId,
          title: p.title,
          start_at: p.start,
          end_at: p.end,
        },
        content: [],
      };
    },
  };
  await updateCalendarHold(revised, original, () => dispatches++, client);
  assert.deepEqual(calls, ["get_event", "update_event", "get_event"]);
  assert.equal(dispatches, 1);
  await assert.rejects(
    updateCalendarHold(revised, original, () => dispatches++, {
      callTool: async () => ({
        structuredContent: {
          id: original.eventId,
          title: "Changed elsewhere",
          start_at: original.start,
          end_at: original.end,
        },
        content: [],
      }),
    }),
    /changed in the calendar/,
  );
  assert.equal(dispatches, 1);
});
