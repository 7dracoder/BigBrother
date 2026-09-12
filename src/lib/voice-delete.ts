import * as chrono from "chrono-node";
import { formatInTimeZone, getTimezoneOffset } from "date-fns-tz";
import type { AssistantInput } from "./assistant";
import type { Proposal } from "./types";
import { snapshot, getProposal } from "./store";
import { deleteProposal } from "./delete-proposal";

export function deletionTarget(text: string): string | null {
  if (
    /["“”]|\b(don['’]?t|not|never|unless|if|maybe|should|later|instead|except|but)\b/i.test(
      text,
    )
  )
    return null;
  const match = text
    .trim()
    .match(
      /^(?:(?:hey )?big\s?brother[, ]+)?(?:(?:can|could|would) you (?:please )?)?(?:please )?(?:delete|remove|cancel)\s+(.+?)[.!?]*$/i,
    );
  return match ? match[1].replace(/\s+please$/i, "").trim() : null;
}
export function matchDeletion(
  target: string,
  proposals: Proposal[],
  timezone: string,
  now = new Date(),
) {
  const parsed = chrono.parse(
    target,
    { instant: now, timezone: getTimezoneOffset(timezone, now) / 60000 },
    { forwardDate: true },
  )[0];
  const withoutDate = parsed
    ? target.slice(0, parsed.index) +
      target.slice(parsed.index + parsed.text.length)
    : target;
  const words = withoutDate
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w &&
        ![
          "my",
          "the",
          "a",
          "an",
          "event",
          "events",
          "meeting",
          "calendar",
          "reminder",
          "with",
          "on",
          "at",
          "from",
          "for",
        ].includes(w),
    );
  // A generic command with no name or date cannot pick an arbitrary event.
  if (!words.length && !parsed) return [];
  return proposals.filter((p) => {
    if (p.status !== "approved") return false;
    const name = new Set(
      `${p.title} ${p.who}`
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/),
    );
    if (!words.every((w) => name.has(w))) return false;
    if (parsed) {
      if (!p.start) return false;
      const c = parsed.start;
      const hasDay = ["day", "month", "year", "weekday"].some((k) =>
        c.isCertain(k as "day"),
      );
      if (hasDay) {
        const day = `${c.get("year")}-${String(c.get("month")).padStart(2, "0")}-${String(c.get("day")).padStart(2, "0")}`;
        if (formatInTimeZone(p.start, timezone, "yyyy-MM-dd") !== day)
          return false;
      }
      if (
        c.isCertain("hour") &&
        formatInTimeZone(p.start, timezone, "HH:mm") !==
          `${String(c.get("hour")).padStart(2, "0")}:${String(c.get("minute") ?? 0).padStart(2, "0")}`
      )
        return false;
    }
    return true;
  });
}
export async function deleteFromSpeech(input: AssistantInput) {
  const target = deletionTarget(input.text);
  if (!target) return null;
  const reply = (kind: string, answer: string, proposalId?: string) =>
    Response.json({ kind, answer, proposalId, sources: [] });
  if (/\b(all|every|both)\b/i.test(target))
    return reply("clarify", "Name one event to delete at a time.");
  let matches: Proposal[];
  if (
    /^(?:it|this|that|this event|that event|this meeting|that meeting|this action|that action)$/i.test(
      target,
    )
  ) {
    const p = input.review
      ? getProposal(input.review.id, input.sessionId, input.mode)
      : undefined;
    if (
      !p ||
      p.status !== "approved" ||
      (p.version ?? 0) !== input.review?.version
    )
      return reply(
        "clarify",
        "Name the calendar event to delete, or select an existing event with “Edit with text or voice.”",
      );
    matches = [p];
  } else
    matches = matchDeletion(
      target,
      snapshot(input.sessionId, input.mode).proposals,
      input.timezone,
    );
  if (matches.length !== 1)
    return reply(
      "clarify",
      matches.length
        ? `Which event should I delete? ${matches.map((p) => `${p.title} (${p.start ? formatInTimeZone(p.start, input.timezone, "MMM d, h:mm a") : p.when})`).join("; ")}. Say “delete” with the title and date.`
        : "I couldn’t find one matching saved calendar event. Give its title and date. Events cleared from app history need to be managed in Ambiguous.",
    );
  try {
    return reply("action", await deleteProposal(matches[0]), matches[0].id);
  } catch (e) {
    return reply(
      "error",
      e instanceof Error ? e.message : "Could not delete this event.",
      matches[0].id,
    );
  }
}
