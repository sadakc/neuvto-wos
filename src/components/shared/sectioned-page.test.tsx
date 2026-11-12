// @vitest-environment happy-dom

/**
 * Doc 11.4: a page of sections (Settings, a module's Configuration) is a
 * vertical list on a phone, then one section at a time. Never a row that
 * scrolls sideways. Above 600px, the two panes as before.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PhoneProvider } from "@/platform/shell";
import { SectionedPage } from "./sectioned-page";

const sections = [
  { id: "identity", label: "Company identity", content: <p>identity form</p> },
  { id: "holidays", label: "Holidays", content: <p>holiday list</p> },
];

describe("a page of sections", () => {
  it("is a list of its sections on a phone, numbered, with none open", () => {
    render(
      <PhoneProvider phone>
        <SectionedPage title="Settings" sections={sections} testIdPrefix="settings" />
      </PhoneProvider>,
    );
    expect(screen.getByTestId("settings-identity")).toHaveTextContent("01 Company identity");
    expect(screen.getByTestId("settings-holidays")).toHaveTextContent("02 Holidays");
    expect(screen.queryByText("identity form")).toBeNull();
    expect(document.querySelector(".overflow-x-auto")).toBeNull();
  });

  it("shows the one chosen, and only it", async () => {
    const user = userEvent.setup();
    render(
      <PhoneProvider phone>
        <SectionedPage title="Settings" sections={sections} testIdPrefix="settings" />
      </PhoneProvider>,
    );
    await user.click(screen.getByTestId("settings-holidays"));
    expect(screen.getByText("holiday list")).toBeInTheDocument();
    expect(screen.queryByText("identity form")).toBeNull();
    expect(screen.queryByTestId("settings-identity")).toBeNull();
  });

  it("keeps its two panes above 600px, the first section open", () => {
    render(<SectionedPage title="Settings" sections={sections} testIdPrefix="settings" />);
    expect(screen.getByText("identity form")).toBeInTheDocument();
    expect(screen.getByTestId("settings-holidays")).toBeInTheDocument();
  });
});
