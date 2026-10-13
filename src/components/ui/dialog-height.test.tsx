// @vitest-environment happy-dom

/**
 * Every dialog fits a phone held sideways (13 Oct 2026 orientation sweep).
 *
 * At 780x360 a confirmation with a few sentences ran off the top and bottom of
 * the screen, and a fixed, centred box cannot be scrolled from outside. The
 * shared dialogs cap their own height and scroll inside, so no screen has to
 * remember to.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from "./alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

describe("shared dialogs", () => {
  it("cap their height to the screen and scroll inside", () => {
    render(
      <Dialog open>
        <DialogContent data-testid="d">
          <DialogTitle>A dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByTestId("d").className).toMatch(/max-h-\[calc\(100dvh-2rem\)\]/);
    expect(screen.getByTestId("d").className).toMatch(/overflow-y-auto/);
  });

  it("and so do confirmations", () => {
    render(
      <AlertDialog open>
        <AlertDialogContent data-testid="a">
          <AlertDialogTitle>A confirmation</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(screen.getByTestId("a").className).toMatch(/max-h-\[calc\(100dvh-2rem\)\]/);
    expect(screen.getByTestId("a").className).toMatch(/overflow-y-auto/);
  });
});
