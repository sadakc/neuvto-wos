/**
 * The rules a field's value must meet (D103), the same ones the database
 * enforces in 20261023100000_fields_are_checked.sql. Checked here first so the
 * message appears under the field as it is typed; the database checks again,
 * because the import and any later caller never pass through this screen.
 *
 * Each rule's message says what is wanted, not just that something is wrong.
 */

export type FieldRule =
  | "phone"
  | "name"
  | "words"
  | "employeeCode"
  | "email"
  | "pincode"
  | "heightCm"
  | "chestCm"
  | "weightKg"
  | "dateOfBirth"
  | "pastDate"
  | "text100"
  | "text200"
  | "text500"
  | "aadhaar"
  | "pan"
  | "uan"
  | "esic"
  | "epf"
  | "ifsc"
  | "account"
  | "licence"
  | "percent";

const WORD_SYMBOLS = /[0-9!"#$%&()*+,/:;<=>?@^_`{|}~[\]\\]/;
const SOMETHING_BUT_PUNCTUATION = /[^\s.'-]/;

function phone(v: string) {
  const digits = v.replace(/[\s()-]/g, "");
  return /^(\+91[6-9][0-9]{9}|\+(9[02-9]|[1-8])[0-9]{7,13}|[6-9][0-9]{9})$/.test(digits);
}

/**
 * Why a phone number was refused, in words (D104). "Enter a 10-digit number"
 * under a number that has ten digits but starts with a 3 reads as the screen
 * not noticing the fix, so each way of being wrong is named.
 */
function phoneProblem(v: string): string {
  const compact = v.replace(/[\s()-]/g, "");
  if (!/^\+?[0-9]+$/.test(compact)) {
    return "Digits only. Spaces, dashes and brackets are fine; letters and other symbols aren't.";
  }
  if (compact.startsWith("+91")) {
    const rest = compact.slice(3);
    if (rest.length !== 10)
      return `After +91 a mobile number has 10 digits; this has ${rest.length}.`;
    return "An Indian mobile number starts with 6, 7, 8 or 9.";
  }
  if (compact.startsWith("+")) {
    return "After + comes the country code and the number: 8 to 15 digits in all.";
  }
  if (compact.length === 11 && compact.startsWith("0")) {
    return "Leave out the 0 at the start: a mobile number has 10 digits.";
  }
  if (compact.length !== 10) {
    return `A mobile number has 10 digits; this has ${compact.length}.`;
  }
  return "An Indian mobile number starts with 6, 7, 8 or 9. For another country, start with + and its code.";
}

function words(v: string, max: number) {
  return v.length <= max && !WORD_SYMBOLS.test(v) && SOMETHING_BUT_PUNCTUATION.test(v);
}

/** As statutory_normalise: letters and digits only, upper-cased. */
const norm = (v: string) => v.replace(/[^0-9A-Za-z]/g, "").toUpperCase();

// Verhoeff, as aadhaar_is_valid: the last digit of an Aadhaar is a checksum, so
// a single mistyped digit or two swapped neighbours is caught here.
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function aadhaarIsValid(n: string) {
  if (!/^[2-9][0-9]{11}$/.test(n)) return false;
  let c = 0;
  for (let i = 0; i < 12; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(n[11 - i])]];
  }
  return c === 0;
}

function wholeNumber(v: string, min: number, max: number) {
  if (!/^[0-9]+$/.test(v)) return false;
  const n = Number(v);
  return n >= min && n <= max;
}

/** Today as a calendar date, and the same day `years` ago. */
function isoYearsAgo(years: number, today = new Date()) {
  const d = new Date(Date.UTC(today.getFullYear() - years, today.getMonth(), today.getDate()));
  return d.toISOString().slice(0, 10);
}

export const FIELD_RULES: Record<
  FieldRule,
  {
    check: (v: string) => boolean;
    message: string;
    /** Says what is wrong with this value in particular, where the message alone would mislead. */
    explain?: (v: string) => string;
  }
