import { attendeesSchema, normalizeAttendees } from "@/lib/participants";
import { deleteProposal } from "@/lib/delete-proposal";
import { z } from "zod";
import {
  body,
  failure,
  HttpError,
  modeSchema,
  sessionSchema,
} from "@/lib/http";
import {
  claimProposal,
  replaceProposal,
  dismissProposal,
  getProposal,
  log,
  save,
  snapshot,
} from "@/lib/store";
import { createCalendarHold, updateCalendarHold } from "@/lib/calendar";
export const runtime = "nodejs";
const schema = z.object({
  sessionId: sessionSchema,
  mode: modeSchema,
  id: z.string().uuid(),
  version: z.number().int().nonnegative().optional(),
  action: z.enum(["approve", "dismiss", "delete"]),
  title: z.string().trim().min(1).max(200).optional(),
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  draft: z.string().max(2000).optional(),
  attendees: attendeesSchema.optional(),
});
export async function POST(request: Request) {
  try {
    const input = await body(request, schema);
    const proposal = getProposal(input.id, input.sessionId, input.mode);
    if (!proposal) throw new HttpError(404, "Proposal not found.");
    if ((input.version ?? 0) !== (proposal.version ?? 0))
      throw new HttpError(
        409,
        "This proposal was edited. Refresh and review the latest details.",
      );
    if (input.action === "delete") {
      await deleteProposal(proposal);
      return Response.json(snapshot(input.sessionId, input.mode));
    }
    if (proposal.status !== "pending")
      throw new HttpError(
        409,
        "This proposal has already been handled. Refresh to see its status.",
      );
    if (input.action === "dismiss") {
      if (!dismissProposal(proposal))
        throw new HttpError(409, "This proposal is already being processed.");
      log(input.sessionId, input.mode, "Proposal dismissed. Nothing was sent.");
    } else {
      const approved = {
        ...proposal,
        title: input.title ?? proposal.title,
        start: input.start ?? proposal.start,
        end: input.end ?? proposal.end,
        draft: input.draft ?? proposal.draft,
        attendees: normalizeAttendees(
          input.attendees ?? proposal.attendees ?? [],
        ),
      };
      if (
        !approved.start ||
        !approved.end ||
        Date.parse(approved.end) <= Date.parse(approved.start) ||
        Date.parse(approved.start) <= Date.now()
      )
        throw new HttpError(
          400,
          "Choose a future start and an end after the start.",
        );
      if (!claimProposal(approved))
        throw new HttpError(409, "This proposal is already being processed.");
      let dispatched = false;
      let original = proposal.targetProposalId
        ? getProposal(proposal.targetProposalId, input.sessionId, input.mode)
        : undefined;
      let locked = false;
      try {
        if (proposal.operation === "update") {
          if (
            !original ||
            original.status !== "approved" ||
            (original.version ?? 0) !== proposal.targetVersion
          )
            throw new HttpError(
              409,
              "The original plan changed. Dismiss this edit and prepare a new one.",
            );
          locked = replaceProposal(original, {
            ...original,
            status: "executing",
          });
          if (!locked)
            throw new HttpError(
              409,
              "Another edit is already being processed.",
            );
        }
        const receipt =
          input.mode === "demo"
            ? {
                eventId: original?.eventId,
                result: original
                  ? "Demo edit approved. No external event or message was changed."
                  : "Demo hold approved. No external event or message was created.",
              }
            : original
              ? await updateCalendarHold(approved, original, () => {
                  dispatched = true;
                })
              : await createCalendarHold(approved, () => {
                  dispatched = true;
                });
        if (original)
          save(
            {
              ...original,
              title: approved.title,
              start: approved.start,
              end: approved.end,
              when: approved.when,
              timezone: approved.timezone,
              draft: approved.draft,
              attendees: approved.attendees,
              status: "approved",
              version: (original.version ?? 0) + 1,
              ...receipt,
            },
            input.sessionId,
            input.mode,
            "proposal",
          );
        save(
          {
            ...approved,
            status: original ? "applied" : "approved",
            ...receipt,
          },
          input.sessionId,
          input.mode,
          "proposal",
        );
        log(input.sessionId, input.mode, receipt.result, "success");
      } catch (e) {
        const message = dispatched
          ? "Calendar response uncertain. Check Ambiguous before creating or editing another event."
          : e instanceof HttpError
            ? e.message
            : "Calendar connection failed. The proposal is saved and can be retried.";
        if (original && locked)
          save(
            {
              ...original,
              status: dispatched ? "uncertain" : "approved",
              result: message,
            },
            input.sessionId,
            input.mode,
            "proposal",
          );
        save(
          {
            ...approved,
            status: dispatched ? "uncertain" : "pending",
            result: message,
          },
          input.sessionId,
          input.mode,
          "proposal",
        );
        log(input.sessionId, input.mode, message, "error");
        throw new HttpError(502, message);
      }
    }
    return Response.json(snapshot(input.sessionId, input.mode));
  } catch (e) {
    return failure(e);
  }
}
