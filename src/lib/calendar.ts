import {
  attendeeEmails,
  normalizeAttendees,
  mergeAttendeeIdentifiers,
} from "./participants";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { HttpError } from "./http";
import type { Proposal } from "./types";

export function calendarConfigured() {
  return Boolean(
    process.env.AMBIGUOUS_MCP_URL &&
    process.env.AMBIGUOUS_API_KEY &&
    process.env.AMBIGUOUS_CALENDAR_TOOL &&
    process.env.AMBIGUOUS_CALENDAR_ARGS,
  );
}
export function calendarArguments(
  template: string,
  proposal: Proposal,
): Record<string, unknown> {
  const values: Record<string, string> = {
    title: proposal.title,
    start: proposal.start!,
    end: proposal.end!,
    timezone: proposal.timezone,
    description: `Captured by BigBrother.\n${proposal.evidence}\n${proposal.attendees?.length ? "Calendar event with participants." : "Personal calendar hold."}`,
  };
  function fill(value: unknown): unknown {
    if (typeof value === "string")
      return value.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
        if (!(key in values))
          throw new HttpError(503, `Unknown calendar template field: ${key}`);
        return values[key];
      });
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, fill(v)]),
      );
    return value;
  }
  const result = fill(JSON.parse(template));
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new HttpError(503, "Calendar arguments must be a JSON object.");
  return {
    ...(result as Record<string, unknown>),
    attendees: normalizeAttendees(proposal.attendees ?? []),
  };
}
export async function connectCalendar() {
  const url = process.env.AMBIGUOUS_MCP_URL;
  if (!url || !process.env.AMBIGUOUS_API_KEY)
    throw new HttpError(
      503,
      "Add the Ambiguous MCP URL and API key to .env.local.",
    );
  const client = new Client({ name: "bigbrother", version: "0.1.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers: { Authorization: `Bearer ${process.env.AMBIGUOUS_API_KEY}` },
      },
    }),
  );
  return client;
}
export async function createCalendarHold(
  proposal: Proposal,
  onDispatch: () => void,
) {
  if (!calendarConfigured())
    throw new HttpError(
      503,
      "Ambiguous Calendar isn’t configured yet. Your proposal is saved; add the MCP configuration to connect it.",
    );
  const args = calendarArguments(
    process.env.AMBIGUOUS_CALENDAR_ARGS!,
    proposal,
  );
  const client = await connectCalendar();
  try {
    const { tools } = await client.listTools();
    const tool = tools.find(
      (t) => t.name === process.env.AMBIGUOUS_CALENDAR_TOOL,
    );
    if (!tool)
      throw new HttpError(
        503,
        "The configured calendar tool was not found on the MCP server.",
      );
    onDispatch();
    const result = await client.callTool(
      { name: tool.name, arguments: args },
      undefined,
      { timeout: 25_000 },
    );
    if (result.isError)
      throw new Error(
        "Calendar tool returned an error; verify the calendar before retrying.",
      );
    const event = eventFromResult(result);
    if (!event?.id)
      throw new Error(
        "Calendar returned no event ID. Verify the calendar before retrying.",
      );
    if (proposal.attendees?.length) {
      const saved = eventFromResult(
        await client.callTool(
          { name: "get_event", arguments: { id: event.id } },
          undefined,
          { timeout: 25_000 },
        ),
      );
      if (
        !saved ||
        !proposal.attendees.every((email) =>
          attendeeEmails(saved.attendees).includes(email.toLowerCase()),
        )
      )
        throw new Error("Could not verify event participants.");
    }
    return {
      eventId: event.id,
      attendees: proposal.attendees ?? [],
      result: proposal.attendees?.length
        ? `Created in Ambiguous Calendar with ${proposal.attendees.length} participant(s). Calendar invitation delivery depends on Ambiguous.`
        : "Created in Ambiguous Calendar. Message remains a draft.",
    };
  } finally {
    await client.close().catch(() => {});
  }
}

type CalendarEvent = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  calendar_id?: string;
  recurrence_rule?: string | null;
  master_event_id?: string | null;
  attendees?: unknown[];
};
export function eventFromResult(result: unknown): CalendarEvent | undefined {
  const value = payload(result);
  const item = value?.data ?? value?.event ?? value;
  return item && typeof item.id === "string" && /^[0-9a-f-]{36}$/i.test(item.id)
    ? (item as CalendarEvent)
    : undefined;
}
function payload(result: unknown): any {
  const r = result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: { type: string; text?: string }[];
  };
  if (r.isError) throw new Error("Calendar tool returned an error.");
  if (r.structuredContent) return r.structuredContent;
  for (const block of r.content ?? [])
    if (block.type === "text" && block.text) {
      try {
        return JSON.parse(block.text);
      } catch {}
    }
  return undefined;
}
function matches(event: CalendarEvent, original: Proposal) {
  return (
    event.title === original.title &&
    Date.parse(event.start_at) === Date.parse(original.start!) &&
    Date.parse(event.end_at) === Date.parse(original.end!)
  );
}
export async function updateCalendarHold(
  proposal: Proposal,
  original: Proposal,
  onDispatch: () => void,
  suppliedClient?: Pick<Client, "callTool">,
) {
  const client = suppliedClient ?? (await connectCalendar());
  try {
    const current = await resolveCalendarEvent(client, original);
    const id = current.id;
    const additions = normalizeAttendees(proposal.attendees ?? []);
    const participantArgs = additions.length
      ? { attendees: mergeAttendeeIdentifiers(current.attendees, additions) }
      : {};
    onDispatch();
    const response = await client.callTool(
      {
        name: "update_event",
        arguments: {
          id,
          title: proposal.title,
          start_at: proposal.start!,
          end_at: proposal.end!,
          ...participantArgs,
        },
      },
      undefined,
      { timeout: 25_000 },
    );
    payload(response);
    const updated = eventFromResult(
      await client.callTool(
        { name: "get_event", arguments: { id } },
        undefined,
        { timeout: 25_000 },
      ),
    );
    if (
      !updated ||
      !matches(updated, proposal) ||
      !additions.every((email) =>
        attendeeEmails(updated.attendees).includes(email),
      )
    )
      throw new Error("Could not verify calendar update.");
    return {
      eventId: id,
      attendees: [
        ...new Set([
          ...(proposal.attendees ?? []),
          ...attendeeEmails(updated.attendees),
        ]),
      ],
      result: additions.length
        ? "Updated the existing event and its participants in Ambiguous Calendar. Calendar invitation delivery depends on Ambiguous."
        : "Updated the existing event in Ambiguous Calendar. Message remains a draft.",
    };
  } finally {
    if (!suppliedClient) await (client as Client).close().catch(() => {});
  }
}

