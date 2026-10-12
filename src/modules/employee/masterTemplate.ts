/**
 * The master template (D86): Neuvto's own replacement for the customer's
 * master sheet. Every field Neuvto keeps for a person, Aadhaar, PAN and bank
 * included, in one workbook of four tabs linked by Employee code.
 *
 * Repeating things are rows, never numbered columns: a person with five
 * children has five Family rows. That is why there is no "Son 1, Son 2".
 *
 * This file is the template's single definition: the workbook written for
 * download and the workbook read back are both built from it, and the keys are
 * the database's (employee_import_keys). Pure: no Excel library here, so it is
 * tested without one.
 */

export type ColumnKind = "text" | "date" | "number" | "choice" | "yesno";

export interface TemplateColumn {
  /** The header in the workbook. */
  header: string;
  /** The key the database takes. */
  key: string;
  kind: ColumnKind;
  required?: boolean;
  /** For a choice: what the person picks, and the code it becomes. */
  options?: readonly (readonly [label: string, code: string])[];
  /** One line on the Instructions tab. */
  help?: string;
}

export interface TemplateTab {
  /** The sheet name in the workbook, and what the screen calls it. */
  name: string;
  /** The key the database takes for this tab. */
  key: "people" | "family" | "nominees" | "previous";
  purpose: string;
  columns: readonly TemplateColumn[];
}

const RELATIONS = [
  ["Father", "father"],
  ["Mother", "mother"],
  ["Husband", "husband"],
  ["Wife", "wife"],
  ["Son", "son"],
  ["Daughter", "daughter"],
  ["Brother", "brother"],
  ["Sister", "sister"],
  ["Guardian", "guardian"],
  ["Other", "other"],
] as const;

const code: TemplateColumn = {
  header: "Employee code",
  key: "employeeCode",
  kind: "text",
  required: true,
  help: "Links this row to the person on the People tab.",
};

