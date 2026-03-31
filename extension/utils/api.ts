import type { components } from "@zenodotus/api-spec/schema";

type GroupRequest = components["schemas"]["GroupRequest"];
type GroupResponse = components["schemas"]["GroupResponse"];

const DEFAULT_SERVER_URL = "http://localhost:18080";

async function getServerUrl(): Promise<string> {
  const { serverUrl } = await chrome.storage.local.get({ serverUrl: DEFAULT_SERVER_URL });
  return serverUrl || DEFAULT_SERVER_URL;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const url = await getServerUrl();
    const res = await fetch(`${url}/health`, {
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
    const url = await getServerUrl();
    const res = await fetch(`${url}/group`, {
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
