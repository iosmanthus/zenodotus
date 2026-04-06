import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

const { mockExecFile } = vi.hoisted(() => {
  const mockExecFile = vi.fn();
  return { mockExecFile };
});

vi.mock("node:child_process", () => {
  // Attach the custom promisify symbol so promisify(execFile) returns our mock directly
  mockExecFile[promisify.custom] = mockExecFile;
  return { execFile: mockExecFile };
});

import { assignGroups } from "./index";

const baseRequest = {
  tabs: [{ tabId: 1, windowId: 1, url: "https://example.com", title: "Example" }],
};

describe("claude-code provider", () => {
  it("returns structured_output on success", async () => {
    const expected = { groups: [{ name: "Dev", tabIds: [1] }] };
    mockExecFile.mockResolvedValue({ stdout: JSON.stringify({ structured_output: expected }) });
    const result = await assignGroups(baseRequest);
    expect(result).toEqual(expected);
  });

  it("throws when CLI fails", async () => {
    mockExecFile.mockRejectedValue(new Error("command not found"));
    await expect(assignGroups(baseRequest)).rejects.toThrow("claude-code CLI failed");
  });

  it("throws when structured_output is missing", async () => {
    mockExecFile.mockResolvedValue({ stdout: JSON.stringify({ result: "something else" }) });
    await expect(assignGroups(baseRequest)).rejects.toThrow("no structured output");
  });
});
