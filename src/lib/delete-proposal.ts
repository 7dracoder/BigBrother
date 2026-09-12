import { deleteCalendarHold } from "./calendar";
import { HttpError } from "./http";
import { replaceProposal, save, log, snapshot } from "./store";
import type { Proposal } from "./types";
export async function deleteProposal(proposal: Proposal) {
  if (proposal.status !== "approved")
    throw new HttpError(
      409,
      "Only an existing calendar event can be deleted. Refresh its status.",
    );
  if (!replaceProposal(proposal, { ...proposal, status: "executing" }))
    throw new HttpError(409, "This event is already being changed.");
  let dispatched = false;
  try {
    const receipt =
      proposal.mode === "demo"
        ? {
            eventId: proposal.eventId,
            result: `Deleted demo event “${proposal.title}”. No real calendar event was deleted.`,
          }
        : await deleteCalendarHold(proposal, () => {
            dispatched = true;
          });
    save(
      {
        ...proposal,
        ...receipt,
        status: "deleted",
        version: (proposal.version ?? 0) + 1,
      },
      proposal.sessionId,
      proposal.mode,
      "proposal",
    );
    for (const edit of snapshot(proposal.sessionId, proposal.mode).proposals)
      if (edit.targetProposalId === proposal.id && edit.status === "pending")
        replaceProposal(edit, {
          ...edit,
          status: "dismissed",
          result: "Original event was deleted.",
        });
    log(proposal.sessionId, proposal.mode, receipt.result, "success");
    return receipt.result;
  } catch (e) {
    const message = dispatched
      ? "Deletion response uncertain. Check Ambiguous before retrying."
      : e instanceof HttpError
        ? e.message
        : "Could not connect to the calendar. The event was not deleted.";
    save(
      {
        ...proposal,
        status: dispatched ? "uncertain" : "approved",
        result: message,
      },
      proposal.sessionId,
      proposal.mode,
      "proposal",
    );
    log(proposal.sessionId, proposal.mode, message, "error");
    throw new HttpError(502, message);
  }
}
