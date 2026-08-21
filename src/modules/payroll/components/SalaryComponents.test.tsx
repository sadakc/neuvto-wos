// @vitest-environment happy-dom
/**
 * What the component shell must get right across four categories.
 *
 * Two themes. The first is honesty about reach: benefits and reimbursements are
 * configurable and compute nothing, and a screen that lets somebody set one up
 * without saying so has sold them a payslip line that will never appear.
 *
 * The second is the freeze. Once a component is on a real salary structure,
 * changing what it means restates payslips already issued — so the fields that
 * decide meaning are locked, and the screen says why rather than simply
 * refusing on save.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SalaryComponent } from "../contracts";

const listComponents = vi.fn<() => Promise<SalaryComponent[]>>();
const saveComponent = vi.fn();
const setComponentStatus = vi.fn();

vi.mock("../handlers", () => ({
  listComponents: () => listComponents(),
  saveComponent: (c: unknown) => saveComponent(c),
  setComponentStatus: (id: string, s: string) => setComponentStatus(id, s),
}));

import SalaryComponents from "./SalaryComponents";

const component = (over: Partial<SalaryComponent> = {}): SalaryComponent => ({
  id: "11111111-1111-4111-8111-111111111111",
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
  saveComponent.mockResolvedValue(undefined);
  setComponentStatus.mockResolvedValue(undefined);
});

describe("Components — one shell, four categories", () => {
  it("shows only the category whose tab is open", async () => {
    listComponents.mockResolvedValue([
      component(),
      component({
        id: "22222222-2222-4222-8222-222222222222",
        category: "deduction",
        code: "canteen",
        name: "Canteen recovery",
        frequency: "recurring",
        epf: "off",
      }),
    ]);

    const user = userEvent.setup();
    render(<SalaryComponents />);

    expect(await screen.findByTestId("component-basic")).toBeInTheDocument();
    expect(screen.queryByTestId("component-canteen")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("tab-deduction"));
    expect(screen.getByTestId("component-canteen")).toBeInTheDocument();
    expect(screen.queryByTestId("component-basic")).not.toBeInTheDocument();
  });

  it("says plainly that a benefit reaches no payslip", async () => {
    // The alternative is somebody configuring voluntary provident fund, waiting
    // a month, and finding nothing on anybody's payslip. A gap that announces
    // itself is a gap; a silent one is a bug report.
    const user = userEvent.setup();
    render(<SalaryComponents />);
    await screen.findByTestId("component-basic");

    await user.click(screen.getByTestId("tab-benefit"));
    expect(screen.getByTestId("reaches-benefit")).toHaveTextContent(
      /nothing here reaches a payslip yet/i,
    );
  });

  it("says an earning does reach one", async () => {
    render(<SalaryComponents />);
    expect(await screen.findByTestId("reaches-earning")).toHaveTextContent(
      /Paid on every payslip/i,
    );
  });
});

describe("Components — frozen once somebody is paid through it", () => {
  it("locks what a component MEANS but not what it is called", async () => {
    listComponents.mockResolvedValue([component({ inUse: true })]);
    const user = userEvent.setup();
    render(<SalaryComponents />);

    await user.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.getByTestId("frozen-notice")).toBeInTheDocument();
    // Meaning: locked. Changing these restates payslips already issued.
    expect(screen.getByLabelText("Counts towards PF wages")).toBeDisabled();
    expect(screen.getByLabelText("Counts towards ESI")).toBeDisabled();
    expect(screen.getByLabelText("Code")).toBeDisabled();
    expect(screen.getByLabelText("Reduced for days not worked")).toBeDisabled();
    // Naming: still editable. Renaming a component does not restate anything.
    expect(screen.getByLabelText("Name")).toBeEnabled();
    expect(screen.getByLabelText("Name on the payslip")).toBeEnabled();
    expect(screen.getByLabelText("Default amount")).toBeEnabled();
  });

  it("leaves a component nobody is on entirely editable", async () => {
    const user = userEvent.setup();
    render(<SalaryComponents />);

    await user.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.queryByTestId("frozen-notice")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Counts towards PF wages")).toBeEnabled();
    expect(screen.getByLabelText("Code")).toBeEnabled();
  });

  it("marks which components are in use, in the list", async () => {
    listComponents.mockResolvedValue([
      component({ inUse: true }),
      component({
        id: "33333333-3333-4333-8333-333333333333",
        code: "hra",
        name: "HRA",
        inUse: false,
      }),
    ]);
    render(<SalaryComponents />);

    expect(await screen.findByTestId("in-use-basic")).toBeInTheDocument();
    expect(screen.queryByTestId("in-use-hra")).not.toBeInTheDocument();
  });
});

describe("Components — the honest note on a treatment that does nothing yet", () => {
  it("warns that `below the ceiling only` is inert while wages are restricted", async () => {
    // This was nearly shipped as a silent no-op. Capped, `min(base, cap)` and
    // `min(base + extra, cap)` agree, so an administrator choosing this would
    // see no change and have no way to find out why.
    const user = userEvent.setup();
    render(<SalaryComponents />);

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.selectOptions(screen.getByLabelText("Counts towards PF wages"), "under_threshold");

    expect(screen.getByTestId("under-threshold-note")).toHaveTextContent(
      /charged on wages restricted to the ceiling/i,
    );
  });
});

describe("Components — the field that swaps", () => {
  it("asks for a percentage instead of an amount, never both", async () => {
    const user = userEvent.setup();
    render(<SalaryComponents />);

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Default amount")).toBeInTheDocument();
    expect(screen.queryByLabelText("Percentage")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("How it is worked out"), "percent_of_ctc");
    expect(screen.getByLabelText("Percentage")).toBeInTheDocument();
    expect(screen.queryByLabelText("Default amount")).not.toBeInTheDocument();
  });

  it("does not offer a percentage on a deduction at all", async () => {
    // Mirrors the CHECK constraint. "40% of basic" is not something anybody
    // means by a canteen recovery.
    listComponents.mockResolvedValue([
      component({
        category: "deduction",
        code: "canteen",
        name: "Canteen",
        frequency: "recurring",
      }),
    ]);
    const user = userEvent.setup();
    render(<SalaryComponents />);
    // The tabs only exist once the load resolves, and the canteen row is on a
    // tab that is not open yet — so wait for the tab, not for the row.
    await user.click(await screen.findByTestId("tab-deduction"));
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.queryByLabelText("How it is worked out")).not.toBeInTheDocument();
    expect(screen.getByLabelText("How often")).toBeInTheDocument();
  });
});

describe("Components — soft status, never conflated with deleting", () => {
  it("archives rather than removes", async () => {
    const user = userEvent.setup();
    render(<SalaryComponents />);

    await user.click(await screen.findByTestId("status-basic"));
    expect(setComponentStatus).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "archived",
    );
  });

  it("offers the way back", async () => {
    listComponents.mockResolvedValue([component({ status: "archived" })]);
    const user = userEvent.setup();
    render(<SalaryComponents />);

    const row = (await screen.findByTestId("component-basic")) as HTMLElement;
    expect(within(row).getByText("inactive")).toBeInTheDocument();
    await user.click(screen.getByTestId("status-basic"));
    expect(setComponentStatus).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "active",
    );
  });
});

describe("Components — a new one arrives valid", () => {
  it("gives a deduction a frequency without being asked", async () => {
    // A deduction with no frequency fails validation. Making the person
    // discover that by pressing Save is a worse screen than defaulting to the
    // common answer.
    const user = userEvent.setup();
    render(<SalaryComponents />);
    await screen.findByTestId("component-basic");

    await user.click(screen.getByTestId("tab-deduction"));
    await user.click(screen.getByTestId("add-component"));
    await user.type(screen.getByLabelText("Name"), "Canteen recovery");
    await user.type(screen.getByLabelText("Code"), "canteen");
    await user.click(screen.getByTestId("save-component"));

    expect(saveComponent).toHaveBeenCalledTimes(1);
    expect(saveComponent.mock.calls[0][0]).toMatchObject({
      category: "deduction",
      code: "canteen",
      frequency: "recurring",
      epf: "off",
    });
  });
});
