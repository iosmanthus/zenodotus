import { query } from "@anthropic-ai/claude-code";

const SYSTEM_PROMPT = `You are a browser tab grouping assistant. Assign tabs to groups based on their URL, title, and description.

Rules:
1. Prefer assigning tabs to existing groups when relevant.
2. Only create new groups when no existing group fits.
3. Keep group names short (2-4 words).
4. Tabs that do not fit any group should be omitted from the response.`;

function buildUserPrompt({ tabs, existingGroups, prompt }) {
  let msg = "";
  if (prompt) {
    msg += prompt + "\n\n";
  }
  if (existingGroups.length > 0) {
    msg += "Existing groups:\n" + JSON.stringify(existingGroups, null, 2) + "\n\n";
  }
  msg += "Tabs to group:\n" + JSON.stringify(tabs, null, 2);
  return msg;
}

export async function assignGroups({ tabs, existingGroups, prompt }) {
  const userPrompt = buildUserPrompt({ tabs, existingGroups, prompt });
  const fullPrompt = `${SYSTEM_PROMPT}\n\n${userPrompt}\n\nRespond with ONLY a JSON object in this exact format, no other text:\n{"groups": [{"groupId": 123, "tabIds": [1, 2]}, {"name": "New Group", "tabIds": [3]}]}\n\nWhere groupId is used for existing groups, and name is used for new groups.`;

  const events = [];
  for await (const event of query({
    prompt: fullPrompt,
    options: {
      maxTurns: 1,
      allowedTools: [],
    },
  })) {
    events.push(event);
  }

  for (const event of events) {
    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "text") {
          const jsonMatch = block.text.match(/\{[\s\S]*"groups"[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        }
      }
    }
  }

  return null;
}
