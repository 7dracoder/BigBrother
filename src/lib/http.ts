import { z } from "zod";
export const sessionSchema = z.string().uuid();
export const modeSchema = z.enum(["live", "demo"]);
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  // Next's internal request URL may use localhost when the browser uses 127.0.0.1.
  // Compare against the actual inbound Host instead of that rewritten hostname.
  const target = new URL(request.url);
  const host = request.headers.get("host") || target.host;
  if (
    origin &&
    (new URL(origin).host !== host ||
      new URL(origin).protocol !== target.protocol)
  )
    throw new HttpError(403, "Cross-origin requests are not allowed.");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new HttpError(403, "Cross-origin requests are not allowed.");
}
export async function body<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  sameOrigin(request);
  const raw = await request.text();
  if (raw.length > 24_000)
    throw new HttpError(413, "This request is too large.");
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    throw new HttpError(400, "Please check the request fields and try again.");
  }
}
export function failure(error: unknown) {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError)
    return Response.json({ error: "Invalid request." }, { status: 400 });
  // Provider responses may include credentials or private transcripts. Do not echo them.
  console.error(
    "BigBrother request failed:",
    error instanceof Error ? error.name : "UnknownError",
  );
  return Response.json(
    {
      error:
        "The service could not complete this request. Check the connection and configuration, then try again.",
    },
    { status: 500 },
  );
}
