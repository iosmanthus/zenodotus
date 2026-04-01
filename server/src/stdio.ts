import { assignGroups } from "./providers/index.ts";
import type { components } from "@zenodotus/api-spec/schema";

type GroupRequest = components["schemas"]["GroupRequest"];

function readMessage(): Promise<GroupRequest> {
  return new Promise((resolve, reject) => {
    const headerBuf: Buffer[] = [];
    let headerLen = 0;
    const bodyBuf: Buffer[] = [];
    let bodyLen = 0;
    let msgLen = 0;
    let headerDone = false;

    const onReadable = () => {
      // Read 4-byte header
      while (headerLen < 4) {
        const chunk = process.stdin.read(4 - headerLen) as Buffer | null;
        if (!chunk) return;
        headerBuf.push(chunk);
        headerLen += chunk.length;
      }

      if (!headerDone) {
        const header = Buffer.concat(headerBuf);
        msgLen = header.readUInt32LE(0);
        headerDone = true;

        if (msgLen === 0 || msgLen > 1024 * 1024) {
          cleanup();
          reject(new Error(`Invalid message length: ${msgLen}`));
          return;
        }
      }

      // Read body, accumulating partial chunks
      while (bodyLen < msgLen) {
        const chunk = process.stdin.read(msgLen - bodyLen) as Buffer | null;
        if (!chunk) return;
        bodyBuf.push(chunk);
        bodyLen += chunk.length;
      }

      cleanup();
      try {
        const body = Buffer.concat(bodyBuf);
        resolve(JSON.parse(body.toString("utf-8")));
      } catch (err) {
        reject(err);
      }
    };

    const onEnd = () => {
      cleanup();
      reject(new Error("stdin closed before a complete message was received"));
    };

    const cleanup = () => {
      process.stdin.removeListener("readable", onReadable);
      process.stdin.removeListener("end", onEnd);
    };

    process.stdin.on("readable", onReadable);
    process.stdin.on("end", onEnd);
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

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(String(err) + "\n");
    process.exit(1);
  });
