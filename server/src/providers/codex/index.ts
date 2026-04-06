import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { GroupRequest, GroupResponse } from "@zenodotus/api-spec";
import { buildFullPrompt } from "../prompt";

const execFileAsync = promisify(execFile);

/**
 * OpenAI structured output schema for GroupResponse.
 *
 * OpenAI requires:
 * - All object properties listed in `required`
 * - Optional properties wrapped in `anyOf: [{type}, {type: "null"}]`
 * - All objects have `additionalProperties: false`
 */
const outputSchema = {
  type: "object",
  required: ["groups"],
  additionalProperties: false,
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        required: ["groupId", "name", "tabIds"],
        additionalProperties: false,
        properties: {
          groupId: {
            anyOf: [
              {
                type: "integer",
                description: "ID of an existing group. Omit to create a new group.",
              },
              { type: "null" },
            ],
          },
          name: {
            anyOf: [
              {
                type: "string",
                description: "Name for the group. Required when creating a new group.",
              },
              { type: "null" },
            ],
          },
          tabIds: {
            type: "array",
            items: { type: "integer" },
            description: "Tab IDs to assign to this group",
          },
        },
      },
    },
  },
};

export async function assignGroups(request: GroupRequest): Promise<GroupResponse> {
  const fullPrompt = buildFullPrompt(request);

  const tmpDir = mkdtempSync(join(tmpdir(), "zenodotus-"));
  const schemaPath = join(tmpDir, "schema.json");
  writeFileSync(schemaPath, JSON.stringify(outputSchema));

  const outputPath = join(tmpDir, "output.json");

  try {
    const args = ["exec", "--ephemeral", "--output-schema", schemaPath, "-o", outputPath];

    if (request.model) {
      args.push("-m", request.model);
    }

    args.push(fullPrompt);

    await execFileAsync("codex", args, { timeout: 60000 }).catch((err) => {
      throw new Error(`codex CLI failed: ${err instanceof Error ? err.message : err}`);
    });

    const output = readFileSync(outputPath, "utf-8");
    if (!output.trim()) throw new Error("codex returned empty output");
    const parsed = JSON.parse(output) as GroupResponse;
    // OpenAI returns null for optional fields; strip so applyGrouping treats as absent
    for (const group of parsed.groups) {
      if (group.groupId == null) delete group.groupId;
      if (group.name == null) delete group.name;
    }
    return parsed;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
