import { appendFileSync } from "node:fs";
import type { GroupRequest, GroupResponse } from "@zenodotus/api-spec";
import { assignGroups as claudeAssign } from "./claude-code";
import { assignGroups as codexAssign } from "./codex";
import { buildFullPrompt } from "./prompt";

export type Provider = "claude-code" | "codex";

const DEFAULT_PROVIDER: Provider = (process.env.PROVIDER as Provider) || "claude-code";
const LOG_FILE = "/tmp/zenodotus.log";

function logToFile(label: string, data: unknown): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${label}: ${JSON.stringify(data, null, 2)}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // ignore
  }
}

export async function assignGroups(request: GroupRequest): Promise<GroupResponse | null> {
  const provider = request.provider as Provider | undefined;
  const selected = provider || DEFAULT_PROVIDER;

  logToFile("provider", selected);
  logToFile("request", { tabs: request.tabs.length, existingGroups: request.existingGroups?.length ?? 0, model: request.model, prompt: request.prompt });
  logToFile("full_prompt", buildFullPrompt(request));

  let result: GroupResponse | null;
  switch (selected) {
    case "codex":
      result = await codexAssign(request);
      break;
    case "claude-code":
    default:
      result = await claudeAssign(request);
      break;
  }

  logToFile("response", result);
  return result;
}
