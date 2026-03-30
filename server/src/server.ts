import http from "node:http";
import { assignGroups } from "./providers/claude-code.js";
import type { components } from "@zenodotus/api-spec/schema";

type GroupRequest = components["schemas"]["GroupRequest"];

const PORT = 18080;

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

async function handleGroup(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body = "";
  for await (const chunk of req) body += chunk;

  let parsed: GroupRequest;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  if (!Array.isArray(parsed.tabs)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "tabs must be an array" }));
    return;
  }

  try {
    const result = await assignGroups(parsed);

    if (!result) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to parse LLM response" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error("LLM error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "LLM request failed" }));
  }
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url!, `http://localhost:${PORT}`);

  if (url.pathname === "/health" && req.method === "GET") {
    handleHealth(req, res);
    return;
  }

  if (url.pathname === "/group" && req.method === "POST") {
    handleGroup(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`Zenodotus server listening on http://localhost:${PORT}`);
});
