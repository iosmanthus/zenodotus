import type { GroupRequest } from "@zenodotus/api-spec";
import { assignGroups } from "./providers/index.ts";
import { readMessage, writeMessage } from "./server-io.ts";

async function main(): Promise<void> {
  try {
    const request = (await readMessage(process.stdin)) as GroupRequest;
    const result = await assignGroups(request);
    writeMessage(process.stdout, result);
  } catch (err) {
    writeMessage(process.stdout, {
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