export const MASTER_TEMPLATE: readonly TemplateTab[] = [
  {
    name: "People",
    key: "people",
    purpose: "One row a person. Everything Neuvto keeps about them that happens once.",
    columns: [
      { ...code, help: "Unique in your company. Every other tab finds the person by it." },
      { header: "Full name", key: "fullName", kind: "text", required: true },
      { header: "Name as per ID", key: "nameAsPerId", kind: "text" },
      {
        header: "Work email",
        key: "email",
        kind: "text",
        help: "Where their invitation goes. Can be added later.",
      },
      { header: "Mobile", key: "mobile", kind: "text" },
      { header: "Alternate mobile", key: "alternateMobile", kind: "text" },
      { header: "Personal email", key: "personalEmail", kind: "text" },
      {
        header: "Sex",
        key: "sex",
        kind: "choice",
        options: [
          ["Male", "male"],
          ["Female", "female"],
          ["Other", "other"],
          ["Prefer not to say", "undisclosed"],
        ],
      },
      { header: "Date of birth", key: "dateOfBirth", kind: "date" },
      {
        header: "Marital status",
        key: "maritalStatus",
        kind: "choice",
        options: [
          ["Single", "single"],
          ["Married", "married"],
          ["Widowed", "widowed"],
          ["Divorced", "divorced"],
          ["Separated", "separated"],
        ],
      },
      { header: "Nationality", key: "nationality", kind: "text" },
      { header: "Native state", key: "nativeState", kind: "text" },
      {
        header: "Blood group",
        key: "bloodGroup",
        kind: "choice",
        options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((g) => [g, g] as const),
      },
      { header: "Education qualification", key: "educationQualification", kind: "text" },
      { header: "Emergency contact name", key: "emergencyContactName", kind: "text" },
      { header: "Emergency contact relation", key: "emergencyContactRelation", kind: "text" },
      { header: "Emergency contact phone", key: "emergencyContactPhone", kind: "text" },
      {
        header: "Designation",
        key: "designation",
        kind: "text",
        help: "Must match a designation in Configuration exactly.",
      },
      {
        header: "Department",
        key: "department",
        kind: "text",
        help: "Must match a department in Settings exactly.",
      },
      {
        header: "Reports to (email)",
        key: "reportsToEmail",
        kind: "text",
        help: "The email of somebody already in Neuvto.",
      },
      {
        header: "Employment type",
        key: "employmentType",
        kind: "choice",
        options: [
          ["Full time", "full_time"],
          ["Contract", "contract"],
          ["Apprentice", "apprentice"],
          ["Part time", "part_time"],
          ["Intern", "intern"],
          ["Consultant", "consultant"],
        ],
      },
      { header: "Date of joining", key: "joinedDate", kind: "date" },
      { header: "Re-joining date", key: "reJoiningDate", kind: "date" },
      { header: "Confirmed on", key: "confirmedOn", kind: "date" },
      {
        header: "Reason for leaving last organisation",
        key: "reasonForLeavingLastOrg",
        kind: "text",
      },
      { header: "Present address", key: "presentLine", kind: "text" },
      { header: "Present city", key: "presentCity", kind: "text" },
      { header: "Present district", key: "presentDistrict", kind: "text" },
      { header: "Present state", key: "presentState", kind: "text" },
      { header: "Present pincode", key: "presentPincode", kind: "text" },
      {
        header: "Living there since",
        key: "presentFrom",
        kind: "date",
        help: "Blank uses the date of joining.",
      },
      {
        header: "Permanent address same as present",
        key: "permanentSameAsPresent",
        kind: "yesno",
      },
      { header: "Permanent address", key: "permanentLine", kind: "text" },
      { header: "Permanent city", key: "permanentCity", kind: "text" },
      { header: "Permanent district", key: "permanentDistrict", kind: "text" },
      { header: "Permanent state", key: "permanentState", kind: "text" },
      { header: "Permanent pincode", key: "permanentPincode", kind: "text" },
      { header: "Nearest police station", key: "nearestPoliceStation", kind: "text" },
      {
        header: "Deployed unit",
        key: "deployedUnit",
        kind: "text",
        help: "Must match a deployment unit in Configuration exactly.",
      },
      {
        header: "Deployed from",
        key: "deployedFrom",
        kind: "date",
        help: "Blank uses the date of joining.",
      },
      {
        header: "Deployment order ref",
        key: "deploymentOrderRef",
        kind: "text",
        help: "Required when a deployed unit is given.",
      },
      { header: "Height (cm)", key: "heightCm", kind: "number" },
      { header: "Chest (cm)", key: "chestCm", kind: "number" },
      { header: "Weight (kg)", key: "weightKg", kind: "number" },
      {
        header: "Identity document",
        key: "identityDocumentType",
        kind: "choice",
        options: [
          ["Aadhaar", "aadhaar"],
          ["PAN", "pan"],
          ["Passport", "passport"],
          ["Voter ID", "voter_id"],
          ["Driving licence", "driving_licence"],
        ],
      },
      {
        header: "Aadhaar",
        key: "aadhaar",
        kind: "text",
        help: "Optional. 12 digits. Encrypted the moment it arrives.",
      },
      { header: "PAN", key: "pan", kind: "text", help: "Encrypted the moment it arrives." },
      { header: "UAN", key: "uan", kind: "text" },
      { header: "EPF number", key: "epfNumber", kind: "text" },
      { header: "ESIC number", key: "esicNumber", kind: "text" },
      { header: "Old UAN", key: "oldUan", kind: "text" },
      { header: "Old ESIC number", key: "oldEsicNumber", kind: "text" },
      { header: "Bank name", key: "bankName", kind: "text" },
      { header: "Branch", key: "branch", kind: "text" },
      {
        header: "Bank account number",
        key: "account",
        kind: "text",
        help: "Encrypted the moment it arrives.",
      },
      { header: "IFSC", key: "ifsc", kind: "text" },
      { header: "Account holder", key: "accountHolder", kind: "text" },
      {
        header: "Religion",
        key: "religion",
        kind: "text",
        help: "Optional, never required. Encrypted.",
      },
      {
        header: "Caste category",
        key: "casteCategory",
        kind: "choice",
        help: "Optional, never required. Encrypted.",
        options: [
          ["General", "general"],
          ["OBC", "obc"],
          ["SC", "sc"],
          ["ST", "st"],
          ["EWS", "ews"],
          ["Not disclosed", "not_disclosed"],
        ],
      },
      {
        header: "Disability",
        key: "disabilityStatus",
        kind: "choice",
        help: "Optional, never required. Encrypted.",
        options: [
          ["None", "none"],
          ["Disabled", "disabled"],
          ["Not disclosed", "not_disclosed"],
        ],
      },
      { header: "Disability percent", key: "disabilityPercent", kind: "number" },
    ],
  },
  {
    name: "Family",
    key: "family",
    purpose: "One row a family member. As many sons, daughters and others as there are.",
    columns: [
      code,
      { header: "Relation", key: "relation", kind: "choice", required: true, options: RELATIONS },
      { header: "Name", key: "name", kind: "text", required: true },
      { header: "Date of birth", key: "dateOfBirth", kind: "date" },
      { header: "Dependent", key: "isDependent", kind: "yesno", help: "Blank means yes." },
    ],
  },
  {
    name: "Nominees",
    key: "nominees",
    purpose: "One row a nominee. Each person's shares in a scheme must add up to 100.",
    columns: [
      code,
      {
        header: "Scheme",
        key: "scheme",
        kind: "choice",
        help: "Blank means PF and gratuity.",
        options: [
          ["PF and gratuity", "pf_and_gratuity"],
          ["ESIC", "esic"],
          ["Insurance", "insurance"],
        ],
      },
      { header: "Name", key: "name", kind: "text", required: true },
      { header: "Relation", key: "relation", kind: "choice", required: true, options: RELATIONS },
      { header: "Date of birth", key: "dateOfBirth", kind: "date" },
      { header: "Share (%)", key: "sharePercent", kind: "number", required: true },
    ],
  },
  {
    name: "Previous employment",
    key: "previous",
    purpose: "One row an earlier employer.",
    columns: [
      code,
      { header: "Organisation", key: "organisationName", kind: "text", required: true },
      { header: "Designation", key: "designation", kind: "text" },
      { header: "From", key: "fromDate", kind: "date" },
      { header: "To", key: "toDate", kind: "date" },
      { header: "Reason for leaving", key: "reasonForLeaving", kind: "text" },
    ],
  },
];

