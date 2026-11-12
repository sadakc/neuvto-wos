import { describe, expect, it } from "vitest";
import { addressLine, DISTRICTS, districtsOf, HOME_STATE, STATES } from "./indiaPlaces";

/** The place lists (D105). */
describe("states and districts", () => {
  it("has every state and union territory once, the first four first", () => {
    expect(STATES).toHaveLength(36);
    expect(new Set(STATES).size).toBe(36);
    expect(STATES.slice(0, 4)).toEqual(["Karnataka", "Maharashtra", "Goa", "Andhra Pradesh"]);
    const rest = STATES.slice(4);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
    expect(HOME_STATE).toBe("Karnataka");
  });

  it("gives every state its districts, and Belgaum's under its name today", () => {
    for (const st of STATES) expect(districtsOf(st).length, st).toBeGreaterThan(0);
    expect(districtsOf("Karnataka")).toContain("Belagavi");
    expect(districtsOf("Karnataka")).toHaveLength(31);
    expect(districtsOf("Atlantis")).toEqual([]);
    for (const [st, ds] of Object.entries(DISTRICTS)) expect(new Set(ds).size, st).toBe(ds.length);
  });

  it("writes an address in the order it is written in India", () => {
    expect(
      addressLine({
        line: "12 Khade Bazar",
        city: "Belagavi",
        district: "Belagavi",
        state: "Karnataka",
        pincode: "590001",
      }),
    ).toBe("12 Khade Bazar, Belagavi, Karnataka, India - 590001");
    expect(
      addressLine({
        line: "9 Lake View",
        city: "Hosur",
        district: null,
        state: "Tamil Nadu",
        pincode: "635109",
      }),
    ).toBe("9 Lake View, Hosur, Tamil Nadu, India - 635109");
  });
});
