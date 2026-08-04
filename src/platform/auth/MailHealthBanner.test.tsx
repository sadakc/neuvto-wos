// @vitest-environment happy-dom

/**
 * The alarm that exists because there wasn't one.
 *
 * Three invitations failed on production across twelve hours in complete
 * silence. These tests pin the three things that make this component worth
 * having, and each was watched failing before it was believed.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MailHealthBanner } from "./MailHealthBanner";
import type { MailHealth } from "./platform";

const HEALTHY: MailHealth = {
  healthy: true,
  failed24h: 0,
  pendingNow: 0,
  oldestPendingMinutes: 0,
  lastSentAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  lastFailureAt: null,
  lastFailureReason: null,
};

// The real shape of the 3 Aug outage, reason included.
const BROKEN: MailHealth = {
  healthy: false,
  failed24h: 3,
  pendingNow: 0,
  oldestPendingMinutes: 0,
  lastSentAt: null,
  lastFailureAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  lastFailureReason: 'HTTP 401: {"statusCode":401,"message":"API key is invalid"}',
};

describe("MailHealthBanner", () => {
  it("shouts when mail is failing, and says how many", () => {
    render(<MailHealthBanner health={BROKEN} />);
    const alert = screen.getByTestId("mail-health-alert");
    expect(alert).toHaveTextContent("Mail is not being delivered");
    expect(alert).toHaveTextContent("3");
    // role=alert so it is announced, not merely coloured red.
    expect(alert).toHaveAttribute("role", "alert");
  });

  it("shows the provider's own words, because that is the fix", () => {
    // "API key is invalid" was the entire answer on 3 Aug. Translating it into
    // something friendlier would have removed the only useful information.
    render(<MailHealthBanner health={BROKEN} />);
    expect(screen.getByTestId("mail-health-reason")).toHaveTextContent("API key is invalid");
  });

  it("says nothing is lost, because nothing is", () => {
    // The queue holds. Somebody reading this at 2am should not start
    // re-inviting people by hand and create duplicates.
    render(<MailHealthBanner health={BROKEN} />);
    expect(screen.getByTestId("mail-health-alert")).toHaveTextContent(/nothing is lost/i);
  });

  it("still says something when healthy", () => {
    // A banner that appears only on failure is indistinguishable from a banner
    // that is broken. Silence must never be the success state.
    render(<MailHealthBanner health={HEALTHY} />);
    expect(screen.getByTestId("mail-health-ok")).toHaveTextContent("Mail is being delivered");
    expect(screen.queryByTestId("mail-health-alert")).toBeNull();
  });

  it("distinguishes 'could not check' from 'all clear'", () => {
    // The check failing is its own state. Claiming health here would be
    // inventing a fact, and claiming failure would cry wolf.
    render(<MailHealthBanner health={null} />);
    expect(screen.getByTestId("mail-health-unknown")).toHaveTextContent("could not be checked");
    expect(screen.queryByTestId("mail-health-ok")).toBeNull();
    expect(screen.queryByTestId("mail-health-alert")).toBeNull();
  });

  it("reports a stuck queue even with nothing failed", () => {
    // The other shape of the outage: nothing errors, mail simply stops moving.
    // Counting only failures would call this healthy.
    render(
      <MailHealthBanner
        health={{ ...HEALTHY, healthy: false, pendingNow: 7, oldestPendingMinutes: 42 }}
      />,
    );
    const alert = screen.getByTestId("mail-health-alert");
    expect(alert).toHaveTextContent("7");
    expect(alert).toHaveTextContent("42");
  });
});
