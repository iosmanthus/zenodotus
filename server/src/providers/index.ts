import type { components } from "@zenodotus/api-spec/schema";
import { assignGroups as claudeAssign } from "./claude-code";
import { assignGroups as codexAssign } from "./codex";

type GroupRequest = components["schemas"]["GroupRequest"];
type GroupResponse = components["schemas"]["GroupResponse"];

export type Provider = "claude-code" | "codex";

const DEFAULT_PROVIDER: Provider = (process.env.PROVIDER as Provider) || "claude-code";

export async function assignGroups(request: GroupRequest): Promise<GroupResponse | null> {
  const provider = (request as Record<string, unknown>).provider as Provider | undefined;
  const selected = provider || DEFAULT_PROVIDER;

  switch (selected) {
    case "codex":
      return codexAssign(request);
    case "claude-code":
    default:
      return claudeAssign(request);
  }
}
