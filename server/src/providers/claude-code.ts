import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { components } from "@zenodotus/api-spec/schema";
import { z } from "zod";

type GroupRequest = components["schemas"]["GroupRequest"];
type GroupResponse = components["schemas"]["GroupResponse"];

const SYSTEM_PROMPT = [
  "You are a browser tab grouping assistant.",
  "Assign tabs to groups based on their URL, title, and description.",
  "",
  "Rules:",
  "1. Prefer assigning tabs to existing groups when relevant.",
  "2. Only create new groups when no existing group fits.",
  "3. Keep group names short (2-4 words).",
  "4. Tabs that do not fit any group should be omitted from the response.",
  "",
  "Use the assign_tab_groups tool to respond.",
].join("\n");

function buildUserPrompt(request: GroupRequest): string {
  const parts: string[] = [];
  if (request.prompt) {
    parts.push(request.prompt);
  }
  if (request.existingGroups && request.existingGroups.length > 0) {
    parts.push(`Existing groups:\n${JSON.stringify(request.existingGroups, null, 2)}`);
  }
  parts.push(`Tabs to group:\n${JSON.stringify(request.tabs, null, 2)}`);
  return parts.join("\n\n");
}

export async function assignGroups(request: GroupRequest): Promise<GroupResponse | null> {
  let captured: GroupResponse | null = null;

  const assignTool = tool(
    "assign_tab_groups",
    "Assign browser tabs to groups based on their content and context.",
    {
      groups: z.array(
        z.object({
          groupId: z
            .number()
            .optional()
            .describe("ID of an existing group. Omit to create a new group."),
          name: z
            .string()
            .optional()
            .describe("Name for the group. Required when creating a new group."),
          tabIds: z.array(z.number()).describe("Tab IDs to assign to this group."),
        }),
      ),
    },
    async (args) => {
      captured = { groups: args.groups };
      return { content: [{ type: "text" as const, text: "Groups assigned." }] };
    },
  );

  const mcpServer = createSdkMcpServer({
    name: "zenodotus",
    tools: [assignTool],
  });

  const userPrompt = buildUserPrompt(request);
  const fullPrompt = [SYSTEM_PROMPT, userPrompt].join("\n\n");

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 30000);

  try {
    for await (const _event of query({
      prompt: fullPrompt,
      options: {
        maxTurns: 1,
        disallowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        mcpServers: { zenodotus: mcpServer },
        persistSession: false,
        abortController,
      },
    })) {
      // drain events
    }
  } finally {
    clearTimeout(timeout);
  }

  return captured;
}