/** A cell as an Excel library hands it over. */
export type Cell = string | number | boolean | Date | null | undefined;

/** A workbook as plain rows: sheet name to rows, the first being the headers. */
export type Grids = Record<string, Cell[][]>;

export type Workbook = Record<TemplateTab["key"], Record<string, string>[]>;

/** Something the browser could not read, before anything is sent. */
export interface ReadProblem {
  tab: string;
  row: number;
  column: string;
  message: string;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A date in the workbook as YYYY-MM-DD, or null if it is not one. */
export function toIsoDate(v: Cell): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number" && v > 0 && v < 2958466) {
    // An Excel serial: days since 30 Dec 1899.
    return toIsoDate(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000));
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  return null;
}

function text(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return toIsoDate(v) ?? "";
  return String(v).trim();
}

/**
 * Reads the workbook's tabs into the database's keys. Headers are matched by
 * name, case and punctuation aside, so a reordered column still lands. Blank
 * rows are skipped. Values are turned into codes here (a choice's label into
 * its code, Yes into true, a date into YYYY-MM-DD); whether a value is
 * allowed is the database's, which checks it with the card's own rules.
 */
export function readGrids(grids: Grids): { workbook: Workbook; problems: ReadProblem[] } {
  const workbook: Workbook = { people: [], family: [], nominees: [], previous: [] };
  const problems: ReadProblem[] = [];

  for (const tab of MASTER_TEMPLATE) {
    const sheetName = Object.keys(grids).find((n) => squash(n) === squash(tab.name));
    if (!sheetName) {
      if (tab.key === "people") {
        problems.push({ tab: tab.name, row: 0, column: "", message: "This tab is missing." });
      }
      continue;
    }
    const [head = [], ...rows] = grids[sheetName];
    const at = new Map<string, number>();
    head.forEach((h, i) => {
      const col = tab.columns.find((c) => squash(c.header) === squash(text(h)));
      if (col) at.set(col.key, i);
    });
    for (const col of tab.columns) {
      if (col.required && !at.has(col.key)) {
        problems.push({
          tab: tab.name,
          row: 1,
          column: col.header,
          message: "This column is missing.",
        });
      }
    }

    rows.forEach((cells, index) => {
      if (!cells.some((c) => text(c) !== "")) return;
      const row: Record<string, string> = {};
      const sheetRow = index + 2;
      for (const col of tab.columns) {
        const i = at.get(col.key);
        if (i === undefined) continue;
        const raw = cells[i];
        const value = text(raw);
        if (value === "" || value === "-") continue;
        if (col.kind === "date") {
          const iso = toIsoDate(raw);
          if (!iso) {
            problems.push({
              tab: tab.name,
              row: sheetRow,
              column: col.header,
              message: "Not a date. Use a date cell, or YYYY-MM-DD.",
            });
            continue;
          }
          row[col.key] = iso;
        } else if (col.kind === "choice") {
          const hit = col.options?.find(
            ([label, c]) => squash(label) === squash(value) || squash(c) === squash(value),
          );
          if (!hit) {
            problems.push({
              tab: tab.name,
              row: sheetRow,
              column: col.header,
              message: `Not one of: ${col.options?.map(([l]) => l).join(", ")}.`,
            });
            continue;
          }
          row[col.key] = hit[1];
        } else if (col.kind === "yesno") {
          const v = squash(value);
          if (!["yes", "y", "true", "no", "n", "false"].includes(v)) {
            problems.push({
              tab: tab.name,
              row: sheetRow,
              column: col.header,
              message: "Yes or No.",
            });
            continue;
          }
          row[col.key] = String(["yes", "y", "true"].includes(v));
        } else {
          // Excel keeps 15 significant digits of a number. An account number
          // typed into a number cell has already lost its last digits, and
          // nothing can recover them; say so rather than store a wrong one.
          if (typeof raw === "number" && !Number.isSafeInteger(raw) && Math.abs(raw) >= 1e15) {
            problems.push({
              tab: tab.name,
              row: sheetRow,
              column: col.header,
              message:
                "Too long for a number cell: Excel has dropped digits. Format the column as Text and type it again.",
            });
            continue;
          }
          row[col.key] = value;
        }
      }
      // The database counts rows from 1 within a tab; the sheet row is kept
      // so a problem can be found in Excel.
      row.__sheetRow = String(sheetRow);
      workbook[tab.key].push(row);
    });
  }
  return { workbook, problems };
}

/** The workbook without the sheet-row bookkeeping, as the database takes it. */
export function forDatabase(workbook: Workbook): Workbook {
  const strip = (rows: Record<string, string>[]) => rows.map(({ __sheetRow: _, ...rest }) => rest);
  return {
    people: strip(workbook.people),
    family: strip(workbook.family),
    nominees: strip(workbook.nominees),
    previous: strip(workbook.previous),
  };
}

/** The header a key has on a tab, for naming a problem the database found. */
export function headerFor(tabKey: string, key: string | null | undefined): string {
  const tab = MASTER_TEMPLATE.find((t) => t.key === tabKey);
  return tab?.columns.find((c) => c.key === key)?.header ?? "";
}

export function tabName(tabKey: string): string {
  return MASTER_TEMPLATE.find((t) => t.key === tabKey)?.name ?? tabKey;
}
