/**
 * Export record (D96): a person's card as a PDF.
 *
 * Built from the card exactly as `employee_card()` sent it to whoever is
 * exporting, so nobody can export more than they could already read: a
 * colleague gets the work card, the person their whole record. Two rules on
 * top of that:
 *
 * - statutory and bank numbers are written to their last four, even for a
 *   statutory officer who was sent them in full: a file leaves the system and
 *   the reveal log cannot follow it;
 * - the physical record ("for uniform and safety equipment issue, appears in
 *   no export", bundle §7.1) and religion, caste and disability are never in it.
 *
 * jsPDF (MIT), loaded only when somebody exports.
 */

import type { EmployeeCard } from "./contracts";
import { EMPLOYEE_STATUS_LABEL, EMPLOYMENT_TYPE_LABEL } from "./contracts";
import { formatDate, formatMonths, humanise, lastDay } from "./format";

export interface RecordSection {
  title: string;
  /** Label and value pairs, or a table's header row followed by its rows. */
  rows: string[][];
  table?: boolean;
}

const dash = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "—" : String(v);
const last4 = (v: string | null | undefined) => (v ? `•••• ${v}` : "—");

export function recordSections(card: EmployeeCard): RecordSection[] {
  const s: RecordSection[] = [];

  s.push({
    title: "Overview",
    rows: [
      ["Name", dash(card.fullName)],
      ["Employee code", dash(card.employeeCode)],
      ["Designation", dash(card.designation?.name)],
      ["Department", dash(card.department?.name)],
      ["Deployed to", dash(card.currentDeployment?.unitName)],
      ["Reports to", dash(card.reportsTo?.fullName)],
      ["Status", EMPLOYEE_STATUS_LABEL[card.status] ?? card.status],
      ["Joined", formatDate(card.dateOfJoining)],
      ["Work email", dash(card.workEmail)],
      ["Mobile", dash(card.mobile)],
      ["Alternate mobile", dash(card.alternateMobile)],
    ],
  });

  if (card.emergencyContact) {
    s.push({
      title: "Emergency contact",
      rows: [
        ["Name", dash(card.emergencyContact.name)],
        ["Relation", humanise(card.emergencyContact.relation)],
        ["Phone", dash(card.emergencyContact.phone)],
      ],
    });
  }

  if ("nameAsPerId" in card) {
    s.push({
      title: "Personal",
      rows: [
        ["Name as printed on ID", dash(card.nameAsPerId)],
        ["Sex", humanise(card.sex)],
        ["Date of birth", formatDate(card.dateOfBirth)],
        ["Age", dash(card.age)],
        ["Marital status", humanise(card.maritalStatus)],
        ["Nationality", dash(card.nationality)],
        ["Native state", dash(card.nativeState)],
        ["Blood group", dash(card.bloodGroup)],
        ["Qualification", dash(card.educationQualification)],
        ["Personal email", dash(card.personalEmail)],
        ["Total experience", formatMonths(card.totalExperienceMonths)],
      ],
    });
  }

  if (card.employmentType !== undefined || card.confirmedOn !== undefined) {
    s.push({
      title: "Employment",
      rows: [
        [
          "Employment type",
          card.employmentType
            ? (EMPLOYMENT_TYPE_LABEL[card.employmentType as keyof typeof EMPLOYMENT_TYPE_LABEL] ??
              humanise(card.employmentType))
            : "—",
        ],
        ["Confirmed on", formatDate(card.confirmedOn)],
        ...(card.reJoiningDate !== undefined
          ? [["Re-joined", formatDate(card.reJoiningDate)]]
          : []),
        ...(card.terminationDate ? [["Left on", formatDate(card.terminationDate)]] : []),
      ],
    });
  }

  if (card.familyMembers) {
    s.push({
      title: "Family",
      table: true,
      rows: [
        ["Relation", "Name", "Date of birth", "Dependent"],
        ...card.familyMembers.map((f) => [
          humanise(f.relation),
          f.name,
          formatDate(f.dateOfBirth),
          f.isDependent ? "Yes" : "No",
        ]),
      ],
    });
  }

  const current = card.nominations?.find((n) => n.effectiveTo === null);
  if (current) {
    s.push({
      title: "Nominees",
      table: true,
      rows: [
        ["Name", "Relation", "Share"],
        ...current.nominees.map((n) => [n.name, humanise(n.relation), `${n.sharePercent}%`]),
      ],
    });
  }

  if (card.statutory?.recorded) {
    const st = card.statutory;
    s.push({
      title: "Statutory",
      rows: [
        ["Identity document", humanise(st.identityDocumentType)],
        ["Aadhaar", last4(st.aadhaarLast4)],
        ["PAN", last4(st.panLast4)],
        ["UAN", last4(st.uanLast4)],
        ["EPF number", last4(st.epfLast4)],
        ["ESIC number", last4(st.esicLast4)],
        ["Verified on", formatDate(st.verifiedOn)],
      ],
    });
  }

  if (card.bank?.recorded) {
    s.push({
      title: "Bank",
      rows: [
        ["Bank", dash(card.bank.bankName)],
        ["IFSC", dash(card.bank.ifsc)],
        ["Account", last4(card.bank.accountLast4)],
        ["Penny drop", humanise(card.bank.pennyDropStatus)],
      ],
    });
  }

  if (card.addresses) {
    s.push({
      title: "Addresses",
      table: true,
      rows: [
        ["Type", "Address", "From", "To"],
        ...card.addresses.map((a) => [
          humanise(a.addressType),
          [a.line, a.city, a.district, a.state, a.pincode].filter(Boolean).join(", "),
          formatDate(a.effectiveFrom),
          a.effectiveTo ? formatDate(lastDay(a.effectiveTo)) : "Current",
        ]),
      ],
    });
  }

  if (card.deployments) {
    s.push({
      title: "Deployments",
      table: true,
      rows: [
        ["Unit", "From", "To", "Order ref"],
        ...card.deployments.map((d) => [
          d.unitName,
          formatDate(d.effectiveFrom),
          d.effectiveTo ? formatDate(lastDay(d.effectiveTo)) : "Current",
          d.deploymentOrderRef,
        ]),
      ],
    });
  }

  if (card.previousOrganisations?.length) {
    s.push({
      title: "Previous organisations",
      table: true,
      rows: [
        ["Organisation", "Designation", "From", "To"],
        ...card.previousOrganisations.map((p) => [
          p.organisationName,
          dash(p.designation),
          formatDate(p.fromDate),
          formatDate(p.toDate),
        ]),
      ],
    });
  }

  return s;
}

export async function recordPdf(card: EmployeeCard, today: string): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: false });
  doc.setFontSize(15);
  doc.text(card.fullName ?? "Employee record", 40, 44);
  doc.setFontSize(9);
  doc.text(`Employee record · exported ${formatDate(today)}`, 40, 60);
  let y = 76;
  for (const sec of recordSections(card)) {
    autoTable(doc, {
      startY: y,
      head: [[sec.title, ...(sec.table ? sec.rows[0].slice(1).map(() => "") : [""])]],
      body: sec.table ? [sec.rows[0], ...sec.rows.slice(1)] : sec.rows,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
      margin: { left: 40, right: 40 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  }
  return doc.output("arraybuffer");
}

/** `E-1043-priya-employee-record-2026-10-12.pdf` */
export async function downloadRecordPdf(
  card: EmployeeCard,
  today = new Date().toISOString().slice(0, 10),
) {
  const stem = [card.employeeCode, card.fullName ?? "employee"]
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const url = URL.createObjectURL(
    new Blob([await recordPdf(card, today)], { type: "application/pdf" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem}-record-${today}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
