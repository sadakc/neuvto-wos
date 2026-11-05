// @vitest-environment happy-dom

/**
 * The four Leave reports added in phase 2 (D94), each through the platform's
 * report frame. What it pins, per report: it asks the database for the right
 * window (this month by default, the organisation's month), and each column
 * says what the database said, in the words and numbers an administrator
 * reads. Liability says plainly that its figures are days, not money.
 */

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getLeaveLiability: vi.fn(),
  getCompOffRegister: vi.fn(),
  getApprovalTurnaround: vi.fn(),
  getAbsenteeism: vi.fn(),
}));
vi.mock("../handlers", () => h);
vi.mock("@/platform/reports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/platform/reports")>()),
  useOrgClock: () => ({ today: "2026-10-12", timeZone: "Asia/Kolkata" }),
}));

import LeaveLiabilityReport from "./LeaveLiabilityReport";
import CompOffRegisterReport from "./CompOffRegisterReport";
import ApprovalTurnaroundReport from "./ApprovalTurnaroundReport";
import AbsenteeismReport from "./AbsenteeismReport";

beforeEach(() => {
  vi.resetAllMocks();
  h.getLeaveLiability.mockResolvedValue([
    {
      employeeId: "ravi",
      employeeName: "Ravi Employee",
      departmentName: "Operations",
      leaveTypeName: "Casual",
      kind: "paid",
      fyLabel: "2026-27",
      notTakenDays: 10,
      bookedDays: 3,
      freeDays: 7,
    },
  ]);
  h.getCompOffRegister.mockResolvedValue([
    {
      claimId: "c1",
      employeeName: "Ravi Employee",
      departmentName: null,
      leaveTypeName: "Comp off",
      daysWorked: "2026-10-04, 2026-10-05 (half)",
      totalDays: 1.5,
      reason: "Audit weekend",
      status: "approved",
      submittedOn: "2026-10-06",
      decidedOn: "2026-10-07",
      expiresOn: "2027-01-05",
      expiredDays: 0,
      hasProof: true,
    },
  ]);
  h.getApprovalTurnaround.mockResolvedValue([
    {
      stepId: "s1",
      what: "leave request",
      employeeName: "Priya Employee",
      level: 1,
      approverName: "Mark Manager",
      decidedByName: "Hema HR",
      decision: "approved",
      reachedAt: "2026-10-01T04:00:00Z",
      decidedAt: "2026-10-03T04:00:00Z",
      daysTaken: 2,
      movedUp: true,
    },
  ]);
  h.getAbsenteeism.mockResolvedValue([
    {
      employeeId: "ravi",
      employeeName: "Ravi Employee",
      departmentName: "Operations",
      spells: 2,
      days: 4,
      unpaidDays: 0,
      bradfordFactor: 16,
    },
  ]);
});

const firstRow = async (slug: string) => (await screen.findAllByTestId(`${slug}-row`))[0];

describe("leave liability", () => {
  it("lists what is owed, booked and free, and says it is in days", async () => {
    render(<LeaveLiabilityReport />);
    const row = await firstRow("leave-liability");
    for (const text of ["Ravi Employee", "Operations", "Casual", "10", "3", "7"]) {
      expect(row).toHaveTextContent(text);
    }
    expect(screen.getByText(/in days, not money/)).toBeInTheDocument();
  });
});

describe("the comp-off register", () => {
  it("asks for this month and shows each claim's days and outcome", async () => {
    render(<CompOffRegisterReport />);
    const row = await firstRow("comp-off-register");
    expect(h.getCompOffRegister).toHaveBeenCalledWith("2026-10-01", "2026-10-31");
    for (const text of ["2026-10-04, 2026-10-05 (half)", "1.5", "Approved", "2027-01-05", "Yes"]) {
      expect(row).toHaveTextContent(text);
    }
  });
});

describe("approval turnaround", () => {
  it("asks for this month and says who decided, how long, and whether it moved up", async () => {
    render(<ApprovalTurnaroundReport />);
    const row = await firstRow("approval-turnaround");
    expect(h.getApprovalTurnaround).toHaveBeenCalledWith("2026-10-01", "2026-10-31");
    for (const text of [
      "Leave request",
      "Priya Employee",
      "Mark Manager",
      "Hema HR",
      "Approved",
      "2",
      "Yes",
    ]) {
      expect(row).toHaveTextContent(text);
    }
    expect(within(row).getByText("2026-10-03")).toBeInTheDocument();
  });
});

describe("absenteeism", () => {
  it("asks for this month and shows absences, days and the Bradford factor", async () => {
    render(<AbsenteeismReport />);
    const row = await firstRow("absenteeism");
    expect(h.getAbsenteeism).toHaveBeenCalledWith("2026-10-01", "2026-10-31");
    for (const text of ["Ravi Employee", "Operations", "2", "4", "16"]) {
      expect(row).toHaveTextContent(text);
    }
  });
});
