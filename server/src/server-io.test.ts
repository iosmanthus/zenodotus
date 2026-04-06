import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { encodeMessage, readMessage, writeMessage } from "./server-io";

describe("NMH message framing", () => {
  it("readMessage parses a valid length-prefixed message", async () => {
    const input = new PassThrough();
    const msg = { tabs: [], existingGroups: [] };
    const encoded = encodeMessage(msg);
    input.end(encoded);

    const result = await readMessage(input);
    expect(result).toEqual(msg);
  });

  it("readMessage rejects on invalid message length (0)", async () => {
    const input = new PassThrough();
    const header = Buffer.alloc(4);
    header.writeUInt32LE(0);
    input.end(header);

    await expect(readMessage(input)).rejects.toThrow("Invalid message length");
  });

  it("readMessage rejects when stdin closes before complete message", async () => {
    const input = new PassThrough();
    input.end(Buffer.alloc(0));

    await expect(readMessage(input)).rejects.toThrow("stdin closed");
  });

  it("writeMessage produces a valid length-prefixed message", () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk) => chunks.push(chunk));

    const msg = { groups: [{ name: "Test", tabIds: [1] }] };
    writeMessage(output, msg);
    output.end();

    const combined = Buffer.concat(chunks);
    const len = combined.readUInt32LE(0);
    const body = JSON.parse(combined.subarray(4, 4 + len).toString("utf-8"));
    expect(body).toEqual(msg);
  });

  it("roundtrip: writeMessage → readMessage", async () => {
    const stream = new PassThrough();
    const msg = { error: "something went wrong" };
    writeMessage(stream, msg);
    stream.end();

    const result = await readMessage(stream);
    expect(result).toEqual(msg);
  });
});
