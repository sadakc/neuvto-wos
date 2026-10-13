// @vitest-environment happy-dom

/**
 * The date field (D104): typed as DD/MM/YYYY, or picked from a calendar whose
 * month and year are dropdowns. Half a date is never taken for no date.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DateField } from "./date-field";
import { isIsoDate } from "./date-rules";

function Form({ start = "", max, openAt }: { start?: string; max?: string; openAt?: string }) {
  const [v, setV] = useState(start);
  return (
    <>
      <DateField value={v} onChange={setV} label="Date of birth" max={max} openAt={openAt} />
      <output data-testid="value">{v}</output>
    </>
  );
}
const value = () => screen.getByTestId("value").textContent;
const box = () => screen.getByRole("textbox", { name: "Date of birth" });

describe("typing a date", () => {
  it("puts the slashes in as the digits are typed, and holds the date as ISO", async () => {
    const u = userEvent.setup();
    render(<Form />);
    await u.type(box(), "0105");
    expect(box()).toHaveValue("01/05");
    // Half a date is kept as typed, never as an empty date.
    expect(value()).toBe("01/05");
    expect(isIsoDate(value()!)).toBe(false);
    await u.type(box(), "1990");
    expect(box()).toHaveValue("01/05/1990");
    expect(value()).toBe("1990-05-01");
  });

  it("does not take a day that does not exist", async () => {
    const u = userEvent.setup();
    render(<Form />);
    await u.type(box(), "31022020");
    expect(value()).toBe("31/02/2020");
    expect(isIsoDate(value()!)).toBe(false);
  });

  it("takes a pasted ISO date, shows what is on record, and empties to nothing", async () => {
    const u = userEvent.setup();
    render(<Form start="2001-12-25" />);
    expect(box()).toHaveValue("25/12/2001");
    await u.clear(box());
    expect(value()).toBe("");
    await u.click(box());
    await u.paste("1990-05-01");
    expect(box()).toHaveValue("01/05/1990");
    expect(value()).toBe("1990-05-01");
  });
});

describe("picking a date", () => {
  it("chooses the year and month from dropdowns, then the day", async () => {
    const u = userEvent.setup();
    render(<Form max="2012-10-13" openAt="1996-10-13" />);
    await u.click(screen.getByRole("button", { name: "Choose date of birth from a calendar" }));
    const dialog = await screen.findByRole("dialog");
    const [month, year] = within(dialog).getAllByRole("combobox") as HTMLSelectElement[];
    // It opens where a date of birth usually is, not on today.
    expect(year.value).toBe("1996");
    // Nothing after the latest date allowed is offered.
    expect([...year.options].map((o) => o.value).at(-1)).toBe("2012");
    await u.selectOptions(year, "1990");
    await u.selectOptions(month, "4");
    await u.click(within(dialog).getByRole("button", { name: /May 1st, 1990/ }));
    expect(value()).toBe("1990-05-01");
    expect(box()).toHaveValue("01/05/1990");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("has Today, offered only when today is allowed, and Clear", async () => {
    const u = userEvent.setup();
    render(<Form start="2001-12-25" />);
    await u.click(screen.getByRole("button", { name: "Choose date of birth from a calendar" }));
    await u.click(await screen.findByRole("button", { name: "Today" }));
    expect(isIsoDate(value()!)).toBe(true);
    await u.click(screen.getByRole("button", { name: "Choose date of birth from a calendar" }));
    await u.click(await screen.findByRole("button", { name: "Clear" }));
    expect(value()).toBe("");
    expect(box()).toHaveValue("");
  });

  it("does not offer Today for a date that must be years ago", async () => {
    const u = userEvent.setup();
    render(<Form max="2012-10-13" />);
    await u.click(screen.getByRole("button", { name: "Choose date of birth from a calendar" }));
    expect(await screen.findByRole("button", { name: "Today" })).toBeDisabled();
  });
});
