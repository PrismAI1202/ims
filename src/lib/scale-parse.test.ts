import { describe, expect, it } from "vitest";
import { lineSplitter, parseScaleLine } from "./scale-parse";

describe("parseScaleLine", () => {
  it("reads continuous-output style with stability flags", () => {
    expect(parseScaleLine("ST,GS,+0012.34kg")).toEqual({ kg: 12.34, stable: true, raw: "ST,GS,+0012.34kg" });
    expect(parseScaleLine("US,GS,+0012.34kg")?.stable).toBe(false);
    expect(parseScaleLine("ST,NT,  1.20 kg")?.kg).toBe(1.2);
  });
  it("reads Mettler SICS style", () => {
    expect(parseScaleLine("S S      12.34 kg")).toMatchObject({ kg: 12.34, stable: true });
    expect(parseScaleLine("S D      12.34 kg")?.stable).toBe(false);
  });
  it("reads plain and prefixed weights", () => {
    expect(parseScaleLine("  12.34 kg")?.kg).toBe(12.34);
    expect(parseScaleLine("N 1.20 kg")?.kg).toBe(1.2);
    expect(parseScaleLine("WT:0.250KG")?.kg).toBe(0.25);
    expect(parseScaleLine("0,250 kg")?.kg).toBe(0.25); // decimal comma
  });
  it("converts grams and pounds to kg", () => {
    expect(parseScaleLine("250 g")?.kg).toBe(0.25);
    expect(parseScaleLine("1500g")?.kg).toBe(1.5);
    expect(parseScaleLine("10 lb")?.kg).toBeCloseTo(4.5359237, 6);
    expect(parseScaleLine("2.5 lbs")?.kg).toBeCloseTo(1.1339809, 6);
  });
  it("treats motion markers as unstable", () => {
    expect(parseScaleLine("M 12.3 kg")?.stable).toBe(false);
    expect(parseScaleLine("? 12.3 kg")?.stable).toBe(false);
  });
  it("refuses a number with no unit rather than guess grams vs kilograms", () => {
    expect(parseScaleLine("12.34")).toBeNull();
    expect(parseScaleLine("ST,GS,+0012.34")).toBeNull();
  });
  it("refuses negative weights, blanks and noise", () => {
    expect(parseScaleLine("-0.50 kg")).toBeNull();
    expect(parseScaleLine("")).toBeNull();
    expect(parseScaleLine("   ")).toBeNull();
    expect(parseScaleLine("OL")).toBeNull();
    expect(parseScaleLine("hello world")).toBeNull();
  });
  it("accepts zero (an empty platform)", () => expect(parseScaleLine("ST,GS,+0000.00kg")?.kg).toBe(0));
});

describe("lineSplitter", () => {
  it("reassembles lines split across chunks and handles CR, LF and CRLF", () => {
    const feed = lineSplitter();
    expect(feed("ST,GS,+00")).toEqual([]);
    expect(feed("12.34kg\r\nST,GS,+0013")).toEqual(["ST,GS,+0012.34kg"]);
    expect(feed(".00kg\r")).toEqual(["ST,GS,+0013.00kg"]);
    expect(feed("A\nB\n")).toEqual(["A", "B"]);
  });
  it("doesn't grow forever when the device never sends a line ending", () => {
    const feed = lineSplitter();
    feed("x".repeat(600));
    expect(feed("\n")).toEqual([""]);
  });
});
