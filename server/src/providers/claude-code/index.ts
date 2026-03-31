import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { components } from "@zenodotus/api-spec/schema";
import { buildFullPrompt, outputSchema } from "../prompt";

const execFileAsync = promisify(execFile);

type GroupRequest = components["schemas"]["GroupRequest"];
type GroupResponse = components["schemas"]["GroupResponse"];

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
