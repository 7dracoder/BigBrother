import { connectCalendar } from "../src/lib/calendar";
import { brain } from "../src/lib/detection";
try {
  process.loadEnvFile(".env.local");
} catch {
  /* Environment variables can also be set by the shell. */
}
console.log("Integration check — secret values are never printed.");
console.log(
  `OpenAI key: ${process.env.OPENAI_API_KEY ? "configured (microphone must be tested in browser)" : "missing"}`,
);
if (process.env.OPENROUTER_API_KEY) {
  try {
    const result = await brain(
      "connection-check",
      "Reply with the word ready.",
    ).generate("Connection check.");
    console.log(
      `OpenRouter: ${result.text.trim() ? "model call succeeded" : "empty response"}`,
    );
  } catch {
    console.log(
      "OpenRouter: model call failed. Check the key, credits, and OPENROUTER_MODEL.",
    );
    process.exitCode = 1;
  }
} else console.log("OpenRouter: missing key.");
if (process.env.AMBIGUOUS_MCP_URL && process.env.AMBIGUOUS_API_KEY) {
  let client;
  try {
    client = await connectCalendar();
    const { tools } = await client.listTools();
    const calendar = tools.filter((t) =>
      /calendar|create.?event/i.test(t.name),
    );
    console.log("Ambiguous calendar tools (read-only discovery):");
    console.log(
      JSON.stringify(
        calendar.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
        null,
        2,
      ),
    );
    if (!calendar.length)
      console.log("No calendar tools found. Check the workspace permissions.");
  } catch {
    console.log(
      "Ambiguous: connection failed. Check endpoint, key, and permissions.",
    );
    process.exitCode = 1;
  } finally {
    await client?.close().catch(() => {});
  }
} else console.log("Ambiguous: missing URL or key.");
