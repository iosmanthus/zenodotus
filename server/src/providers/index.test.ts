import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./claude-code", () => ({
  assignGroups: vi.fn(),
}));
vi.mock("./codex", () => ({
  assignGroups: vi.fn(),
}));
vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
}));

import { appendFileSync } from "node:fs";
import type { GroupRequest, GroupResponse } from "@zenodotus/api-spec";
import { assignGroups as claudeAssign } from "./claude-code";
import { assignGroups as codexAssign } from "./codex";
import { assignGroups } from "./index";

const mockResponse: GroupResponse = {
  groups: [{ name: "Dev", tabIds: [1, 2] }],
};

const baseRequest: GroupRequest = {
  tabs: [{ tabId: 1, windowId: 1, url: "https://example.com", title: "Example" }],
};

describe("provider routing", () => {
  beforeEach(() => {
    vi.mocked(claudeAssign).mockResolvedValue(mockResponse);
    vi.mocked(codexAssign).mockResolvedValue(mockResponse);
    vi.mocked(appendFileSync).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to claude-code provider", async () => {
    await assignGroups(baseRequest);
    expect(claudeAssign).toHaveBeenCalled();
    expect(codexAssign).not.toHaveBeenCalled();
  });

  it("routes to codex when requested", async () => {
    await assignGroups({ ...baseRequest, provider: "codex" });
    expect(codexAssign).toHaveBeenCalled();
    expect(claudeAssign).not.toHaveBeenCalled();
  });

  it("does not write log file when debug is off", async () => {
    await assignGroups(baseRequest);
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it("writes log file when debug is on", async () => {
    await assignGroups({ ...baseRequest, debug: true });
    expect(appendFileSync).toHaveBeenCalled();
  });
});
