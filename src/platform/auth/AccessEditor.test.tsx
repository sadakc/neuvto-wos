// @vitest-environment happy-dom
/**
 * Changing somebody's access, as rendered (D78).
 *
 * The database is the enforcement and verify_company_access.sql proves it.
 * This proves the screen: what an Admin is offered, what a Super Admin is
 * offered, and the one way an Admin's edit could silently do damage, which is
 * dropping an administrator role it was never shown.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppError } from "@/platform/errors";
import { AccessEditor } from "./AccessEditor";
import type { AppRole } from "./contracts";

function renderEditor(
  roles: AppRole[],
  callerIsSuperAdmin: boolean,
  onSave = vi.fn(async () => {}),
) {
  render(
    <AccessEditor
      personName="Dan Director"
      roles={roles}
      callerIsSuperAdmin={callerIsSuperAdmin}
      onSave={onSave}
      onCancel={() => {}}
    />,
  );
  return onSave;
}

describe("an Admin who is not a Super Admin", () => {
  it("is offered the approver roles and no administrator or data role", () => {
    renderEditor(["employee"], false);
    for (const r of ["manager", "supervisor", "coordinator"]) {
      expect(screen.getByTestId(`role-${r}`)).toBeEnabled();
    }
    for (const r of [
      "super_admin",
      "org_admin",
      "hr_admin",
      "payroll_officer",
      "statutory_officer",
    ]) {
      expect(screen.queryByTestId(`role-${r}`), r).toBeNull();
    }
  });

  it("sees an administrator role the person already holds, but cannot change it", () => {
    renderEditor(["org_admin", "manager"], false);
    const admin = screen.getByTestId("role-org_admin");
    expect(admin).toBeChecked();
    expect(admin).toBeDisabled();
    expect(screen.getByText(/Granted by a Super Admin/)).toBeInTheDocument();
  });

  it("sends that administrator role back unchanged when saving an approver change", async () => {
    // The damage this guards against: editing approvers and losing the
    // administrator role by omission, because the set is sent whole.
    const onSave = renderEditor(["org_admin", "manager"], false);
    await userEvent.click(screen.getByTestId("role-supervisor"));
    await userEvent.click(screen.getByTestId("access-save"));
    expect(onSave).toHaveBeenCalledWith(["org_admin", "manager", "supervisor"]);
  });
});

describe("a Super Admin", () => {
  it("is offered every role", () => {
    renderEditor(["employee"], true);
    for (const r of [
      "super_admin",
      "org_admin",
      "hr_admin",
      "manager",
      "supervisor",
      "coordinator",
      "payroll_officer",
      "statutory_officer",
    ]) {
      expect(screen.getByTestId(`role-${r}`), r).toBeEnabled();
    }
  });

  it("can make somebody a Super Admin", async () => {
    const onSave = renderEditor(["employee"], true);
    await userEvent.click(screen.getByTestId("role-super_admin"));
    await userEvent.click(screen.getByTestId("access-save"));
    expect(onSave).toHaveBeenCalledWith(["super_admin"]);
  });

  it("removing every role sends Employee, never an empty set", async () => {
    const onSave = renderEditor(["manager"], true);
    await userEvent.click(screen.getByTestId("role-manager"));
    await userEvent.click(screen.getByTestId("access-save"));
    expect(onSave).toHaveBeenCalledWith(["employee"]);
  });
});

describe("saving", () => {
  it("cannot save until something has changed, and says so", () => {
    renderEditor(["manager"], true);
    expect(screen.getByTestId("access-save")).toBeDisabled();
    expect(screen.getByText("Nothing has changed yet.")).toBeInTheDocument();
  });

  it("shows the database's refusal in its own words, inside the panel", async () => {
    const onSave = vi.fn(async () => {
      throw new AppError("VALIDATION_FAILED", "They're the only Super Admin.", 400);
    });
    renderEditor(["super_admin"], true, onSave);
    await userEvent.click(screen.getByTestId("role-super_admin"));
    await userEvent.click(screen.getByTestId("access-save"));
    expect(await screen.findByTestId("access-error")).toHaveTextContent(
      "They're the only Super Admin.",
    );
  });
});
