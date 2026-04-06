export function readMessage(input: NodeJS.ReadableStream): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const headerBuf: Buffer[] = [];
    let headerLen = 0;
    const bodyBuf: Buffer[] = [];
    let bodyLen = 0;
    let msgLen = 0;
    let headerDone = false;

    const onReadable = () => {
      while (headerLen < 4) {
        const chunk = (input as NodeJS.ReadableStream & { read(size: number): Buffer | null }).read(
          4 - headerLen,
        ) as Buffer | null;
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

      while (bodyLen < msgLen) {
        const chunk = (input as NodeJS.ReadableStream & { read(size: number): Buffer | null }).read(
          msgLen - bodyLen,
        ) as Buffer | null;
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
      input.removeListener("readable", onReadable);
      input.removeListener("end", onEnd);
    };

    input.on("readable", onReadable);
    input.on("end", onEnd);
  });
}

export function writeMessage(output: NodeJS.WritableStream, obj: unknown): void {
  const body = Buffer.from(JSON.stringify(obj), "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  output.write(header);
  output.write(body);
}

export function encodeMessage(obj: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(obj), "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
