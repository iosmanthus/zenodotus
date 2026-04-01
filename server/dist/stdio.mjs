#!/usr/bin/env node

// src/providers/claude-code/index.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// src/providers/prompt.ts
import { spec } from "@zenodotus/api-spec";
var specComponents = spec.components;
var outputSchema = specComponents.schemas.GroupResponse;
var SYSTEM_PROMPT = [
  "You are a browser tab grouping assistant.",
  "Assign tabs to groups based on their URL, title, and description.",
  "",
  "Rules:",
  "1. Prefer assigning tabs to existing groups when relevant.",
  "2. Only create new groups when no existing group fits.",
  "3. Keep group names short (2-4 words).",
  "4. Reuse exact existing group names. Do not create spelling or casing variants",
  "5. Tabs that do not fit any group should be omitted from the response."
].join("\n");
function buildUserPrompt(request) {
  const parts = [];
  if (request.prompt) {
    parts.push(request.prompt);
  }
  if (request.existingGroups && request.existingGroups.length > 0) {
    parts.push(`Existing groups:
${JSON.stringify(request.existingGroups)}`);
  }
  parts.push(`Tabs to group:
${JSON.stringify(request.tabs)}`);
  return parts.join("\n\n");
}
function buildFullPrompt(request) {
  return [SYSTEM_PROMPT, buildUserPrompt(request)].join("\n\n");
}

// src/providers/claude-code/index.ts
var execFileAsync = promisify(execFile);
async function assignGroups(request) {
  const fullPrompt = buildFullPrompt(request);
  const args = [
    "--print",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(outputSchema)
  ];
  args.push("--model", request.model || "sonnet");
  args.push("-p", fullPrompt);
  try {
    const { stdout } = await execFileAsync("claude", args, { timeout: 6e4 });
    const parsed = JSON.parse(stdout);
    if (parsed.structured_output) {
      return parsed.structured_output;
    }
    return null;
  } catch (err) {
    console.error("[claude-code] error:", err);
    return null;
  }
}

// src/providers/codex/index.ts
import { execFile as execFile2 } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify as promisify2 } from "node:util";

// src/providers/codex/schema.ts
function toOpenAISchema(schema) {
  if (typeof schema !== "object" || schema === null) return schema;
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "items" && typeof value === "object" && value !== null) {
      result[key] = toOpenAISchema(value);
    } else if (key === "properties" && typeof value === "object" && value !== null) {
      const props = value;
      const originalRequired = schema.required || [];
      const allKeys = Object.keys(props);
      const convertedProps = {};
      for (const [propName, propSchema] of Object.entries(props)) {
        const converted = toOpenAISchema(propSchema);
        if (!originalRequired.includes(propName)) {
          convertedProps[propName] = {
            anyOf: [converted, { type: "null" }],
            ...propSchema.description ? { description: propSchema.description } : {}
          };
        } else {
          convertedProps[propName] = converted;
        }
      }
      result.properties = convertedProps;
      result.required = allKeys;
      result.additionalProperties = false;
    } else if (key === "required") {
    } else {
      result[key] = value;
    }
  }
  return result;
}
var openAIOutputSchema = toOpenAISchema(outputSchema);

// src/providers/codex/index.ts
var execFileAsync2 = promisify2(execFile2);
async function assignGroups2(request) {
  const fullPrompt = buildFullPrompt(request);
  const tmpDir = mkdtempSync(join(tmpdir(), "zenodotus-"));
  const schemaPath = join(tmpDir, "schema.json");
  writeFileSync(schemaPath, JSON.stringify(openAIOutputSchema));
  const outputPath = join(tmpDir, "output.json");
  try {
    const args = ["exec", "--ephemeral", "--output-schema", schemaPath, "-o", outputPath];
    if (request.model) {
      args.push("-m", request.model);
    }
    args.push(fullPrompt);
    await execFileAsync2("codex", args, { timeout: 6e4 });
    const output = readFileSync(outputPath, "utf-8");
    if (!output.trim()) return null;
    const parsed = JSON.parse(output);
    for (const group of parsed.groups) {
      if (group.groupId == null) delete group.groupId;
      if (group.name == null) delete group.name;
    }
    return parsed;
  } catch (err) {
    console.error("[codex] error:", err);
    return null;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// src/providers/index.ts
var DEFAULT_PROVIDER = process.env.PROVIDER || "claude-code";
async function assignGroups3(request) {
  const provider = request.provider;
  const selected = provider || DEFAULT_PROVIDER;
  switch (selected) {
    case "codex":
      return assignGroups2(request);
    case "claude-code":
    default:
      return assignGroups(request);
  }
}

// src/stdio.ts
function readMessage() {
  return new Promise((resolve, reject) => {
    const headerBuf = [];
    let headerLen = 0;
    const bodyBuf = [];
    let bodyLen = 0;
    let msgLen = 0;
    let headerDone = false;
    const onReadable = () => {
      while (headerLen < 4) {
        const chunk = process.stdin.read(4 - headerLen);
        if (!chunk) return;
        headerBuf.push(chunk);
        headerLen += chunk.length;
      }
      if (!headerDone) {
        const header = Buffer.concat(headerBuf);
        msgLen = header.readUInt32LE(0);
        headerDone = true;
        if (msgLen === 0 || msgLen > 1024 * 1024) {
          cleanup();
          reject(new Error(`Invalid message length: ${msgLen}`));
          return;
        }
      }
      while (bodyLen < msgLen) {
        const chunk = process.stdin.read(msgLen - bodyLen);
        if (!chunk) return;
        bodyBuf.push(chunk);
        bodyLen += chunk.length;
      }
      cleanup();
      try {
        const body = Buffer.concat(bodyBuf);
        resolve(JSON.parse(body.toString("utf-8")));
      } catch (err) {
        reject(err);
      }
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("stdin closed before a complete message was received"));
    };
    const cleanup = () => {
      process.stdin.removeListener("readable", onReadable);
      process.stdin.removeListener("end", onEnd);
    };
    process.stdin.on("readable", onReadable);
    process.stdin.on("end", onEnd);
  });
}
function writeMessage(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(header);
  process.stdout.write(body);
}
async function main() {
  try {
    const request = await readMessage();
    const result = await assignGroups3(request);
    if (result) {
      writeMessage(result);
    } else {
      writeMessage({ error: "Failed to parse LLM response" });
    }
  } catch (err) {
    writeMessage({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}
main().then(() => process.exit(0)).catch(() => process.exit(1));
