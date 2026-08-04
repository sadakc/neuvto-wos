// @vitest-environment happy-dom

/**
 * The platform's status badge, tested without any module's vocabulary.
 *
 * This file originally imported `@/modules/leave/status` to check the leave
 * mapping, and CI refused it — correctly. `components/shared` is platform code,
 * and a platform file that names a module means deleting that module breaks the
 * build. `scripts/verify-module-removal.sh` proved exactly that. The leave
 * mapping is tested in `src/modules/leave/status.test.ts`, where it belongs.
 *
 * What is left here is the promise the component itself makes: a tone renders
 * as a tinted fill by default, a solid fill uses its paired foreground, and
 * whatever you put inside is still readable as text.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, type StatusTone } from "./status-badge";

const TONES: StatusTone[] = ["success", "warning", "destructive", "info", "neutral"];

describe("colour is never the only signal", () => {
  it.each(TONES)("%s still renders its label as text", (tone) => {
    // Around one in twelve men has a colour vision deficiency, and red/green is
    // the common axis — which in this product is the declined/approved axis. A
    // badge carrying no text is unreadable to them, and to anyone printing in
    // greyscale. The colour is emphasis on the label, not a substitute for it.
    render(<StatusBadge tone={tone}>Some status</StatusBadge>);
    expect(screen.getByText("Some status")).toBeInTheDocument();
  });
});

describe("emphasis", () => {
  it("defaults to the tinted fill, not the solid one", () => {
    // Thirty rows in solid amber and green is a fruit salad nobody can scan.
    // Solid is for the one status that is the point of the page.
    const { container } = render(<StatusBadge tone="warning">Awaiting approval</StatusBadge>);
    const badge = container.querySelector("[data-tone]");
    expect(badge?.className).toContain("bg-warning-muted");
    expect(badge?.className).not.toContain("text-warning-foreground");
  });

  it("uses the paired foreground on a solid fill", () => {
    // Body-coloured text on a solid fill is the contrast bug this pairing
    // exists to prevent; tokens.test.ts proves each pair meets AA.
    const { container } = render(
      <StatusBadge tone="warning" emphasis="solid">
        Awaiting approval
      </StatusBadge>,
    );
    const badge = container.querySelector("[data-tone]");
    expect(badge?.className).toContain("bg-warning");
    expect(badge?.className).toContain("text-warning-foreground");
  });

  it.each(TONES)("%s has a class for both emphases", (tone) => {
    // A tone missing from either map renders `undefined` in the class string —
    // an unstyled badge, which reads as a styling glitch rather than a gap.
    for (const emphasis of ["subtle", "solid"] as const) {
      const { container } = render(
        <StatusBadge tone={tone} emphasis={emphasis}>
          x
        </StatusBadge>,
      );
      expect(container.querySelector("[data-tone]")?.className).not.toContain("undefined");
    }
  });
});
