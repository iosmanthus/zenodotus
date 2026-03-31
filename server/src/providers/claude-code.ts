import { query } from "@anthropic-ai/claude-agent-sdk";
import type { components } from "@zenodotus/api-spec/schema";
import { buildFullPrompt, openAIOutputSchema } from "./prompt";

type GroupRequest = components["schemas"]["GroupRequest"];
type GroupResponse = components["schemas"]["GroupResponse"];

export async function assignGroups(request: GroupRequest): Promise<GroupResponse | null> {
  const fullPrompt = buildFullPrompt(request);

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 30000);

  try {
    for await (const event of query({
      prompt: fullPrompt,
      options: {
        model: request.model || "sonnet",
        thinking: request.thinking ? { type: "enabled" } : { type: "disabled" },
        maxTurns: 3,
        persistSession: false,
        abortController,
        outputFormat: {
          type: "json_schema",
          schema: openAIOutputSchema,
        },
      },
    })) {
      if (event.type === "result" && event.subtype === "success") {
        const output = (event as Record<string, unknown>).structured_output;
        if (output) {
          return output as GroupResponse;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  return null;
}