async function resolveCalendarEvent(
  client: Pick<Client, "callTool">,
  original: Proposal,
): Promise<CalendarEvent> {
  let id = original.eventId;
  if (!id) {
    const args = calendarArguments(
      process.env.AMBIGUOUS_CALENDAR_ARGS!,
      original,
    );
    if (typeof args.calendar_id !== "string")
      throw new HttpError(
        409,
        "This older event has no saved calendar ID. Edit it in Ambiguous.",
      );
    const response = await client.callTool(
      {
        name: "list_calendar_events",
        arguments: {
          calendar_id: args.calendar_id,
          start: original.start!,
          end: original.end!,
          limit: 100,
        },
      },
      undefined,
      { timeout: 25_000 },
    );
    const items = payload(response)?.data;
    const candidates = Array.isArray(items)
      ? items.filter((e) => matches(e, original))
      : [];
    if (candidates.length !== 1)
      throw new HttpError(
        409,
        "Couldn’t uniquely locate the original event. Check Ambiguous before editing.",
      );
    id = candidates[0].id;
  }
  const current = eventFromResult(
    await client.callTool({ name: "get_event", arguments: { id } }, undefined, {
      timeout: 25_000,
    }),
  );
  if (!current || !matches(current, original))
    throw new HttpError(
      409,
      "This event changed in the calendar. Review it in Ambiguous before changing it here.",
    );
  return current;
}
export async function deleteCalendarHold(
  original: Proposal,
  onDispatch: () => void,
  suppliedClient?: Pick<Client, "callTool">,
) {
  const client = suppliedClient ?? (await connectCalendar());
  try {
    const event = await resolveCalendarEvent(client, original);
    if (event.recurrence_rule || event.master_event_id)
      throw new HttpError(
        409,
        "This is a recurring event. Delete the intended occurrence directly in Ambiguous.",
      );
    onDispatch();
    const result = await client.callTool(
      { name: "delete_event", arguments: { id: event.id } },
      undefined,
      { timeout: 25_000 },
    );
    payload(result);
    const calendarId =
      event.calendar_id ??
      calendarArguments(process.env.AMBIGUOUS_CALENDAR_ARGS!, original)
        .calendar_id;
    const remaining = payload(
      await client.callTool(
        {
          name: "list_calendar_events",
          arguments: {
            calendar_id: calendarId,
            start: original.start!,
            end: original.end!,
            limit: 100,
          },
        },
        undefined,
        { timeout: 25_000 },
      ),
    );
    if (
      !Array.isArray(remaining?.data) ||
      remaining.has_more ||
      remaining.data.some((e: CalendarEvent) => e.id === event.id)
    )
      throw new Error("Could not verify event deletion.");
    return {
      eventId: event.id,
      result: `Deleted “${original.title}” from Ambiguous Calendar.`,
    };
  } finally {
    if (!suppliedClient) await (client as Client).close().catch(() => {});
  }
}

export async function findCalendarContacts(
  name: string,
): Promise<{ name: string; email: string }[]> {
  const client = await connectCalendar();
  try {
    const data = payload(
      await client.callTool(
        {
          name: "list_contacts",
          arguments: { q: name, type: "person", limit: 100 },
        },
        undefined,
        { timeout: 25_000 },
      ),
    );
    if (!Array.isArray(data?.data))
      throw new HttpError(
        502,
        "Couldn’t read contacts. Please supply the email address.",
      );
    if (data.has_more)
      throw new HttpError(
        409,
        "Several contacts match. Please supply the full email address.",
      );
    const words = name.toLowerCase().split(/\s+/);
    return data.data
      .filter(
        (c: { name?: string; email?: string }) =>
          typeof c.name === "string" &&
          typeof c.email === "string" &&
          attendeeEmails([c.email]).length &&
          words.every((w) => c.name!.toLowerCase().split(/\s+/).includes(w)),
      )
      .map((c: { name: string; email: string }) => ({
        name: c.name,
        email: c.email.toLowerCase(),
      }));
  } finally {
    await client.close().catch(() => {});
  }
}
