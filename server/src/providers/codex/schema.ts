import { outputSchema } from "../prompt";

/**
 * Convert OpenAPI JSON Schema to OpenAI structured output format:
 * - All object properties must be in `required`
 * - Optional properties use `anyOf: [{original type}, {type: "null"}]`
 * - All objects must have `additionalProperties: false`
 */
function toOpenAISchema(schema: Record<string, unknown>): Record<string, unknown> {
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

export const openAIOutputSchema = toOpenAISchema(outputSchema);
