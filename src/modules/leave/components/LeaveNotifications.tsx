/**
 * Who is told of Leave's approvals (D93): leave requests and compensatory off
 * claims. The matrix is the platform's; Leave contributes it as an admin
 * section, so the Leave Admin sets Leave's rows and nobody else's.
 */

import { NotificationMatrix } from "@/platform/approvals/NotificationMatrix";

export default function LeaveNotifications() {
  return <NotificationMatrix moduleKey="leave" adminLabel="Leave Admins" />;
}
