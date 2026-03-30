import SwaggerParser from "@apidevtools/swagger-parser";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const specPath = join(__dirname, "../../packages/api-spec/openapi.yaml");

let resolvedOutputSchema: object | null = null;

export async function getOutputSchema(): Promise<object> {
  if (resolvedOutputSchema) return resolvedOutputSchema;

  const api = await SwaggerParser.dereference(specPath) as any;
  resolvedOutputSchema = api.components.schemas.GroupResponse;
  return resolvedOutputSchema!;
}
