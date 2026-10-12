// @vitest-environment happy-dom

/**
 * The Directory. What it promises:
 *
 * - search goes to the server once, 200ms after the last keystroke;
 * - an older search answering late never replaces a newer one;
 * - a selected department stays selected, and SHOWN, when a search narrows
 *   the rows to people outside it (the "Reports to: Nobody" shape);
 * - "nobody matches" and "nobody here" are different answers.
 */

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryRow } from "../contracts";

const getDirectory = vi.hoisted(() => vi.fn());
vi.mock("../handlers", () => ({ getDirectory }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}));

import Directory, { SEARCH_DEBOUNCE_MS } from "./Directory";

function row(
  id: string,
  fullName: string,
  department: string,
  unit: string | null = null,
): DirectoryRow {
  return {
    id,
    employeeCode: null,
    fullName,
    workEmail: `${id}@acme.test`,
    mobile: null,
    designation: null,
    department,
    reportsTo: null,
    deployedUnit: unit,
    dateOfJoining: "2024-04-01",
    status: "working",
    isActive: true,
    hasSignedIn: true,
    adminRole: null,
    stage: "active",
  };
}

const EVERYBODY = [
  row("a", "Alice Admin", "Corporate"),
  row("p", "Priya Employee", "Operations", "Tata AIG, Hosur"),
  row("r", "Ravi Employee", "Operations"),
];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  getDirectory.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

function names() {
  return screen
    .queryAllByTestId("directory-row")
    .map((r) => within(r).getAllByRole("cell")[0].textContent);
}

describe("Directory", () => {
  it("searches once, 200ms after the last keystroke", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    getDirectory.mockResolvedValue(EVERYBODY);
    render(<Directory />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(getDirectory).toHaveBeenCalledTimes(1);

    getDirectory.mockResolvedValue([EVERYBODY[1]]);
    await user.type(screen.getByTestId("directory-search"), "pri");
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 50));
    expect(getDirectory).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(60));
    expect(getDirectory).toHaveBeenCalledTimes(2);
    expect(getDirectory).toHaveBeenLastCalledWith("pri");
    expect(names()).toEqual(["Priya Employee"]);
  });

  it("drops a late answer to an older search", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    getDirectory.mockResolvedValueOnce(EVERYBODY);
    render(<Directory />);
    await act(() => vi.advanceTimersByTimeAsync(0));

    let answerOld!: (r: DirectoryRow[]) => void;
    getDirectory.mockImplementationOnce(() => new Promise((res) => (answerOld = res)));
    await user.type(screen.getByTestId("directory-search"), "a");
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 10));

    getDirectory.mockResolvedValueOnce([EVERYBODY[2]]);
    await user.type(screen.getByTestId("directory-search"), "ravi");
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 10));
    expect(names()).toEqual(["Ravi Employee"]);

    await act(async () => answerOld(EVERYBODY));
    expect(names()).toEqual(["Ravi Employee"]);
  });

  it("keeps a selected department selected and shown when a search leaves nobody in it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    getDirectory.mockResolvedValueOnce(EVERYBODY);
    render(<Directory />);
    await act(() => vi.advanceTimersByTimeAsync(0));

    const dept = screen.getByTestId("filter-department") as HTMLSelectElement;
    await user.selectOptions(dept, "Corporate");
    expect(names()).toEqual(["Alice Admin"]);

    getDirectory.mockResolvedValueOnce([EVERYBODY[1], EVERYBODY[2]]); // nobody in Corporate
    await user.type(screen.getByTestId("directory-search"), "employee");
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 10));

    expect(dept.selectedOptions[0].textContent).toBe("Corporate");
    expect(names()).toEqual([]);
    expect(screen.getByTestId("directory-empty")).toHaveTextContent("Nobody matches");
  });

  it("tells an empty company apart from an empty search", async () => {
    getDirectory.mockResolvedValueOnce([]);
    render(<Directory />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByTestId("directory-empty")).toHaveTextContent("Nobody here yet.");
  });
});
