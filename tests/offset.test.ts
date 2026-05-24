import { describe, expect, it } from "vitest";
import { formatOffset, offsetToMilliseconds, parseAlertOffset } from "../src/offset";

describe("alert offset parsing", () => {
  it("parses minutes, hours, and days", () => {
    expect(parseAlertOffset("30 minutes")).toEqual({ amount: 30, unit: "minutes" });
    expect(parseAlertOffset("2h")).toEqual({ amount: 2, unit: "hours" });
    expect(parseAlertOffset("1 day")).toEqual({ amount: 1, unit: "days" });
  });

  it("rejects invalid offsets", () => {
    expect(() => parseAlertOffset("soon")).toThrow();
    expect(() => parseAlertOffset("0 minutes")).toThrow();
  });

  it("formats and converts canonical offsets", () => {
    expect(formatOffset(1, "hours")).toBe("1 hour");
    expect(offsetToMilliseconds(2, "days")).toBe(172_800_000);
  });
});
