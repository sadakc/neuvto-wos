// @vitest-environment happy-dom

/**
 * Choosing a file (D104): a Browse button anyone can see, the file's name once
 * chosen, and Remove to unchoose it.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import { FilePicker } from "./file-picker";

function Form() {
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <FilePicker label="File" file={file} onChange={setFile} testId="pick" />
      <output data-testid="chosen">{file?.name ?? "none"}</output>
    </>
  );
}

it("offers Browse, names the file chosen, and takes it back on Remove", async () => {
  const u = userEvent.setup();
  render(<Form />);
  expect(screen.getByRole("button", { name: "Browse…" })).toBeVisible();
  expect(screen.getByText("No file chosen")).toBeInTheDocument();

  const file = new File(["x".repeat(3000)], "cheque.jpg", { type: "image/jpeg" });
  await u.upload(screen.getByLabelText("File"), file);
  expect(screen.getByTestId("pick-name")).toHaveTextContent("cheque.jpg");
  expect(screen.getByText("3 KB")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Choose another" })).toBeInTheDocument();
  expect(screen.getByTestId("chosen")).toHaveTextContent("cheque.jpg");

  await u.click(screen.getByRole("button", { name: "Remove cheque.jpg" }));
  expect(screen.getByTestId("chosen")).toHaveTextContent("none");
  expect(screen.getByText("No file chosen")).toBeInTheDocument();
});
