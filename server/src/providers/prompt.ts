import { spec } from "@zenodotus/api-spec";
import type { components } from "@zenodotus/api-spec/schema";

type GroupRequest = components["schemas"]["GroupRequest"];

const specComponents = (spec as Record<string, unknown>).components as {
  schemas: Record<string, unknown>;
};

// The raw OpenAPI schema for GroupResponse
export const outputSchema = specComponents.schemas.GroupResponse as Record<string, unknown>;

/**
 * Convert an OpenAPI schema to OpenAI structured output format:
 * - All object properties must be in `required`
 * - Optional properties use `anyOf: [{original type}, {type: "null"}]`
 * - All objects must have `additionalProperties: false`
 */
export function toOpenAISchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) return schema;

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === "items" && typeof value === "object" && value !== null) {
      result[key] = toOpenAISchema(value as Record<string, unknown>);
    } else if (key === "properties" && typeof value === "object" && value !== null) {
      const props = value as Record<string, Record<string, unknown>>;
      const originalRequired = (schema.required as string[]) || [];
      const allKeys = Object.keys(props);
      const convertedProps: Record<string, unknown> = {};

      for (const [propName, propSchema] of Object.entries(props)) {
        const converted = toOpenAISchema(propSchema);
        if (!originalRequired.includes(propName)) {
          // Optional field → wrap in anyOf with null
          convertedProps[propName] = {
            anyOf: [converted, { type: "null" }],
            ...(propSchema.description ? { description: propSchema.description } : {}),
          };
        } else {
          convertedProps[propName] = converted;
        }
      }

      result.properties = convertedProps;
      result.required = allKeys;
      result.additionalProperties = false;
    } else if (key === "required") {
      // handled above with properties
    } else {
      result[key] = value;
    }
  }

  return result;
}

// Pre-computed OpenAI-compatible schema
export const openAIOutputSchema = toOpenAISchema(outputSchema);

export const SYSTEM_PROMPT = [
  "You are a browser tab grouping assistant.",
  "Assign tabs to groups based on their URL, title, and description.",
  "",
  "Rules:",
  "1. Prefer assigning tabs to existing groups when relevant.",
  "2. Only create new groups when no existing group fits.",
  "3. Keep group names short (2-4 words).",
  "4. Reuse exact existing group names. Do not create spelling or casing variants",
  "5. Tabs that do not fit any group should be omitted from the response.",
].join("\n");

export function buildUserPrompt(request: GroupRequest): string {
  const parts: string[] = [];
  if (request.prompt) {
    parts.push(request.prompt);
  }
  if (request.existingGroups && request.existingGroups.length > 0) {
    parts.push(`Existing groups:\n${JSON.stringify(request.existingGroups)}`);
  }
  parts.push(`Tabs to group:\n${JSON.stringify(request.tabs)}`);
  return parts.join("\n\n");
}

export function buildFullPrompt(request: GroupRequest): string {
  return [SYSTEM_PROMPT, buildUserPrompt(request)].join("\n\n");
}
