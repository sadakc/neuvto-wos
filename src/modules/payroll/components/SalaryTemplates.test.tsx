// @vitest-environment happy-dom
/**
 * A template is a starting point and stays one.
 *
 * The assertion that matters is the one about COPYING: applying a template must
 * fill the boxes and then let go. A live link means editing a template restates
 * the pay of everybody on it, retroactively, from a screen that looks like
 * configuration — and the workbook this replaces would be unrepresentable, since
 * three quarters of its employees are paid something a little different from
 * the shape they started on.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SalaryComponent, SalaryTemplate } from "../contracts";

const listTemplates = vi.fn<() => Promise<SalaryTemplate[]>>();
const listComponents = vi.fn<() => Promise<SalaryComponent[]>>();
const saveTemplate = vi.fn();
const removeTemplate = vi.fn();

vi.mock("../handlers", () => ({
  listTemplates: () => listTemplates(),
  listComponents: () => listComponents(),
  saveTemplate: (t: unknown) => saveTemplate(t),
  removeTemplate: (id: string) => removeTemplate(id),
}));

import SalaryTemplates from "./SalaryTemplates";

const C_BASIC = "33333333-3333-4333-8333-333333333333";
const C_CANTEEN = "44444444-4444-4444-8444-444444444444";
const T = "55555555-5555-4555-8555-555555555555";

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

beforeEach(() => {
  vi.resetAllMocks();
  listComponents.mockResolvedValue([component()]);
  listTemplates.mockResolvedValue([]);
  saveTemplate.mockResolvedValue(T);
  removeTemplate.mockResolvedValue(undefined);
});

describe("Templates — the copy is said out loud", () => {
  it("tells an administrator that editing one changes nobody's pay", async () => {
    // Otherwise the reasonable assumption is the opposite, and somebody
    // "corrects" a template expecting eleven salaries to follow.
    render(<SalaryTemplates />);
    expect(await screen.findByTestId("template-is-a-copy")).toHaveTextContent(
      /changes nobody's pay/i,
    );
  });
});

describe("Templates — the order of setup", () => {
  it("sends you to components first when there are none", async () => {
    listComponents.mockResolvedValue([]);
    render(<SalaryTemplates />);
    expect(await screen.findByTestId("templates-need-components")).toHaveTextContent(
      /Set up salary components first/i,
    );
  });
});

describe("Templates — gross is the sum of the earnings", () => {
  it("adds them up as they are typed, and leaves the deduction out", async () => {
    // The same rule as a salary structure: a canteen recovery is not negative
    // pay, and letting it into gross would understate what the shape costs.
    listComponents.mockResolvedValue([
      component(),
      component({
        id: C_CANTEEN,
        category: "deduction",
        code: "canteen",
        name: "Canteen",
        epf: "off",
        frequency: "recurring",
      }),
    ]);

    const user = userEvent.setup();
    render(<SalaryTemplates />);

    await user.click(await screen.findByTestId("add-template"));
    await user.type(screen.getByLabelText("Basic and DA in this template"), "25000");
    await user.type(screen.getByLabelText("Canteen in this template"), "500");

    expect(screen.getByTestId("template-gross")).toHaveTextContent("₹25,000");
  });
});

describe("Templates — saving", () => {
  it("sends every component, including the ones left blank as zero", async () => {
    // An untouched box is a component this shape does not include, which is a
    // legitimate zero — and it has to be SENT, or applying the template later
    // leaves whatever was in that box before.
    listComponents.mockResolvedValue([
      component(),
      component({
        id: C_CANTEEN,
        category: "deduction",
        code: "canteen",
        name: "Canteen",
        epf: "off",
        frequency: "recurring",
      }),
    ]);

    const user = userEvent.setup();
    render(<SalaryTemplates />);

    await user.click(await screen.findByTestId("add-template"));
    await user.type(screen.getByLabelText("Template name"), "Manager");
    await user.type(screen.getByLabelText("Basic and DA in this template"), "25000");
    await user.click(screen.getByTestId("save-template"));

    expect(saveTemplate).toHaveBeenCalledTimes(1);
    expect(saveTemplate.mock.calls[0][0]).toMatchObject({
      name: "Manager",
      amounts: [
        { componentId: C_BASIC, amount: 25000 },
        { componentId: C_CANTEEN, amount: 0 },
      ],
    });
  });

  it("refuses a template with no name", async () => {
    const user = userEvent.setup();
    render(<SalaryTemplates />);

    await user.click(await screen.findByTestId("add-template"));
    await user.type(screen.getByLabelText("Basic and DA in this template"), "25000");
    await user.click(screen.getByTestId("save-template"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Give this template a name/i);
    expect(saveTemplate).not.toHaveBeenCalled();
  });
});

describe("Templates — the list", () => {
  it("shows what each one costs a month", async () => {
    listTemplates.mockResolvedValue([
      { id: T, name: "Manager", description: "Grade 3", amounts: [], gross: 85000 },
    ]);
    render(<SalaryTemplates />);
    expect(await screen.findByTestId(`template-${T}`)).toHaveTextContent("₹85,000");
  });

  it("deletes one", async () => {
    listTemplates.mockResolvedValue([
      { id: T, name: "Manager", description: "", amounts: [], gross: 85000 },
    ]);
    const user = userEvent.setup();
    render(<SalaryTemplates />);

    await user.click(await screen.findByTestId(`delete-${T}`));
    expect(removeTemplate).toHaveBeenCalledWith(T);
  });
});
