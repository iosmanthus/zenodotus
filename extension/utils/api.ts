import type { components } from "@zenodotus/api-spec/schema";

type GroupRequest = components["schemas"]["GroupRequest"];
type GroupResponse = components["schemas"]["GroupResponse"];

const SERVER_URL = "http://localhost:18080";

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

export async function requestGrouping(request: GroupRequest): Promise<GroupResponse | null> {
  try {
    const res = await fetch(`${SERVER_URL}/group`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
