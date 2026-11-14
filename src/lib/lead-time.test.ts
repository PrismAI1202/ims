import { describe, expect, it } from "vitest";
import { addDays, daysBetween, earliestDelivery, isExpedite, longDate } from "./lead-time";

describe("lead time arithmetic", () => {
  it("adds and counts days across month and year ends", () => {
    expect(addDays("2026-11-28", 5)).toBe("2026-12-03");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-11-13", -13)).toBe("2026-10-31");
    expect(daysBetween("2026-11-10", "2026-11-23")).toBe(13);
    expect(daysBetween("2026-11-23", "2026-11-10")).toBe(-13);
  });
  it("says the earliest delivery and whether a wanted date is inside the lead time", () => {
    expect(earliestDelivery("2026-11-13", 10)).toBe("2026-11-23");
    expect(isExpedite("2026-11-13", 10, "2026-11-22")).toBe(true);
    expect(isExpedite("2026-11-13", 10, "2026-11-23")).toBe(false); // exactly the lead time is normal delivery
    expect(isExpedite("2026-11-13", 10, "2026-12-01")).toBe(false);
  });
  it("writes a readable date", () => {
    expect(longDate("2026-11-23")).toBe("Mon, 23 Nov 2026");
  });
});
