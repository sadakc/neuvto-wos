/**
 * Bringing a company's existing staff in, from a spreadsheet.
 *
 * This creates INVITATIONS, not employees, and that is not a shortcut — it is
 * the only thing possible. `profiles.id` references `auth.users`, so nobody has
 * a profile until they have an auth account, and D39 says the only route to one
 * is accepting an invitation. Everything the file knows about somebody rides on
 * the invitation until they arrive.
 *
 * Parsing happens here rather than in the database because the errors that
 * matter are per row, and `invitation_create` already raises exactly the ones
 * worth reporting — INVALID_EMAIL, ALREADY_A_MEMBER, ALREADY_INVITED. The
 * report is the database's answer rather than a second opinion that can drift
 * from it.
 */

import { supabase } from "@/integrations/supabase/client";
import { APP_ROLES, type AppRole } from "./contracts";

export interface ImportRow {
  /** 1-based, and counting the header — the number the person sees in their spreadsheet. */
  line: number;
  email: string;
  fullName: string;
  joinedDate: string;
  managerEmail: string;
  department: string;
  role: AppRole;
}

export type RowOutcome = "will-import" | "warning" | "error" | "imported" | "failed";

export interface RowResult {
  row: ImportRow;
  outcome: RowOutcome;
  /** Why it failed, or what will be missing if it imports anyway. */
  message?: string;
}

export const REQUIRED_COLUMNS = ["email", "full_name", "joined_date"] as const;
export const OPTIONAL_COLUMNS = ["manager_email", "department", "role", "phone"] as const;

/**
 * A CSV parser that handles quoted fields, because a spreadsheet exported from
 * Excel will contain `"Patel, Priya"` and splitting on commas turns one person
 * into two columns and a silent mess.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export interface ParsedFile {
  rows: ImportRow[];
  /** Columns the file is missing entirely — nothing can be imported without these. */
  missingColumns: string[];
}

export function parseImportFile(text: string): ParsedFile {
  const grid = parseCsv(text);
  if (grid.length === 0) return { rows: [], missingColumns: [...REQUIRED_COLUMNS] };

  const header = grid[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missingColumns.length > 0) return { rows: [], missingColumns };

  const at = (cells: string[], name: string) => {
    const i = header.indexOf(name);
    return i === -1 ? "" : (cells[i] ?? "").trim();
  };

  return {
    missingColumns: [],
    rows: grid.slice(1).map((cells, i) => {
      const raw = at(cells, "role").toLowerCase().replace(/\s+/g, "_");
      return {
        line: i + 2, // +1 for the header, +1 because spreadsheets count from one
        email: at(cells, "email").toLowerCase(),
        fullName: at(cells, "full_name"),
        joinedDate: at(cells, "joined_date"),
        managerEmail: at(cells, "manager_email").toLowerCase(),
        department: at(cells, "department"),
        role: (APP_ROLES as readonly string[]).includes(raw) ? (raw as AppRole) : "employee",
      };
    }),
  };
}

/** What the workspace already contains, so the dry run can say so before sending anything. */
async function existingAddresses(): Promise<{ members: Set<string>; invited: Set<string> }> {
  const [{ data: profiles }, { data: invitations }] = await Promise.all([
    supabase.from("profiles").select("email"),
    supabase.from("invitations").select("email, accepted_at, revoked_at"),
  ]);
  return {
    members: new Set((profiles ?? []).map((p) => p.email.toLowerCase())),
    invited: new Set(
      (invitations ?? [])
        .filter((i) => !i.accepted_at && !i.revoked_at)
        .map((i) => i.email.toLowerCase()),
    ),
  };
}

/**
 * What would happen, without anything happening.
 *
 * Everything here is a prediction. The import itself reports what the database
 * actually did, and the two can differ — a colleague could invite somebody in
 * between. That is why this is a dry run and not a promise.
 */
export async function dryRun(rows: ImportRow[], knownDepartments: string[]): Promise<RowResult[]> {
  const { members, invited } = await existingAddresses();
  const seen = new Map<string, number>();
  const departments = new Set(knownDepartments.map((d) => d.toLowerCase()));
  const emailsInFile = new Set(rows.map((r) => r.email).filter(Boolean));

  return rows.map((row) => {
    const fail = (message: string): RowResult => ({ row, outcome: "error", message });

    if (!row.email) return fail("No email address.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) return fail("That email is not valid.");
    if (!row.fullName) return fail("No name.");

    if (!row.joinedDate) return fail("No start date.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.joinedDate)) {
      return fail("Start date must be YYYY-MM-DD.");
    }
    const parsed = new Date(row.joinedDate + "T00:00:00Z");
    if (Number.isNaN(parsed.getTime())) return fail("That start date is not a real date.");

    const duplicateOf = seen.get(row.email);
    if (duplicateOf !== undefined) return fail(`Same address as row ${duplicateOf}.`);
    seen.set(row.email, row.line);

    if (members.has(row.email)) return fail("Already in this workspace.");
    if (invited.has(row.email)) return fail("Already invited and waiting to accept.");

    // Warnings — these import. A missing manager is recoverable in People, and
    // failing the row would block somebody over a detail they can fix later.
    const notes: string[] = [];
    if (row.managerEmail && !members.has(row.managerEmail) && !emailsInFile.has(row.managerEmail)) {
      notes.push(`Manager ${row.managerEmail} is not in this file or this workspace`);
    }
    if (row.department && !departments.has(row.department.toLowerCase())) {
      notes.push(`No department called "${row.department}"`);
    }

    return notes.length > 0
      ? { row, outcome: "warning", message: notes.join("; ") + " — they will join without it." }
      : { row, outcome: "will-import" };
  });
}

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL: "That email is not valid.",
  ALREADY_A_MEMBER: "Already in this workspace.",
  ALREADY_INVITED: "Already invited and waiting to accept.",
  PHONE_ALREADY_A_MEMBER: "That phone number belongs to somebody already here.",
  PHONE_ALREADY_INVITED: "That phone number is on another pending invitation.",
  FORBIDDEN: "Only an administrator can invite people.",
};

/**
 * Sends them, one row at a time, and reports what each one actually did.
 *
 * Deliberately sequential and deliberately not transactional: **partial success
 * is the point.** Row 7 failing must not stop rows 8 to 50, and must leave
 * nothing behind for row 7 — test scenario 20, which has been in the spec since
 * the first draft with nothing behind it.
 */
export async function runImport(
  rows: ImportRow[],
  departmentIdByName: Map<string, string>,
): Promise<RowResult[]> {
  const results: RowResult[] = [];

  for (const row of rows) {
    const { error } = await supabase.rpc("invitation_create", {
      _email: row.email,
      _phone: undefined,
      _role: row.role,
      _full_name: row.fullName || undefined,
      _joined_date: row.joinedDate,
      _manager_email: row.managerEmail || undefined,
      _department_id: departmentIdByName.get(row.department.toLowerCase()) ?? undefined,
    } as never);

    if (!error) {
      results.push({ row, outcome: "imported" });
      continue;
    }
    const code = Object.keys(MESSAGES).find((k) => (error.message ?? "").includes(k));
    results.push({
      row,
      outcome: "failed",
      message: code ? MESSAGES[code] : "That row could not be invited.",
    });
  }

  return results;
}
