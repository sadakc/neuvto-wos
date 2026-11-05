/**
 * The customer's master sheet, as Neuvto replaces it: the first row, as typed
 * there, in order. 62 named columns (the blank columns H and BM are not
 * columns). Header names only; no person's data is in this file.
 *
 * Two are repeats: FATHER NAME and HUSBAND NAME appear in E and F and again in
 * AQ and AR. Neuvto keeps each once (Sada, 12 Oct 2026). Sons and daughters
 * are numbered slots in the sheet and rows in Neuvto: any number, each with
 * its own date of birth.
 */

export const MASTER_SHEET_HEADERS = [
  "EMPLOYEE ID",
  "DESIGNATION",
  "EMPLOYEE NAME",
  "Sex ",
  "FATHER NAME",
  "HUSBAND NAME",
  "UAN",
  "EPF NUMBER",
  "ESIC NUMBER",
  "DATE OF BIRTH",
  "DATE OF JOINING",
  "RE-JOINING DATE",
  "STATUS",
  "EMPLOYMENT TERMINATION ",
  "MARITAL -STATUS",
  "PRESENT ADDRESS",
  "PERMANENT ADDRESS",
  "Mobile / \nPhone No",
  "Deputation / Deployed Unit",
  "Education Qualification",
  "Physically Handicap",
  "Type of Documents",
  "AADHAAR NO",
  "PAN NO",
  "BANK ACCOUNT NO",
  "IFSC Code",
  "Bank Name ",
  " Branch Name",
  "Native from which state",
  "NOMINEE NAME",
  "RELATION WITH MEMBER",
  "DATE OF BIRTH OF NOMINEE",
  "NATIONALITY",
  "BLOOD GROUP",
  "RELIGION",
  "CASTE",
  "HEIGHT (C.M)",
  "CHEST (C.M)",
  "WEIGHT (K.G)",
  "OLD ESIC NO",
  "OLD EPF UAN NO",
  "FATHER NAME",
  "HUSBAND NAME",
  "FATHER DOB",
  "HUSBAND DOB",
  "MOTHER",
  "MOTHER DOB",
  "WIFE",
  "WIFE DOB",
  "SON 1",
  "SON 1 DOB",
  "SON 2",
  "SON 2 DOB",
  "DAUGHTER 1",
  "DAUGHTER 1 DOB",
  "DAUGHTER 2",
  "DAUGHTER 2 DOB",
  "EMERGENCY CONTACT",
  "NEAREST POLICE STATION",
  "TOTAL EXPERIENCE",
  "REASON FOR LEAVING LAST ORG",
  "AGE",
] as const;

/** For comparing a header with a catalogue entry: case, spaces and punctuation ignored. */
export const normaliseHeader = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
