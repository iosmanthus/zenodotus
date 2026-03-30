import { query } from "@anthropic-ai/claude-agent-sdk";
import { getOutputSchema } from "../schema.js";
import type { components } from "@zenodotus/api-spec/schema";

type GroupRequest = components["schemas"]["GroupRequest"];
type GroupResponse = components["schemas"]["GroupResponse"];

const SYSTEM_PROMPT = [
  "You are a browser tab grouping assistant.",
  "Assign tabs to groups based on their URL, title, and description.",
  "",
  "Rules:",
  "1. Prefer assigning tabs to existing groups when relevant.",
  "2. Only create new groups when no existing group fits.",
  "3. Keep group names short (2-4 words).",
  "4. Tabs that do not fit any group should be omitted from the response.",
].join("\n");

function buildUserPrompt(request: GroupRequest): string {
  const parts: string[] = [];
  if (request.prompt) {
    parts.push(request.prompt);
  }
  if (request.existingGroups && request.existingGroups.length > 0) {
    parts.push("Existing groups:\n" + JSON.stringify(request.existingGroups, null, 2));
  }
  parts.push("Tabs to group:\n" + JSON.stringify(request.tabs, null, 2));
  return parts.join("\n\n");
}

export async function assignGroups(request: GroupRequest): Promise<GroupResponse | null> {
  const outputSchema = await getOutputSchema();

  const outputInstruction = [
    "Respond with ONLY a JSON object matching this schema:",
    JSON.stringify(outputSchema, null, 2),
    "",
    "No other text. Only the JSON object.",
  ].join("\n");

  const userPrompt = buildUserPrompt(request);
  const fullPrompt = [SYSTEM_PROMPT, userPrompt, outputInstruction].join("\n\n");

  const events = [];
  for await (const event of query({
    prompt: fullPrompt,
    options: {
      maxTurns: 1,
      allowedTools: [],
      persistSession: false,
    },
  })) {
    events.push(event);
  }

  for (const event of events) {
    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "text") {
          const jsonMatch = block.text.match(/\{[\s\S]*"groups"[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]) as GroupResponse;
          }
        }
      }
    }
  }

  return null;
}