> = {
  phone: {
    check: phone,
    explain: phoneProblem,
    message:
      "Enter a 10-digit mobile number, or + and the country code. Digits only, with spaces if you like.",
  },
  name: {
    check: (v) => words(v, 100),
    message: "Letters only: no digits or symbols other than . ' and -.",
  },
  words: {
    check: (v) => words(v, 60),
    message: "Letters only, up to 60: no digits or symbols other than . ' and -.",
  },
  employeeCode: {
    check: (v) => /^[A-Za-z0-9][A-Za-z0-9/._-]{0,29}$/.test(v),
    message: "Letters and digits, up to 30, with / . _ or - between them. No spaces.",
  },
  email: {
    check: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
    message: "Enter an email address, like name@example.com.",
  },
  pincode: {
    check: (v) => /^[1-9][0-9]{5}$/.test(v),
    message: "A pincode is 6 digits and doesn't start with 0.",
  },
  heightCm: {
    check: (v) => wholeNumber(v, 50, 260),
    message: "Height in whole centimetres, between 50 and 260.",
  },
  chestCm: {
    check: (v) => wholeNumber(v, 30, 200),
    message: "Chest in whole centimetres, between 30 and 200.",
  },
  weightKg: {
    check: (v) => wholeNumber(v, 10, 400),
    message: "Weight in whole kilograms, between 10 and 400.",
  },
  dateOfBirth: {
    check: (v) => v > "1900-01-01" && v <= isoYearsAgo(14),
    message: "They must be at least 14 years old.",
  },
  pastDate: {
    check: (v) => v <= isoYearsAgo(0),
    message: "That date is in the future.",
  },
  text100: { check: (v) => v.length <= 100, message: "Keep it to 100 characters." },
  text200: { check: (v) => v.length <= 200, message: "Keep it to 200 characters." },
  text500: { check: (v) => v.length <= 500, message: "Keep it to 500 characters." },
  // The statutory and bank numbers: the same patterns employee_set_statutory
  // and employee_set_bank refuse with, after the same clean-up
  // (statutory_normalise keeps letters and digits, upper-cased).
  aadhaar: {
    check: (v) => aadhaarIsValid(norm(v)),
    message: "That isn't a valid Aadhaar number. Check the 12 digits.",
  },
  pan: {
    check: (v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(norm(v)),
    message: "A PAN is five letters, four digits and a letter, like ABCDE1234F.",
  },
  uan: { check: (v) => /^[0-9]{12}$/.test(norm(v)), message: "A UAN is 12 digits." },
  esic: {
    check: (v) => /^([0-9]{10}|[0-9]{17})$/.test(norm(v)),
    message: "An ESIC number is 10 or 17 digits.",
  },
  epf: {
    check: (v) => /^[A-Z]{5}[0-9A-Z]{5,17}$/.test(norm(v)),
    message: "An EPF member number starts with five letters, like MHBAN0012345000001234.",
  },
  ifsc: {
    check: (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(norm(v)),
    message: "An IFSC is four letters, a zero, then six letters or digits.",
  },
  account: {
    check: (v) => /^[0-9]{9,18}$/.test(norm(v)),
    message: "An account number is 9 to 18 digits.",
  },
  licence: {
    check: (v) => /^[A-Z]{2}[0-9A-Z]{8,16}$/.test(norm(v)),
    message: "A driving licence number starts with the state's two letters, like KA01 20110012345.",
  },
  percent: {
    check: (v) => /^[0-9]+(\.[0-9]{1,2})?$/.test(v) && Number(v) <= 100,
    message: "A percentage from 0 to 100.",
  },
};

/** What is wrong with a value, or null. An empty value is never wrong here: required is the form's call. */
export function checkField(rule: FieldRule | undefined, value: string): string | null {
  const v = value.trim();
  if (!rule || v === "") return null;
  const r = FIELD_RULES[rule];
  return r.check(v) ? null : (r.explain?.(v) ?? r.message);
}

/**
 * The database names the rule a refused value broke. This turns it into the
 * field's own message, so a value that slipped past the screen (or was already
 * on record) is still explained in words.
 */
export const RULE_MESSAGES: Record<string, string> = {
  alternate_mobile_format: `Alternate mobile: ${FIELD_RULES.phone.message}`,
  emergency_contact_phone_format: `Emergency contact phone: ${FIELD_RULES.phone.message}`,
  mobile_format: `Mobile: ${FIELD_RULES.phone.message}`,
  full_name_format: `Full name: ${FIELD_RULES.name.message}`,
  name_as_per_id_format: `Name as printed on ID: ${FIELD_RULES.name.message}`,
  emergency_contact_name_format: `Emergency contact name: ${FIELD_RULES.name.message}`,
  emergency_contact_relation_format: `Relation: ${FIELD_RULES.words.message}`,
  nationality_format: `Nationality: ${FIELD_RULES.words.message}`,
  native_state_format: `Native state: ${FIELD_RULES.words.message}`,
  employee_code_format: `Employee code: ${FIELD_RULES.employeeCode.message}`,
  education_qualification_length: `Qualification: ${FIELD_RULES.text200.message}`,
  nearest_police_station_length: `Nearest police station: ${FIELD_RULES.text100.message}`,
  termination_reason_length: `Termination reason: ${FIELD_RULES.text500.message}`,
  reason_for_leaving_length: `Reason for leaving: ${FIELD_RULES.text500.message}`,
  date_of_birth_age: `Date of birth: ${FIELD_RULES.dateOfBirth.message}`,
  confirmed_on_after_birth: "Confirmed: the date can't be before their date of birth.",
  relative_name_format: `Name: ${FIELD_RULES.name.message}`,
  relative_date_of_birth_future: `Date of birth: ${FIELD_RULES.pastDate.message}`,
  organisation_name_length: `Organisation: ${FIELD_RULES.text200.message}`,
  previous_designation_length: `Designation: ${FIELD_RULES.text100.message}`,
  previous_org_dates_future: "Previous organisation: the dates can't be in the future.",
  previous_org_dates_order: "Previous organisation: To can't be before From.",
  address_line_length: "Address: keep it to 300 characters.",
  city_format: `City: ${FIELD_RULES.words.message}`,
  district_format: `District: ${FIELD_RULES.words.message}`,
  state_format: `State: ${FIELD_RULES.words.message}`,
  account_holder_format: `Account holder: ${FIELD_RULES.name.message}`,
  bank_name_length: `Bank: ${FIELD_RULES.text100.message}`,
  branch_length: `Branch: ${FIELD_RULES.text100.message}`,
  department_name_length: `Department: ${FIELD_RULES.text100.message}`,
  employees_height_cm_check: FIELD_RULES.heightCm.message,
  employees_chest_cm_check: FIELD_RULES.chestCm.message,
  employees_weight_kg_check: FIELD_RULES.weightKg.message,
  employees_personal_email_check: `Personal email: ${FIELD_RULES.email.message}`,
  employee_addresses_pincode_check: FIELD_RULES.pincode.message,
};
