import { assignGroups } from "./providers/index.ts";
import type { components } from "@zenodotus/api-spec/schema";

type GroupRequest = components["schemas"]["GroupRequest"];

function readMessage(): Promise<GroupRequest> {
  return new Promise((resolve, reject) => {
    const headerBuf: Buffer[] = [];
    let headerLen = 0;

    const onReadable = () => {
      // Read 4-byte header
      if (headerLen < 4) {
        const chunk = process.stdin.read(4 - headerLen) as Buffer | null;
        if (!chunk) return;
        headerBuf.push(chunk);
        headerLen += chunk.length;
        if (headerLen < 4) return;
      }

      const header = Buffer.concat(headerBuf);
      const msgLen = header.readUInt32LE(0);

      if (msgLen === 0 || msgLen > 1024 * 1024) {
        cleanup();
        reject(new Error(`Invalid message length: ${msgLen}`));
        return;
      }

      const body = process.stdin.read(msgLen) as Buffer | null;
      if (!body) return;

      cleanup();
      try {
        resolve(JSON.parse(body.toString("utf-8")));
      } catch (err) {
        reject(err);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("readable", onReadable);
    };

    process.stdin.on("readable", onReadable);
  });
}

function writeMessage(obj: unknown): void {
  const body = Buffer.from(JSON.stringify(obj), "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(header);
  process.stdout.write(body);
}

async function main(): Promise<void> {
  try {
    const request = await readMessage();
    const result = await assignGroups(request);

    if (result) {
      writeMessage(result);
    } else {
      writeMessage({ error: "Failed to parse LLM response" });
    }
  } catch (err) {
    writeMessage({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

main().then(() => process.exit(0));
