import type { GroupRequest, TabInfo } from "@zenodotus/api-spec";

function stripQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return url;
  }
}

export const SYSTEM_PROMPT = [
  "You are a browser tab grouping assistant.",
  "Assign tabs to groups based on their URL, title, and description.",
  "",
  "Rules:",
  "1. Keep group names short (3 words max).",
  "2. When no existing groups are provided, freely create groups based on tab content.",
  "3. Reuse existing group names when a tab fits — do not create spelling or casing variants.",
  "4. When a tab does not fit any existing group, create a new group for it. Only omit tabs that are completely unclassifiable (e.g. blank pages).",
  "5. Existing groups show current tab-to-group assignments, but these may be stale. Decide each tab's group based solely on its current URL, title, and description. Move tabs to a different group if their content no longer fits.",
].join("\n");

function compactTab(tab: TabInfo): Record<string, unknown> {
  const result: Record<string, unknown> = {
    tabId: tab.tabId,
    url: stripQuery(tab.url),
    title: tab.title,
  };
  if (tab.description) {
    result.desc = tab.description;
  }
  return result;
}

export function buildUserPrompt(request: GroupRequest): string {
  const parts: string[] = [];
  if (request.prompt) {
    parts.push(request.prompt);
  }
  if (request.existingGroups && request.existingGroups.length > 0) {
    parts.push(`Existing groups:\n${JSON.stringify(request.existingGroups)}`);
  }
  parts.push(`Tabs to group:\n${JSON.stringify(request.tabs.map(compactTab))}`);
  return parts.join("\n\n");
}

export function buildFullPrompt(request: GroupRequest): string {
  return [SYSTEM_PROMPT, buildUserPrompt(request)].join("\n\n");
}
