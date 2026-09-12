import { assertSessionActive } from "@/lib/store";
import { body, failure, HttpError, sessionSchema } from "@/lib/http";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    const input = await body(request, z.object({ sessionId: sessionSchema }));
    assertSessionActive(input.sessionId);
    if (!process.env.OPENAI_API_KEY)
      throw new HttpError(
        503,
        "Add OPENAI_API_KEY to .env.local to enable the microphone. You can try the demo now.",
      );
    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expires_after: { anchor: "created_at", seconds: 60 },
          session: {
            type: "transcription",
            audio: {
              input: {
                transcription: {
                  model:
                    process.env.OPENAI_TRANSCRIPTION_MODEL ||
                    "gpt-transcribe",
                },
                noise_reduction: { type: "near_field" },
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 650,
                },
              },
            },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw new HttpError(
        502,
        `OpenAI could not start transcription (${response.status}). Check your key, billing, and transcription model access.`,
      );
    const token = await response.json();
    if (typeof token.value !== "string")
      throw new HttpError(
        502,
        "OpenAI returned an unexpected session response.",
      );
    return Response.json(
      { value: token.value },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
