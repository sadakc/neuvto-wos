/**
 * The bank file — who to pay, how much, and into which account.
 *
 * The narrowest report here on purpose. It is uploaded to a bank, so every
 * column it carries is a column somebody has to map, and a salary breakdown in
 * a payment file is information the bank has no business holding.
 *
 * ANYBODY WITHOUT AN ACCOUNT NUMBER STILL APPEARS, with the cell blank. Leaving
 * them out would produce a file that reconciles against itself and quietly
 * fails to pay somebody — the exact failure the row-49 VLOOKUP causes today.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReportView, type ReportColumn } from "@/platform/reports";
import { RunPicker } from "./RunPicker";
import { usePayRunReport } from "./usePayRunReport";
import type { PayslipLine } from "../contracts";

interface BankRow extends PayslipLine {
  bankName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
}

const COLUMNS: ReportColumn<BankRow>[] = [
  { header: "Employee code", value: (r) => r.employeeCode },
  { header: "Employee", value: (r) => r.employeeName },
  { header: "Bank", value: (r) => r.bankName },
  { header: "Account number", value: (r) => r.accountNumber },
  { header: "IFSC", value: (r) => r.ifsc },
  { header: "Net payable", value: (r) => r.netPayable, numeric: true },
];

export default function BankStatementReport() {
  const { runs, runId, setRunId, lines, state, error, today } = usePayRunReport();
  const [rows, setRows] = useState<BankRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("payroll_employee_details")
        .select("employee_id, bank_name, bank_account_number, bank_ifsc")
        .is("deleted_at", null);
      if (cancelled) return;
      const byEmployee = new Map((data ?? []).map((d) => [d.employee_id, d]));
      setRows(
        lines.map((l) => ({
          ...l,
          bankName: byEmployee.get(l.employeeId)?.bank_name ?? null,
          accountNumber: byEmployee.get(l.employeeId)?.bank_account_number ?? null,
          ifsc: byEmployee.get(l.employeeId)?.bank_ifsc ?? null,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [lines]);

  const missing = rows.filter((r) => !r.accountNumber).length;

  return (
    <ReportView
      slug="bank-statement"
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.employeeId}
      state={state}
      error={error}
      today={today}
      empty="Nothing has been computed for this month yet."
      filters={
        <div className="flex flex-wrap items-center gap-3">
          <RunPicker runs={runs} runId={runId} onChange={setRunId} />
          {missing > 0 && (
            <p className="text-sm text-warning">
              {missing} {missing === 1 ? "person has" : "people have"} no account number. They are
              in the file with the cell blank, not left out of it.
            </p>
          )}
        </div>
      }
    />
  );
}
