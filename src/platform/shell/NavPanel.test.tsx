// @vitest-environment happy-dom
/**
 * The one dropdown behind More, Company, the section picker and the module
 * overflow. TabBar.test.tsx proves Escape; this proves the other two ways it
 * promises to close, and the one way it must not: a tap inside it that is not
 * a choice (a heading, the padding) leaves it open.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { NavPanel } from "./NavPanel";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    onClick,
    ...rest
  }: {
    children?: React.ReactNode;
    to: string;
    search?: Record<string, string>;
    onClick?: () => void;
  } & Record<string, unknown>) => (
    <a
      href={to + (search ? `?${new URLSearchParams(search)}` : "")}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

function Harness() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <p>Somewhere else on the page</p>
      <div style={{ position: "relative" }}>
        <button ref={trigger} type="button" onClick={() => setOpen((v) => !v)}>
          Open
        </button>
        <NavPanel
          id="panel"
          open={open}
          onClose={() => setOpen(false)}
          trigger={trigger}
          groups={[
            {
              heading: "For your team",
              items: [
                { key: "a", label: "Approvals", to: "/app/approvals" },
                { key: "b", label: "Calendar", to: "/app/leave/calendar" },
              ],
            },
          ]}
        />
      </div>
    </div>
  );
}

async function opened() {
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(screen.getByRole("menu")).toBeInTheDocument();
}

describe("NavPanel", () => {
  it("closes on a click outside it", async () => {
    await opened();
    await userEvent.click(screen.getByText("Somewhere else on the page"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on choosing an item", async () => {
    await opened();
    await userEvent.click(screen.getByRole("menuitem", { name: "Calendar" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open on a click inside it that is not a choice", async () => {
    await opened();
    await userEvent.click(screen.getByText("For your team"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
