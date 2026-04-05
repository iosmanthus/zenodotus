import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GroupRequest, GroupResponse } from "@zenodotus/api-spec";
import { buildFullPrompt } from "../prompt";

const execFileAsync = promisify(execFile);

const outputSchema = {
  type: "object",
  required: ["groups"],
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        required: ["tabIds"],
        properties: {
          groupId: {
            type: "integer",
            description: "ID of an existing group. Omit to create a new group.",
          },
          name: {
            type: "string",
            description: "Name for the group. Required when creating a new group.",
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

export async function assignGroups(request: GroupRequest): Promise<GroupResponse | null> {
  const fullPrompt = buildFullPrompt(request);

  const args = [
    "--print",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(outputSchema),
  ];

  args.push("--model", request.model || "sonnet");

  args.push("-p", fullPrompt);

  try {
    const { stdout } = await execFileAsync("claude", args, { timeout: 60000 });
    const parsed = JSON.parse(stdout);
    if (parsed.structured_output) {
      return parsed.structured_output as GroupResponse;
    }
    return null;
  } catch (err) {
    console.error("[claude-code] error:", err);
    return null;
  }
}
