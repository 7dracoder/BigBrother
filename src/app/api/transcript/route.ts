import { z } from "zod";
import { body, failure, modeSchema, sessionSchema } from "@/lib/http";
import { getTranscript, log, save, snapshot } from "@/lib/store";
import { processAssistant } from "@/lib/assistant-action";
import { reviewSchema } from "@/lib/voice-approval";
import { detect } from "@/lib/detection";
import type { Transcript } from "@/lib/types";
export const runtime = "nodejs";
export const maxDuration = 60;
const schema = z.object({
  id: z.string().min(1).max(200),
  sessionId: sessionSchema,
  mode: modeSchema,
  text: z.string().trim().min(1).max(6000),
  review: reviewSchema.optional(),
  targetId: z.string().uuid().optional(),
  previousRequest: z.string().max(2000).optional(),
  assistant: z.boolean().default(false),
  speaker: z.string().max(60).default("Conversation"),
  timestamp: z.string().datetime().optional(),
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }),
});
export async function POST(request: Request) {
  try {
    const input = await body(request, schema);
    // Namespace upstream item IDs so two sessions can never overwrite each other's data.
    const id = `${input.sessionId}:${input.mode}:${input.id}`;
    if (getTranscript(id, input.sessionId, input.mode))
      return Response.json(snapshot(input.sessionId, input.mode));
    const previous = snapshot(input.sessionId, input.mode);
    const transcript: Transcript = {
      ...input,
      id,
      detected: false,
      timestamp: input.timestamp ?? new Date().toISOString(),
    };
    save(transcript, input.sessionId, input.mode, "transcript");
    log(input.sessionId, input.mode, "Utterance saved to memory.");
    if (input.assistant) {
      try {
        const response = await processAssistant(
          { ...input, ambient: true },
          request,
        );
        const assistant = await response.json();
        if (assistant.kind !== "conversation")
          return Response.json({
            ...snapshot(input.sessionId, input.mode),
            assistant,
          });
      } catch {
        log(
          input.sessionId,
          input.mode,
          "Request saved, but the assistant couldn’t process it. Please try again.",
          "error",
        );
        return Response.json({
          ...snapshot(input.sessionId, input.mode),
          assistant: {
            kind: "error",
            answer:
              "I saved that, but couldn’t process the request. Please try again.",
            sources: [],
          },
        });
      }
    }
    if (input.mode === "live" && !process.env.OPENROUTER_API_KEY) {
      log(
        input.sessionId,
        input.mode,
        "Detection unavailable. Add OPENROUTER_API_KEY; the transcript is safely saved.",
        "error",
      );
    } else {
      try {
        const proposal = await detect(
          transcript,
          previous.transcripts,
          input.timezone,
        );
        if (proposal) {
          const duplicate =
            input.mode === "live" &&
            previous.proposals.some(
              (p) =>
                p.title.toLowerCase() === proposal.title.toLowerCase() &&
                p.start === proposal.start &&
                p.status !== "dismissed",
            );
          if (!duplicate) {
            save(proposal, input.sessionId, input.mode, "proposal");
            save(
              { ...transcript, detected: true },
              input.sessionId,
              input.mode,
              "transcript",
            );
            log(
              input.sessionId,
              input.mode,
              "Commitment detected. Waiting for your approval.",
              "success",
            );
          }
        } else
          log(
            input.sessionId,
            input.mode,
            "No new commitment. Keeping this for recall.",
          );
      } catch {
        log(
          input.sessionId,
          input.mode,
          "Transcript saved, but detection failed. Check the model and API key.",
          "error",
        );
      }
    }
    return Response.json(snapshot(input.sessionId, input.mode));
  } catch (e) {
    return failure(e);
  }
}
