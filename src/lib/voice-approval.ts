import { z } from "zod";
import { POST as act } from "../app/api/proposals/route";
import { getProposal, snapshot } from "./store";
import type { AssistantInput } from "./assistant";
export const reviewSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
});
export function isApproval(text: string) {
  const normalized = text
    .toLowerCase()
    .replace(/[.,!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:(?:yes|okay|ok) )?(?:please )?(?:approve (?:it|this|that|this action|that action|this event|that event|the action)|confirm (?:it|this|that)|go ahead and (?:approve|add) it)(?: please)?$/.test(
    normalized,
  );
}
export async function confirmFromSpeech(
  input: AssistantInput,
  request: Request,
) {
  if (!isApproval(input.text)) return null;
  const reply = (kind: string, answer: string, proposalId?: string) =>
    Response.json({ kind, answer, proposalId, sources: [] });
  if (!input.review) {
    const pending = snapshot(input.sessionId, input.mode).proposals.filter(
      (p) => p.status === "pending",
    );
    return reply(
      "clarify",
      pending.length
        ? "Choose a card with “Review this action,” then say “approve it.”"
        : "There isn’t a displayed action to approve yet. Wait for a proposal to appear.",
    );
  }
  const p = getProposal(input.review.id, input.sessionId, input.mode);
  if (!p || p.status !== "pending" || (p.version ?? 0) !== input.review.version)
    return reply(
      "clarify",
      "That card has changed or was already handled. Review the current card before approving.",
    );
  const response = await act(
    new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        sessionId: input.sessionId,
        mode: input.mode,
        id: p.id,
        version: input.review.version,
        action: "approve",
      }),
    }),
  );
  const result = await response.json();
  if (!response.ok)
    return reply(
      "error",
      result.error || "Could not approve this action.",
      p.id,
    );
  const updated = getProposal(p.id, input.sessionId, input.mode)!;
  return reply("action", updated.result || "Action approved.", p.id);
}
