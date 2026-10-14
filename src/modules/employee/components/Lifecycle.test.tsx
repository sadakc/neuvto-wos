// @vitest-environment happy-dom

/**
 * Adding people and letting them go (E8), against real card output. What it pins:
 *
 * - a record cannot be started without a name, nor invited without an email;
 * - an invitation refused after the record was made says the draft exists,
 *   rather than leaving the Admin to start a second one;
 * - a draft's card offers Send invite and not Deactivate; an active person's
 *   the reverse; nobody else's card offers either;
 * - the deactivate dialog says what will happen first, needs all three
 *   answers, and afterwards says what it did, posting included (criterion 10).
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/platform/errors";
import type { AdminOverview, EmployeeCard } from "../contracts";
import cards from "./__fixtures__/cards.json";

const api = vi.hoisted(() => ({
  getThisYear: vi.fn(),
  listCardViews: vi.fn(),
  createDraft: vi.fn(),
  updateDraft: vi.fn(),
  sendInvite: vi.fn(),
  getAdminOverview: vi.fn(),
  getDeactivationPreview: vi.fn(),
  deactivateEmployee: vi.fn(),
  listDesignations: vi.fn(),
  updateEmployee: vi.fn(),
  listChangeRequests: vi.fn(),
  getRestrictedReads: vi.fn(),
  addDepartment: vi.fn(),
  saveDesignation: vi.fn(),
  listManagerCandidates: vi.fn(),
  makeManager: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("../handlers", () => api);
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => navigate,
}));

import { EmployeeCardView } from "./EmployeeCardView";
import AddEmployee from "./Lifecycle";

const as = (k: keyof typeof cards) => cards[k] as unknown as EmployeeCard;

const OVERVIEW: AdminOverview = {
  managers: [{ profileId: "p-mark", fullName: "Mark Manager" }],
  departments: [{ id: "d-ops", name: "Operations" }],
  active: 8,
  invitedNotSignedIn: 1,
  drafts: 1,
  deployedToClientUnits: 2,
  missingStatutory: 7,
  recent: [
    {
      id: "e-1",
      fullName: "No Email Yet",
      email: null,
      stage: "draft",
      createdAt: "2026-10-14T00:00:00Z",
      // The shape employee_onboarding_gaps() returns since D99, not names:
      // a made-up list of strings here is what hid "[object Object]".
      gaps: [
        { key: "designation", label: "Designation", dueOn: "2026-10-01", overdue: true },
        { key: "uan", label: "UAN", dueOn: "2026-11-01", overdue: false },
      ],
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  api.getThisYear.mockResolvedValue({
    leaveYear: null,
    leave: null,
    openRequests: [],
    openCorrections: 0,
  });
  api.listCardViews.mockResolvedValue([]);
  api.getAdminOverview.mockResolvedValue(OVERVIEW);
  api.listDesignations.mockResolvedValue([{ id: "g-1", name: "Guard" }]);
  api.listChangeRequests.mockResolvedValue([]);
  api.getRestrictedReads.mockResolvedValue([]);
});

describe("Add Employee", () => {
  it("needs a name to save and an email to invite, and opens the new card", async () => {
    const user = userEvent.setup();
    api.createDraft.mockResolvedValue("e-new");
    api.updateEmployee.mockResolvedValue(undefined);
    api.sendInvite.mockResolvedValue(undefined);
    render(<AddEmployee />);
    expect(await screen.findByText("Mark Manager")).toBeInTheDocument();
    expect(screen.getByTestId("add-save-draft")).toBeDisabled();

    await user.type(screen.getByTestId("add-name"), "Nisha Rao");
    expect(screen.getByTestId("add-save-draft")).toBeEnabled();
    expect(screen.getByTestId("add-send-invite")).toBeDisabled();

    await user.type(screen.getByTestId("add-email"), "nisha@acme.test");
    await user.selectOptions(screen.getByTestId("add-manager"), "p-mark");
    await user.click(screen.getByTestId("add-send-invite"));

    expect(api.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "Nisha Rao",
        email: "nisha@acme.test",
        managerId: "p-mark",
      }),
    );
    expect(api.sendInvite).toHaveBeenCalledWith("e-new");
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ search: { id: "e-new" } }));
  });

  it("says the draft exists when the invitation is refused after it was made", async () => {
    const user = userEvent.setup();
    api.createDraft.mockResolvedValue("e-new");
    api.sendInvite.mockRejectedValue(
      new AppError("VALIDATION_FAILED", "Somebody has already been invited with that email.", 400),
    );
    render(<AddEmployee />);
    await user.type(await screen.findByTestId("add-name"), "Nisha Rao");
    await user.type(screen.getByTestId("add-email"), "nisha@acme.test");
    await user.click(screen.getByTestId("add-send-invite"));

    const error = await screen.findByTestId("add-error");
    expect(error).toHaveTextContent("already been invited");
    expect(error).toHaveTextContent("saved as a draft");
    expect(navigate).not.toHaveBeenCalled();
    expect(api.getAdminOverview).toHaveBeenCalledTimes(2);
  });

  it("lists what each record is missing, and will not invite one with no email", async () => {
    render(<AddEmployee />);
    const row = await screen.findByTestId("added-row");
    expect(row).toHaveTextContent("Missing: Designation, UAN · 1 overdue");
    expect(row).not.toHaveTextContent("[object");
    expect(within(row).getByTestId("added-invite")).toBeDisabled();
  });
});

describe("Add Employee, Sada's first round (D103)", () => {
  it("reads None, not 'Not yet', for an empty designation, department, manager and type", async () => {
    render(<AddEmployee />);
    await screen.findByText("Mark Manager");
    for (const id of ["add-designation", "add-department", "add-manager", "add-employment-type"]) {
      const select = screen.getByTestId(id) as HTMLSelectElement;
      expect(select.options[0].textContent).toBe("None");
    }
    expect(screen.queryByText("Not yet")).toBeNull();
  });

  it("says what is wrong under each field, and saves nothing", async () => {
    const user = userEvent.setup();
    render(<AddEmployee />);
    await user.type(await screen.findByTestId("add-name"), "Nisha 2");
    await user.type(screen.getByTestId("add-email"), "nisha.acme.test");
    await user.type(screen.getByTestId("add-phone"), "34654365465");
    await user.type(screen.getByTestId("add-code"), "EMP 1");
    await user.click(screen.getByTestId("add-save-draft"));
    expect(screen.getByTestId("add-name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      "Letters only: no digits or symbols other than . ' and -.",
      "Enter an email address, like name@example.com.",
      "A mobile number has 10 digits; this has 11.",
      "Letters and digits, up to 30, with / . _ or - between them. No spaces.",
    ]);
    expect(api.createDraft).not.toHaveBeenCalled();

    // Fixing one clears its message as it is typed.
    await user.clear(screen.getByTestId("add-phone"));
    await user.type(screen.getByTestId("add-phone"), "+971 50 123 4567");
    expect(screen.getAllByRole("alert")).toHaveLength(3);
  });

  it("adds a department from the form and saves the person into it", async () => {
    const user = userEvent.setup();
    api.addDepartment.mockResolvedValue("d-sec");
    api.createDraft.mockResolvedValue("e-new");
    render(<AddEmployee />);
    await user.type(await screen.findByTestId("add-name"), "Nisha Rao");
    await user.selectOptions(screen.getByTestId("add-department"), "Add a department…");
    await user.type(screen.getByLabelText("New department"), "Security");
    await user.click(within(screen.getByTestId("add-inline")).getByRole("button", { name: "Add" }));
    expect(api.addDepartment).toHaveBeenCalledWith("Security");
    expect(screen.getByTestId("add-department")).toHaveValue("d-sec");
    await user.click(screen.getByTestId("add-save-draft"));
    expect(api.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "Nisha Rao", departmentId: "d-sec" }),
    );
  });
});

describe("on the card", () => {
  it("offers a draft Send invite and not Deactivate", () => {
    render(<EmployeeCardView card={as("draft")} />);
    expect(screen.getByTestId("card-header")).toHaveTextContent("Draft");
    expect(screen.getByTestId("card-send-invite")).toBeInTheDocument();
    expect(screen.queryByTestId("deactivate")).toBeNull();
  });

  it("offers an active person Deactivate and not Send invite, and offers nobody else either", () => {
    const { unmount } = render(<EmployeeCardView card={as("admin")} />);
    expect(screen.getByTestId("deactivate")).toBeInTheDocument();
    expect(screen.queryByTestId("card-send-invite")).toBeNull();
    unmount();
    for (const k of ["self", "colleague", "approver"] as const) {
      const r = render(<EmployeeCardView card={as(k)} />);
      expect(screen.queryByTestId("lifecycle-actions")).toBeNull();
      r.unmount();
    }
  });

  it("says what deactivating will do, needs all three answers, then says what it did", async () => {
    const user = userEvent.setup();
    api.getDeactivationPreview.mockResolvedValue({
      directReports: 0,
      pendingApprovals: 2,
      openPosting: { unitName: "Tata AIG, Hosur", since: "2025-06-01" },
      successors: [{ profileId: "p-mark", fullName: "Mark Manager" }],
    });
    api.deactivateEmployee.mockResolvedValue({
      reports_moved: 0,
      approvals_moved: 2,
      levels_collapsed: 0,
      postingClosed: { unitName: "Tata AIG, Hosur", lastDay: "2026-10-10" },
      status: "left",
      lastWorkingDay: "2026-10-10",
    });
    render(<EmployeeCardView card={as("admin")} />);
    await user.click(screen.getByTestId("deactivate"));

    expect(
      await screen.findByText(/posting at Tata AIG, Hosur closes on their last working day/),
    ).toBeInTheDocument();
    const confirm = screen.getByTestId("deactivate-confirm");
    expect(confirm).toBeDisabled();
    await user.selectOptions(screen.getByTestId("deactivate-successor"), "p-mark");
    const last = screen.getByTestId("deactivate-last-day");
    await user.clear(last);
    await user.type(last, "10102026");
    expect(confirm).toBeDisabled();
    await user.type(screen.getByTestId("deactivate-reason"), "Resigned");
    await user.click(confirm);

    expect(api.deactivateEmployee).toHaveBeenCalledWith(
      as("admin").id,
      "p-mark",
      "2026-10-10",
      "Resigned",
    );
    const done = await screen.findByTestId("deactivate-done");
    expect(done).toHaveTextContent("posting at Tata AIG, Hosur closed on 10 Oct 2026");
    expect(done).toHaveTextContent("2 waiting approvals moved to Mark Manager");
  });
});
