/**
 * Export record (D96): the card as a PDF, of exactly what the database sent
 * the person exporting, against the real captures in __fixtures__/cards.json.
 *
 * - a colleague's export carries the work card and nothing personal;
 * - your own carries personal details, family, nominees, history and
 *   statutory numbers, the numbers masked to their last four;
 * - a statutory officer, who was sent full numbers, still exports them masked;
 * - the physical record ("appears in no export") and religion, caste and
 *   disability are never in it;
 * - the PDF is a PDF and names the person and the day.
 */

import { describe, expect, it } from "vitest";
import type { EmployeeCard } from "./contracts";
import cards from "./components/__fixtures__/cards.json";
import { recordPdf, recordSections } from "./recordExport";

const as = (k: keyof typeof cards) => cards[k] as unknown as EmployeeCard;
const text = (card: EmployeeCard) =>
  recordSections(card)
    .map((s) => [s.title, ...s.rows.flat()].join(" | "))
    .join("\n");

describe("what goes in", () => {
  it("gives a colleague the work card and nothing personal", () => {
    const t = text(as("colleague"));
    expect(t).toContain("Priya Employee");
    expect(t).toContain("Tata AIG, Hosur");
    for (const absent of ["Date of birth", "Family", "Addresses", "Statutory", "Bank"]) {
      expect(t).not.toContain(absent);
    }
  });

  it("gives you your own record, numbers masked to their last four", () => {
    const t = text(as("self"));
    for (const present of ["Date of birth", "Family", "Aarav", "Addresses", "Statutory", "Bank"]) {
      expect(t).toContain(present);
    }
    expect(t).toContain("•••• 0124");
    expect(t).toContain("•••• 5678");
  });

  it("masks the full numbers a statutory officer was sent", () => {
    const t = text(as("statutory"));
    expect(t).not.toContain("101234567890");
    expect(t).not.toContain("MHBAN00000640000000125");
    expect(t).toContain("•••• 7890");
  });

  it("never carries the physical record or the restricted fields", () => {
    for (const k of ["self", "admin", "statutory", "payroll"] as const) {
      const t = text(as(k));
      for (const absent of ["Height", "Weight", "Chest", "Religion", "Caste", "Disability"]) {
        expect(t, `${k}: ${absent}`).not.toContain(absent);
      }
    }
  });
});

describe("the file", () => {
  it("is a PDF naming the person and the day", async () => {
    const bytes = new Uint8Array(await recordPdf(as("self"), "2026-10-12"));
    const s = new TextDecoder("latin1").decode(bytes);
    expect(s.startsWith("%PDF-")).toBe(true);
    expect(s).toContain(as("self").fullName as string);
    expect(s).toContain("12 Oct 2026");
  });
});
