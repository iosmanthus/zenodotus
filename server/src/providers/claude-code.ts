import { query } from "@anthropic-ai/claude-agent-sdk";
import { spec } from "@zenodotus/api-spec";
import type { components } from "@zenodotus/api-spec/schema";
import { buildFullPrompt } from "./prompt";

type GroupRequest = components["schemas"]["GroupRequest"];
type GroupResponse = components["schemas"]["GroupResponse"];

const outputSchema = (spec as Record<string, unknown>).components as {
  schemas: Record<string, unknown>;
};

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
          schema: outputSchema.schemas.GroupResponse as Record<string, unknown>,
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
