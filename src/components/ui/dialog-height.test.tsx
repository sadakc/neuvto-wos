// @vitest-environment happy-dom

/**
 * Every dialog fits a phone held sideways (13 Oct 2026 orientation sweep).
 *
 * At 780x360 a confirmation with a few sentences ran off the top and bottom of
 * the screen, and a fixed, centred box cannot be scrolled from outside. The
 * shared dialogs cap their own height and scroll inside, so no screen has to
 * remember to.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("are bottom sheets under 600px, both kinds (doc 11.5)", () => {
    render(
      <>
        <Dialog open>
          <DialogContent data-testid="d">
            <DialogTitle>A dialog</DialogTitle>
          </DialogContent>
        </Dialog>
        <AlertDialog open>
          <AlertDialogContent data-testid="a">
            <AlertDialogTitle>A confirmation</AlertDialogTitle>
          </AlertDialogContent>
        </AlertDialog>
      </>,
    );
    for (const id of ["d", "a"]) {
      const c = screen.getByTestId(id).className;
      expect(c).toMatch(/max-\[599px\]:bottom-0/);
      expect(c).toMatch(/max-\[599px\]:top-auto/);
      expect(c).toMatch(/max-\[599px\]:rounded-t-\[18px\]/);
      expect(c).toMatch(/max-\[599px\]:max-w-none/);
    }
  });
});

/**
 * An iPhone's keyboard covers the page instead of shrinking it, so a sheet
 * sized by CSS alone stays as tall as the screen and runs off the top: the
 * small-iPhone run on the iOS Simulator caught every tall sheet so (D120).
 * The sheet takes its height from what is visible, and follows it.
 */
describe("a sheet with the iPhone keyboard up", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is no taller than what the keyboard leaves, and follows it", () => {
    const vv = Object.assign(new EventTarget(), { height: 667 });
    vi.stubGlobal("visualViewport", vv);
    render(
      <Dialog open>
        <DialogContent data-testid="d">
          <DialogTitle>A sheet</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const sheet = screen.getByTestId("d");
    expect(sheet.className).toMatch(/max-\[599px\]:max-h-\[min\(.*var\(--sheet-room/);
    expect(sheet.style.getPropertyValue("--sheet-room")).toBe("667px");

    // The keyboard comes up.
    act(() => {
      vv.height = 451;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(sheet.style.getPropertyValue("--sheet-room")).toBe("451px");
  });
});
