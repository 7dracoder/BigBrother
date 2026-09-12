import { calendarConfigured } from "@/lib/calendar";
export async function GET() {
  return Response.json(
    {
      transcription: Boolean(process.env.OPENAI_API_KEY),
      detection: Boolean(process.env.OPENROUTER_API_KEY),
      calendar: calendarConfigured(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
