import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

const { mockExecFile, mockReadFileSync } = vi.hoisted(() => {
  const mockExecFile = vi.fn();
  const mockReadFileSync = vi.fn();
  return { mockExecFile, mockReadFileSync };
});

vi.mock("node:child_process", () => {
  mockExecFile[promisify.custom] = mockExecFile;
  return { execFile: mockExecFile };
});

vi.mock("node:fs", () => ({
  mkdtempSync: vi.fn(() => "/tmp/zenodotus-test"),
  writeFileSync: vi.fn(),
  readFileSync: mockReadFileSync,
  rmSync: vi.fn(),
}));

import { assignGroups } from "./index";

const baseRequest = {
  tabs: [{ tabId: 1, windowId: 1, url: "https://example.com", title: "Example" }],
};

describe("codex provider", () => {
  it("returns parsed output on success", async () => {
    const output = { groups: [{ name: "Dev", tabIds: [1], groupId: null }] };
    mockExecFile.mockResolvedValue({ stdout: "", stderr: "" });
    mockReadFileSync.mockReturnValue(JSON.stringify(output));
    const result = await assignGroups(baseRequest);
    // null groupId should be stripped, non-null name kept
    expect(result).toEqual({ groups: [{ name: "Dev", tabIds: [1] }] });
  });

  it("throws when CLI fails", async () => {
    mockExecFile.mockRejectedValue(new Error("command not found"));
    await expect(assignGroups(baseRequest)).rejects.toThrow("codex CLI failed");
  });

  it("throws when output is empty", async () => {
    mockExecFile.mockResolvedValue({ stdout: "", stderr: "" });
    mockReadFileSync.mockReturnValue("");
    await expect(assignGroups(baseRequest)).rejects.toThrow("codex returned empty output");
  });
});
