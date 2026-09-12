import { z } from "zod";
export const attendeeSchema = z.string().trim().toLowerCase().email().max(254);
export const attendeesSchema = z.array(attendeeSchema).max(30);
export function normalizeAttendees(values: string[]) {
  return [...new Set(attendeesSchema.parse(values))];
}
export function extractEmails(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/\bat sign\b/g, "@")
    .replace(/\b(?:[a-z]\s+){2,}[a-z](?=\s+(?:at|dot)|\s*@)/g, (s) =>
      s.replace(/\s/g, ""),
    )
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+(?:underscore)\s+/g, "_")
    .replace(/\s+(?:dash|hyphen)\s+/g, "-")
    .replace(/\s*@\s*/g, "@");
  const found =
    normalized.match(
      /[a-z0-9][a-z0-9._%+-]*@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}\b/g,
    ) ?? [];
  const emailContext =
    /\b(email|e-mail|contact|invite|participant|attendee|add)\b/i.test(text);
  return [
    ...new Set(
      found.filter(
        (s) =>
          attendeeSchema.safeParse(s).success &&
          (text.toLowerCase().includes(s) ||
            emailContext ||
            normalized.trim().replace(/[.!?]+$/, "") === s),
      ),
    ),
  ];
}
export function mergeAttendeeIdentifiers(
  existing: unknown,
  additions: string[],
): string[] {
  if (!Array.isArray(existing))
    throw new Error("Could not read existing participants.");
  const ids = existing.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      for (const key of ["email", "user_id", "id"])
        if (typeof item[key] === "string" && item[key])
          return item[key] as string;
    }
    throw new Error("An existing participant could not be preserved.");
  });
  const seen = new Set<string>();
  return [...ids, ...normalizeAttendees(additions)].filter((id) => {
    const key = id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function attendeeEmails(existing: unknown): string[] {
  if (!Array.isArray(existing)) return [];
  return [
    ...new Set(
      existing
        .map((v) => (typeof v === "string" ? v : v?.email))
        .filter(
          (v): v is string =>
            typeof v === "string" && attendeeSchema.safeParse(v).success,
        )
        .map((v) => v.toLowerCase()),
    ),
  ];
}
