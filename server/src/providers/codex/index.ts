import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { components } from "@zenodotus/api-spec/schema";
import { buildFullPrompt } from "../prompt";
import { openAIOutputSchema } from "./schema";

const execFileAsync = promisify(execFile);

type GroupRequest = components["schemas"]["GroupRequest"];
type GroupResponse = components["schemas"]["GroupResponse"];

export async function assignGroups(request: GroupRequest): Promise<GroupResponse | null> {
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

    await execFileAsync("codex", args, { timeout: 60000 });

    const output = readFileSync(outputPath, "utf-8");
    if (!output.trim()) return null;
    const parsed = JSON.parse(output) as GroupResponse;
    // OpenAI returns null for optional fields; strip so applyGrouping treats as absent
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
