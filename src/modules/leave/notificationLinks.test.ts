/** Where Leave's notices open from the bell (D111). */

import { describe, expect, it } from "vitest";
import { leave } from "./index";

const link = (event: string) => leave.notificationLinks?.[event]?.({});

describe("Leave's notices", () => {
  it("open My Leave for your own request, sent or decided, and the reports for a summary", () => {
    expect(link("approval.sent")).toBe("/app/leave");
    expect(link("approval.completed")).toBe("/app/leave");
    expect(link("leave_summary.weekly")).toBe("/app/reports?m=leave");
  });

  it("leave a request waiting on you to the platform, which opens Leave approvals", () => {
    expect(link("approval.submitted")).toBeUndefined();
    // A level decided with more to come is the next approver's, not yours.
    expect(link("approval.decided")).toBeUndefined();
  });
});
