import { extractEmails, normalizeAttendees } from "./participants";
import { defaultContactEmailAnswer, demoContact } from "./demo-contact";
import { findCalendarContacts } from "./calendar";
import { deleteFromSpeech } from "./voice-delete";
import { interpret, commandTime, type AssistantInput } from "./assistant";
import { HttpError } from "./http";
import { log, replaceProposal, save, snapshot } from "./store";
import type { Proposal } from "./types";
import { confirmFromSpeech } from "./voice-approval";
export async function processAssistant(
  input: AssistantInput,
  request: Request,
) {
  const emailAnswer = defaultContactEmailAnswer(input.text);
  if (emailAnswer)
    return Response.json({ kind: "answer", answer: emailAnswer, sources: [] });
  const deletion = await deleteFromSpeech(input);
  if (deletion) return deletion;
  const state = snapshot(input.sessionId, input.mode);
  const confirmation = await confirmFromSpeech(input, request);
  if (confirmation) return confirmation;
  const d = await interpret(input, state);
  const reply = (kind: string, answer: string, proposalId?: string) =>
    Response.json({
      kind,
      answer,
      proposalId,
      sources:
        kind === "answer"
          ? state.transcripts.filter((t) => d.sourceIds.includes(t.id))
          : [],
    });
  if (d.intent === "conversation") return reply("conversation", "");
  if (d.intent === "recall" || d.intent === "clarify")
    return reply(d.intent === "recall" ? "answer" : "clarify", d.answer);
  const heard = extractEmails(
    [
      input.previousRequest,
      input.text,
      ...state.transcripts.slice(-8).map((t) => t.text),
    ]
      .filter(Boolean)
      .join(" "),
  );
  let additions = normalizeAttendees(
    d.attendees.filter((email) => heard.includes(email.toLowerCase())),
  );
  if (d.attendees.length !== additions.length)
    return reply(
      "clarify",
      "Please say or type the participant’s full email address.",
    );
  if (d.contactName && !additions.length) {
    if (input.mode === "demo" && d.contactName.toLowerCase() !== "tan")
      return reply(
        "clarify",
        `Demo contact lookup needs an email. What is ${d.contactName}’s email address?`,
      );
    const contacts =
      input.mode === "demo"
        ? [demoContact]
        : await findCalendarContacts(d.contactName);
    if (contacts.length !== 1)
      return reply(
        "clarify",
        contacts.length
          ? `I found several contacts named ${d.contactName}. Please give the intended email address.`
          : `I couldn’t find an email for ${d.contactName}. Please say or type it.`,
      );
    additions = [contacts[0].email];
  }
  const original =
    d.intent === "edit"
      ? state.proposals.find((p) => p.id === (input.targetId ?? d.targetId))
      : undefined;
  if (
    d.intent === "edit" &&
    (!original ||
      !["pending", "approved"].includes(original.status) ||
      original.targetProposalId)
  )
    return reply("clarify", "Select a pending or approved plan to edit.");
  if (!original && !d.when)
    return reply("clarify", "When should I schedule it?");
  if (!original && !d.title)
    return reply("clarify", "What should I remind you to do?");
  if (
    original &&
    !d.when &&
    !d.title &&
    d.draft === null &&
    !d.durationMinutes &&
    !additions.length
  )
    return reply("clarify", "What would you like to change?");
  const timing = d.when
    ? commandTime(
        d.when,
        input.timezone,
        new Date(),
        original,
        d.durationMinutes ?? (!original && d.intent === "reminder" ? 15 : null),
      )
    : original
      ? {
          start: original.start,
          end:
            d.durationMinutes && original.start
              ? new Date(
                  Date.parse(original.start) + d.durationMinutes * 60000,
                ).toISOString()
              : original.end,
          assumptions: [],
        }
      : null;
  if (!timing?.start || !timing.end || Date.parse(timing.start) <= Date.now())
    return reply("clarify", "Please give me a future date and time.");
  const p: Proposal = {
    id: crypto.randomUUID(),
    sessionId: input.sessionId,
    mode: input.mode,
    transcriptId: original?.transcriptId ?? "explicit-request",
    title: d.title ?? original!.title,
    who: original?.who ?? "You",
    when: d.when ?? original!.when,
    ...timing,
    timezone: input.timezone,
    draft: d.draft ?? original?.draft ?? "",
    attendees: normalizeAttendees([
      ...(original?.attendees ?? []),
      ...additions,
    ]),
    evidence: [input.previousRequest, input.text].filter(Boolean).join(" → "),
    assumptions: [
      ...timing.assumptions,
      additions.length
        ? "Approval adds the listed participants. Your calendar may send invitations."
        : "No participants added. Message stays a draft.",
      ...(d.intent === "reminder"
        ? [
            "Reminder is a calendar entry. Notification delivery depends on your calendar settings.",
          ]
        : []),
    ],
    status: "pending",
    createdAt: new Date().toISOString(),
    version: 0,
    kind: original?.kind ?? (d.intent === "reminder" ? "reminder" : "event"),
    operation: "create",
  };
  if (original) {
    p.before = {
      title: original.title,
      start: original.start,
      end: original.end,
    };
    if (original.status === "pending") {
      p.id = original.id;
      p.createdAt = original.createdAt;
      p.version = (original.version ?? 0) + 1;
      if (!replaceProposal(original, p))
        throw new HttpError(
          409,
          "This plan changed while you were editing. Try again.",
        );
    } else {
      p.operation = "update";
      p.targetProposalId = original.id;
      p.targetVersion = original.version ?? 0;
      p.eventId = original.eventId;
      save(p, input.sessionId, input.mode, "proposal");
    }
  } else save(p, input.sessionId, input.mode, "proposal");
  log(
    input.sessionId,
    input.mode,
    original
      ? "Edit prepared for review."
      : "Calendar proposal prepared from your request.",
  );
  return reply(
    "proposal",
    original
      ? original.status === "pending"
        ? "Your draft is updated. Review and approve it to add it to your calendar."
        : "Your edit is ready to review. Approve it to update the calendar."
      : "Ready to review. Approve the card to add it to your calendar.",
    p.id,
  );
}
