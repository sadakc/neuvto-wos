// @vitest-environment happy-dom
/**
 * What the salary structure screen must say.
 *
 * The assertions here are the same ones `PayRuns.test.tsx` makes, and for a
 * while they were the only place the claim was true: the pay run screen was
 * proved to name people who have no salary structure, while the database
 * function feeding it could not return such a person at all — an inner lateral
 * join dropped them (20260823130000). The screen rendered a warning it could
 * never be handed the data to raise.
 *
 * So these tests assert the warning AND the fixture it depends on is one the
 * real handler can actually produce: `listStructures` builds its list from the
 * roster and attaches structures to it, so a person with none arrives with
 * `effectiveFrom: null` rather than not arriving.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SalaryComponent, StructureRow } from "../contracts";

const listStructures = vi.fn<() => Promise<StructureRow[]>>();
const listComponents = vi.fn<() => Promise<SalaryComponent[]>>();
const saveStructure = vi.fn();

vi.mock("../handlers", () => ({
  listStructures: () => listStructures(),
  listComponents: () => listComponents(),
  saveStructure: (input: unknown) => saveStructure(input),
}));

import SalaryStructures from "./SalaryStructures";

const E1 = "11111111-1111-4111-8111-111111111111";
const E2 = "22222222-2222-4222-8222-222222222222";
const C_BASIC = "33333333-3333-4333-8333-333333333333";
const C_HRA = "44444444-4444-4444-8444-444444444444";

const component = (over: Partial<SalaryComponent> = {}): SalaryComponent => ({
  id: C_BASIC,
  category: "earning",
  code: "basic",
  name: "Basic and DA",
  nameInPayslip: "Basic and DA",
  calculationType: "flat_amount",
  defaultAmount: null,
  defaultPercentage: null,
  epf: "always",
  esi: true,
  isTaxable: true,
  isProRata: true,
  isFbp: false,
  showOnPayslip: true,
  partOfStructure: true,
  frequency: null,
  maxAmountPerMonth: null,
  unclaimedPolicy: null,
  displayOrder: 10,
  status: "active",
  inUse: false,
  ...over,
});

const person = (over: Partial<StructureRow> = {}): StructureRow => ({
  employeeId: E1,
  employeeName: "Priya Employee",
  employeeCode: "TISR0009",
  effectiveFrom: "2026-07-01",
  amounts: [{ componentId: C_BASIC, amount: 10000 }],
  fixedGross: 10000,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  listComponents.mockResolvedValue([component()]);
  listStructures.mockResolvedValue([person()]);
});

describe("Salary structures — nobody is unpayable in silence", () => {
  it("names the people with no structure, rather than counting them", async () => {
    listStructures.mockResolvedValue([
      person(),
      person({
        employeeId: E2,
        employeeName: "Ravi Kumar",
        effectiveFrom: null,
        amounts: [],
        fixedGross: 0,
      }),
    ]);

    render(<SalaryStructures />);

    // Scoped to the banner. Both names appear in the list below, which is
    // correct and is not what this asserts. Priya, who HAS a structure, must
    // not be named here — a warning listing everybody warns about nobody.
    const banner = await screen.findByTestId("no-structure-warning");
    expect(banner).toHaveTextContent("Ravi Kumar");
    expect(banner).toHaveTextContent(/no salary structure and cannot be paid/i);
    expect(banner).not.toHaveTextContent("Priya Employee");
  });

  it("says nothing when everybody has a structure", async () => {
    render(<SalaryStructures />);
    await screen.findByText("Priya Employee");
    expect(screen.queryByTestId("no-structure-warning")).not.toBeInTheDocument();
  });

  it("offers to set up a salary for somebody who has none, not to edit one", async () => {
    listStructures.mockResolvedValue([person({ effectiveFrom: null, amounts: [], fixedGross: 0 })]);
    render(<SalaryStructures />);
    expect(await screen.findByRole("button", { name: /Set up salary/i })).toBeInTheDocument();
  });
});

describe("Salary structures — gross is the sum, not a field", () => {
  it("adds the components up as they are typed", async () => {
    listComponents.mockResolvedValue([
      component(),
      component({ id: C_HRA, code: "hra", name: "House rent allowance", displayOrder: 20 }),
    ]);
    listStructures.mockResolvedValue([person({ amounts: [], fixedGross: 0, effectiveFrom: null })]);

    const user = userEvent.setup();
    render(<SalaryStructures />);

    await user.click(await screen.findByRole("button", { name: /Set up salary/i }));

    await user.type(screen.getByLabelText(/Basic and DA for Priya Employee/i), "10000");
    await user.type(screen.getByLabelText(/House rent allowance for Priya Employee/i), "4000");

    // 14,000 appears nowhere in the input; it exists only because the screen
    // added the parts. A stored gross could disagree with them — this cannot.
    expect(screen.getByTestId("draft-gross")).toHaveTextContent("₹14,000");
  });

  it("shows the current gross and the date it took effect", async () => {
    render(<SalaryStructures />);
    const row = await screen.findByTestId(`structure-${E1}`);
    expect(row).toHaveTextContent("₹10,000");
    expect(row).toHaveTextContent("since 2026-07-01");
  });
});

describe("Salary structures — the order of setup", () => {
  it("sends you to components first when there are none", async () => {
    listComponents.mockResolvedValue([]);
    render(<SalaryStructures />);
    expect(await screen.findByTestId("no-components-yet")).toHaveTextContent(
      /Set up salary components first/i,
    );
  });

  it("does not offer a save button that could not succeed", async () => {
    listComponents.mockResolvedValue([]);
    render(<SalaryStructures />);
    await screen.findByTestId("no-components-yet");
    expect(
      screen.queryByRole("button", { name: /Save salary structure/i }),
    ).not.toBeInTheDocument();
  });
});
