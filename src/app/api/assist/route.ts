import { z } from "zod";
import {
  body,
  failure,
  HttpError,
  modeSchema,
  sessionSchema,
} from "@/lib/http";
import { processAssistant } from "@/lib/assistant-action";
import { reviewSchema } from "@/lib/voice-approval";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const input = await body(
      request,
      z.object({
        sessionId: sessionSchema,
        mode: modeSchema,
        text: z.string().trim().min(1).max(2000),
        previousRequest: z.string().max(2000).optional(),
        targetId: z.string().uuid().optional(),
        review: reviewSchema.optional(),
        timezone: z.string().refine((v) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: v });
            return true;
          } catch {
            return false;
          }
        }),
      }),
    );
    return await processAssistant(input, request);
  } catch (e) {
    return failure(e);
  }
}
