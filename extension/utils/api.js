const SERVER_URL = "http://localhost:18080";

export async function checkHealth() {
  try {
    const res = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

export async function requestGrouping({ tabs, existingGroups, prompt }) {
  const res = await fetch(`${SERVER_URL}/group`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tabs, existingGroups, prompt }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) return null;
  return res.json();
}
