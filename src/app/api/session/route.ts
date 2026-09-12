import { z } from "zod";
import { body, sessionSchema, modeSchema, failure } from "@/lib/http";
import { snapshot, clearSession, sessionCleared } from "@/lib/store";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const sessionId = sessionSchema.parse(params.get("sessionId"));
    if (sessionCleared(sessionId))
      return Response.json(
        { cleared: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    return Response.json(
      snapshot(
        sessionSchema.parse(params.get("sessionId")),
        modeSchema.parse(params.get("mode")),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    const input = await body(
      request,
      z.object({ sessionId: sessionSchema, action: z.literal("clear") }),
    );
    clearSession(input.sessionId);
    return Response.json({ sessionId: crypto.randomUUID() });
  } catch (e) {
    return failure(e);
  }
}
