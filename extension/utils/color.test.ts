import { describe, expect, it } from "vitest";
import { colorForGroup } from "./color";

describe("colorForGroup", () => {
  it("returns a valid chrome tab group color", () => {
    const validColors = [
      "grey",
      "blue",
      "red",
      "yellow",
      "green",
      "pink",
      "purple",
      "cyan",
      "orange",
    ];
    const color = colorForGroup("Development");
    expect(validColors).toContain(color);
  });

  it("returns the same color for the same name", () => {
    expect(colorForGroup("News")).toBe(colorForGroup("News"));
  });

  it("handles empty string", () => {
    const validColors = [
      "grey",
      "blue",
      "red",
      "yellow",
      "green",
      "pink",
      "purple",
      "cyan",
      "orange",
    ];
    expect(validColors).toContain(colorForGroup(""));
  });
});
