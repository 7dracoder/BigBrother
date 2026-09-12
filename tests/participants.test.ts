import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  extractEmails,
  mergeAttendeeIdentifiers,
} from "../src/lib/participants";
import { POST as assist } from "../src/app/api/assist/route";
import { POST as act } from "../src/app/api/proposals/route";
import { POST as recall } from "../src/app/api/recall/route";
import { defaultContactEmailAnswer } from "../src/lib/demo-contact";
import { save, snapshot } from "../src/lib/store";
import { calendarArguments, updateCalendarHold } from "../src/lib/calendar";
import type { Proposal } from "../src/lib/types";
process.env.BIGBROTHER_DATA_DIR = mkdtempSync(`${tmpdir()}/bb-participants-`);
const p = (): Proposal => ({
  id: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  transcriptId: "sample",
  title: "Lunch with Jamie",
  who: "Jamie",
  when: "Tomorrow at 3 PM",
  start: new Date(Date.now() + 86400_000).toISOString(),
  end: new Date(Date.now() + 90000_000).toISOString(),
  timezone: "America/New_York",
  mode: "demo",
  draft: "",
  evidence: "sample",
  assumptions: [],
  status: "pending",
  createdAt: new Date().toISOString(),
});
const req = (path: string, input: unknown) =>
  new Request(`http://localhost:3000/api/${path}`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
test("Tan email questions work without memory and never create an action", async () => {
  for (const mode of ["demo", "live"] as const) {
    const sessionId = crypto.randomUUID();
    const input = { sessionId, mode, timezone: "America/New_York" };
    const response = await assist(
      req("assist", { ...input, text: "What's your email?" }),
    );
    assert.equal(response.status, 200);
    assert.equal(
      (await response.json()).answer,
      "Tan’s email is ts5789@nyu.edu.",
    );
    const remembered = await recall(
      req("recall", { ...input, question: "What is Tan's email address?" }),
    );
    assert.equal(
      (await remembered.json()).answer,
      "Tan’s email is ts5789@nyu.edu.",
    );
    assert.equal(snapshot(sessionId, mode).proposals.length, 0);
  }
  assert.equal(defaultContactEmailAnswer("What's Daniel's email?"), null);
  assert.equal(
    defaultContactEmailAnswer("Change your email to alex@example.com"),
    null,
  );
});
test("demo can resolve Tan by name when adding a participant", async () => {
  const original = p();
  save(original, original.sessionId, "demo", "proposal");
  const response = await assist(
    req("assist", {
      sessionId: original.sessionId,
      mode: "demo",
      timezone: original.timezone,
      targetId: original.id,
      text: "Add Tan to this event",
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    snapshot(original.sessionId, "demo").proposals[0].attendees,
    ["ts5789@nyu.edu"],
  );
});
test("spoken email normalization handles at/dot/spelling without joining sentence text", () => {
  assert.deepEqual(
    extractEmails("My email is Jamie dot Lee at gmail dot com."),
    ["jamie.lee@gmail.com"],
  );
  assert.deepEqual(extractEmails("j a m i e at example dot com"), [
    "jamie@example.com",
  ]);
  assert.deepEqual(extractEmails("My email is ps5789@nyu.edu. Let us meet."), [
    "ps5789@nyu.edu",
  ]);
  assert.deepEqual(extractEmails("Meet me at three dot thirty."), []);
});
test("spoken email updates pending event, and approved participant edit stays pending until approval", async () => {
  const original = p();
  save(original, original.sessionId, "demo", "proposal");
  const base = {
    sessionId: original.sessionId,
    mode: "demo",
    timezone: original.timezone,
    targetId: original.id,
  };
  let r = await assist(
    req("assist", {
      ...base,
      text: "So my email is jamie dot lee at example dot com.",
    }),
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).proposalId, original.id);
  let current = snapshot(original.sessionId, "demo").proposals[0];
  assert.deepEqual(current.attendees, ["jamie.lee@example.com"]);
  assert.equal(current.status, "pending");
  assert.equal(current.version, 1);
  r = await act(
    req("proposals", {
      ...base,
      id: original.id,
      action: "approve",
      version: 1,
    }),
  );
  assert.equal(r.status, 200);
  r = await assist(
    req("assist", { ...base, text: "My email is alex at example dot com." }),
  );
  const reply = await r.json();
  assert.equal(reply.kind, "proposal");
  assert.notEqual(reply.proposalId, original.id);
  current = snapshot(original.sessionId, "demo").proposals.find(
    (p) => p.id === original.id,
  )!;
  assert.deepEqual(current.attendees, ["jamie.lee@example.com"]);
  r = await act(
    req("proposals", {
      ...base,
      id: reply.proposalId,
      action: "approve",
      version: 0,
    }),
  );
  assert.equal(r.status, 200);
  current = snapshot(original.sessionId, "demo").proposals.find(
    (p) => p.id === original.id,
  )!;
  assert.deepEqual(current.attendees, [
    "jamie.lee@example.com",
    "alex@example.com",
  ]);
});
test("ambiguous email follow-up asks which event and bad web emails never execute", async () => {
  const one = p(),
    two = { ...p(), sessionId: one.sessionId };
  save(one, one.sessionId, "demo", "proposal");
  save(two, one.sessionId, "demo", "proposal");
  const r = await assist(
    req("assist", {
      sessionId: one.sessionId,
      mode: "demo",
      timezone: one.timezone,
      text: "My email is jamie at example dot com",
    }),
  );
  assert.equal((await r.json()).kind, "clarify");
  const bad = await act(
    req("proposals", {
      sessionId: one.sessionId,
      mode: "demo",
      id: one.id,
      action: "approve",
      attendees: ["bad address"],
    }),
  );
  assert.equal(bad.status, 400);
  assert.equal(snapshot(one.sessionId, "demo").proposals[0].status, "pending");
});
test("calendar creation includes reviewed emails and participant edits preserve existing guests and organizer", async () => {
  const original = {
    ...p(),
    eventId: crypto.randomUUID(),
    status: "approved" as const,
  };
  const edited = { ...original, attendees: ["new@example.com"] };
  assert.deepEqual(calendarArguments('{"attendees":[]}', edited).attendees, [
    "new@example.com",
  ]);
  const organizer = crypto.randomUUID();
  assert.deepEqual(
    mergeAttendeeIdentifiers(
      [{ user_id: organizer }, { email: "guest@example.com" }],
      ["GUEST@example.com", "new@example.com"],
    ),
    [organizer, "guest@example.com", "new@example.com"],
  );
  let updated = false;
  const client = {
    callTool: async (input: {
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (input.name === "update_event") {
        assert.deepEqual(input.arguments?.attendees, [
          organizer,
          "guest@example.com",
          "new@example.com",
        ]);
        updated = true;
      }
      return {
        structuredContent: {
          id: original.eventId,
          title: original.title,
          start_at: original.start,
          end_at: original.end,
          attendees: [
            { user_id: organizer },
            { email: "guest@example.com" },
            ...(updated ? [{ email: "new@example.com" }] : []),
          ],
        },
        content: [],
      };
    },
  };
  const result = await updateCalendarHold(edited, original, () => {}, client);
  assert.ok(result.attendees.includes("new@example.com"));
  assert.ok(result.attendees.includes("guest@example.com"));
});
