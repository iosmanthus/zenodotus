import SwaggerParser from "@apidevtools/swagger-parser";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const specPath = join(__dirname, "../openapi.yaml");
const outPath = join(__dirname, "../generated/openapi.json");

const spec = await SwaggerParser.dereference(specPath);
writeFileSync(outPath, JSON.stringify(spec, null, 2));
console.log(`Resolved spec → ${outPath}`);
