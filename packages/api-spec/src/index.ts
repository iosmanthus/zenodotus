import SwaggerParser from "@apidevtools/swagger-parser";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenAPIV3 } from "openapi-types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const specPath = join(__dirname, "../openapi.yaml");

let cached: OpenAPIV3.Document | null = null;

export async function loadSpec(): Promise<OpenAPIV3.Document> {
  if (cached) return cached;
  cached = (await SwaggerParser.dereference(specPath)) as OpenAPIV3.Document;
  return cached;
}

export function getSpecPath(): string {
  return specPath;
}
