import { describe, expect, it } from "vitest";
import { codeOf, normalizeCode } from "./scan-parse";

describe("reading a scan", () => {
  it("takes a plain code as it is", () => {
    expect(codeOf("LOT-261113-0027")).toBe("LOT-261113-0027");
    expect(normalizeCode("  lot-261113-0027\n")).toBe("LOT-261113-0027");
  });
  it("takes the box code from the end of an OEM label record", () => {
    expect(codeOf("FG-DT220|B-261113|A|M-07|250|20261113|BX-261113-0215")).toBe("BX-261113-0215");
    expect(normalizeCode("fg-dt220|b|a|m-07|250|20261113|bx-261113-0215 ")).toBe("BX-261113-0215");
  });
  it("removes spaces inside a code, which a camera sometimes reads in", () => {
    expect(normalizeCode("A-01 -01")).toBe("A-01-01");
  });
});
