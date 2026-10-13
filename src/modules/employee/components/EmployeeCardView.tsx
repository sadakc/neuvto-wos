/**
 * The Employee Card (bundle §7.1), for whoever is looking.
 *
 * The same component renders your own card and anybody else's. It holds no
 * rule about who may see what: a sub-tab appears when the data it shows
 * ARRIVED, and `employee_card()` sends only what the caller's relationship
 * allows. A colleague's browser never receives a date of birth, so there is
 * nothing here that could show one by mistake.
 *
 * Documents (D95) are the person's and the Employee Admin's only: the tab
 * appears for those two relationships, and the database refuses anybody else.
 * Export record (D96) writes what this card was sent, for anybody who can see
 * it.
 *
 * "This year" (D97) and "Who has looked" (D100) are asked for only when the
 * card's capabilities say so. A proof on an address (D98) is drawn only where
 * the card carried one, which it does for the person and the Employee Admin.
 */

import { useRef, useState, type KeyboardEvent } from "react";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import {
  EMPLOYEE_STATUS_LABEL,
  EMPLOYMENT_TYPE_LABEL,
  STAGE_LABEL,
  UNIT_TYPE_LABEL,
  type EmployeeCard,
  type EmployeeStatus,
} from "../contracts";
import {
  familySummary,
  formatDate,
  formatMonths,
  humanise,
  initials,
  lastDay,
  monthsBetween,
  todayIso,
} from "../format";
import { Fields, Panel, RecordTable } from "./parts";
import { PersonLink } from "./PersonLink";
import { StatutoryTab } from "./StatutoryTab";
import { DocumentsTab } from "./DocumentsTab";
import { ThisYearPanel, WhoHasLooked } from "./ThisYear";
import { AttachProofForm, ProofCell } from "./AddressProof";
import { ShiftCalendarPanel } from "./ShiftAndCalendar";
import { downloadRecordPdf } from "../recordExport";
import { MyChangeRequests, RequestChangeButton } from "./ChangeRequests";
import { DeactivateDialog, DraftEditor, SendInviteButton } from "./Lifecycle";
import { STAGE_TONE } from "../status";
import {
  AddAddressDialog,
  ContactEditor,
  DatesEditor,
  EducationEditor,
  EmergencyEditor,
  FamilyEditor,
  IdentityEditor,
  MoveUnitDialog,
  NominationEditor,
  PhysicalEditor,
  PositionEditor,
  PreviousOrgsEditor,
} from "./RecordEditors";

const STATUS_TONE: Record<EmployeeStatus, StatusTone> = {
  working: "success",
  probation: "info",
  notice: "warning",
  suspended: "destructive",
  left: "neutral",
};

type Changed = () => Promise<void> | void;

type TabKey =
  | "overview"
  | "personal"
  | "family"
  | "employment"
  | "statutory"
  | "history"
  | "documents";

/** Which sub-tabs this card can fill, from what the database actually sent. */
function cardTabs(card: EmployeeCard): { key: TabKey; label: string }[] {
  const tabs: { key: TabKey; label: string }[] = [{ key: "overview", label: "Overview" }];
  if ("nameAsPerId" in card) tabs.push({ key: "personal", label: "Personal" });
  if ("familyMembers" in card) tabs.push({ key: "family", label: "Family" });
  tabs.push({ key: "employment", label: "Employment" });
  if ("statutory" in card || "bank" in card || "verification" in card || "restricted" in card) {
    tabs.push({ key: "statutory", label: "Statutory and bank" });
  }
  if ("addresses" in card || "deployments" in card || "previousOrganisations" in card) {
    tabs.push({ key: "history", label: "History" });
  }
  if (card.relationship.includes("self") || card.relationship.includes("admin")) {
    tabs.push({ key: "documents", label: "Documents" });
  }
  return tabs;
}

export function EmployeeCardView({
  card,
  onChanged = () => {},
}: {
  card: EmployeeCard;
  /** After a write: re-read the card without leaving the tab. */
  onChanged?: () => Promise<void> | void;
}) {
  const tabs = cardTabs(card);
  const [tab, setTab] = useState<TabKey>("overview");
  const [requestsSent, setRequestsSent] = useState(0);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const active = tabs.some((t) => t.key === tab) ? tab : "overview";

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const i = tabs.findIndex((t) => t.key === active);
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(tabs[next].key);
    tabRefs.current[tabs[next].key]?.focus();
  }

  const where = [
    card.designation?.name,
    card.department?.name,
    card.currentDeployment ? `deployed to ${card.currentDeployment.unitName}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const strip: { label: string; value: React.ReactNode }[] = [
    { label: "Deployed unit", value: card.currentDeployment?.unitName },
    {
      label: "Reports to",
      value: card.reportsTo?.fullName ? (
        card.reportsTo.id ? (
          <PersonLink employeeId={card.reportsTo.id}>{card.reportsTo.fullName}</PersonLink>
        ) : (
          card.reportsTo.fullName
        )
      ) : null,
    },
    { label: "Status", value: EMPLOYEE_STATUS_LABEL[card.status] },
    { label: "Mobile", value: card.mobile },
    { label: "Alternate mobile", value: card.alternateMobile },
  ];
  // Only where it was sent. A cell reading "—" would claim there is no police
  // station on record, when the truth is that this viewer may not know.
  if ("nearestPoliceStation" in card) {
    strip.push({ label: "Nearest police station", value: card.nearestPoliceStation });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ── header */}
      <section
        className="rounded-xl border border-border bg-card shadow-card"
        data-testid="card-header"
      >
        <div className="flex flex-wrap items-start gap-4 px-4 py-4">
          <div
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-semibold text-accent-foreground"
          >
            {initials(card.fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-page-title font-semibold tracking-page-title break-words">
                {card.fullName ?? card.workEmail ?? "Unnamed"}
              </h1>
              <StatusBadge tone={STATUS_TONE[card.status]}>
                {EMPLOYEE_STATUS_LABEL[card.status]}
              </StatusBadge>
              {card.confirmedOn && <StatusBadge tone="info">Confirmed</StatusBadge>}
              {card.stage && card.stage !== "active" ? (
                <StatusBadge tone={STAGE_TONE[card.stage]}>{STAGE_LABEL[card.stage]}</StatusBadge>
              ) : (
                !card.isActive && <StatusBadge tone="neutral">Cannot sign in</StatusBadge>
              )}
            </div>
            {where && <p className="mt-1 text-sm text-foreground-secondary">{where}</p>}
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Key facts">
              {card.employeeCode && <Tag>{card.employeeCode}</Tag>}
              <Tag>Joined {formatDate(card.dateOfJoining)}</Tag>
              {card.age != null && <Tag>Age {card.age}</Tag>}
              {card.totalExperienceMonths != null && (
                <Tag>{formatMonths(card.totalExperienceMonths)} experience</Tag>
              )}
            </ul>
          </div>
          {/* Its own row on a phone, so the name keeps the width (seen at 390px). */}
          <div className="w-full @min-[640px]/app:w-auto">
            <button
              type="button"
              onClick={() => void downloadRecordPdf(card)}
              className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm font-medium"
            >
              Export record
            </button>
          </div>
          {(card.capabilities.canSendInvite ||
            card.capabilities.canDeactivate ||
            card.capabilities.canEditDraft) && (
            <div
              className="flex w-full flex-wrap items-start gap-2 @min-[640px]/app:w-auto @min-[640px]/app:justify-end"
              data-testid="lifecycle-actions"
            >
              {card.capabilities.canEditDraft && <DraftEditor card={card} onChanged={onChanged} />}
              {card.capabilities.canSendInvite && (
                <SendInviteButton card={card} onChanged={onChanged} />
              )}
              {card.capabilities.canDeactivate && (
                <DeactivateDialog card={card} onChanged={onChanged} />
              )}
            </div>
          )}
          {card.capabilities.canRequestChange && (
            <div className="flex w-full flex-col items-start gap-1 @min-[640px]/app:w-auto @min-[640px]/app:items-end">
              <RequestChangeButton card={card} onSent={() => setRequestsSent((n) => n + 1)} />
              {requestsSent > 0 && (
                <p role="status" data-testid="request-sent" className="text-caption text-success">
                  Sent to your HR admins.
                </p>
              )}
            </div>
          )}
        </div>
        <dl
          data-testid="card-strip"
          className="grid grid-cols-2 border-t border-border @min-[640px]/app:grid-cols-3 @min-[1200px]/app:grid-cols-6"
        >
          {strip.map((c) => (
            <div
              key={c.label}
              className="min-w-0 border-border px-4 py-3 [&:not(:last-child)]:border-r"
            >
              <dt className="text-eyebrow font-semibold tracking-eyebrow text-muted-foreground uppercase">
                {c.label}
              </dt>
              <dd className="mt-0.5 truncate text-sm">{c.value || "—"}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── sub-tabs */}
      <div
        role="tablist"
        aria-label="Record sections"
        className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[t.key] = el;
            }}
            role="tab"
            type="button"
            id={`card-tab-${t.key}`}
            aria-selected={active === t.key}
            aria-controls={`card-panel-${t.key}`}
            tabIndex={active === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={onTabKey}
            className={cn(
              "-mb-px h-11 shrink-0 border-b-2 px-3 text-sm whitespace-nowrap",
              active === t.key
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`card-panel-${active}`}
        aria-labelledby={`card-tab-${active}`}
        className="min-w-0"
      >
        {active === "overview" && (
          <div className="flex flex-col gap-4">
            <Overview card={card} onChanged={onChanged} />
            {card.capabilities.canRequestChange && <MyChangeRequests refreshKey={requestsSent} />}
          </div>
        )}
        {active === "personal" && <Personal card={card} onChanged={onChanged} />}
        {active === "family" && <Family card={card} onChanged={onChanged} />}
        {active === "employment" && (
          <Employment
            card={card}
            onChanged={onChanged}
            onSeeHistory={
              tabs.some((t) => t.key === "history") ? () => setTab("history") : undefined
            }
          />
        )}
        {active === "statutory" && <StatutoryTab card={card} onChanged={onChanged} />}
        {active === "history" && <History card={card} onChanged={onChanged} />}
        {active === "documents" && (
          <DocumentsTab
            employeeId={card.id}
            isAdmin={card.relationship.includes("admin")}
            isSelf={card.relationship.includes("self")}
          />
        )}
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <li className="rounded-sm border border-border bg-secondary px-2 py-0.5 text-caption text-foreground-secondary">
      {children}
    </li>
  );
}

/** Whether this card's panels carry their Add and Edit buttons. */
const edit = (card: EmployeeCard) => card.capabilities.canEdit;

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 @min-[800px]/app:grid-cols-2">{children}</div>;
}

// ═══════════════════════════════════════════════════════════════ Overview

function Overview({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  const earlier = card.deployments ? card.deployments.filter((d) => d.effectiveTo).length : null;
  const open = card.deployments?.find((d) => !d.effectiveTo);
  return (
    <div className="flex flex-col gap-4">
      <Grid>
        <Panel
          title="Contact"
          testId="panel-contact"
          aside={edit(card) && <ContactEditor card={card} onChanged={onChanged} />}
        >
          <Fields
            items={[
              { label: "Work email", value: card.workEmail },
              { label: "Mobile", value: card.mobile, mono: true },
              { label: "Alternate mobile", value: card.alternateMobile, mono: true },
              ...("personalEmail" in card
                ? [{ label: "Personal email", value: card.personalEmail }]
                : []),
            ]}
          />
        </Panel>

        <Panel
          title="Current deployment"
          testId="panel-deployment"
          footer="Changing the unit never edits this row. The posting is closed and a new one opened, so the old one is still there for the day a client invoice asks about it."
        >
          <Fields
            items={[
              { label: "Unit", value: card.currentDeployment?.unitName },
              {
                label: "Type",
                value: card.currentDeployment
                  ? (UNIT_TYPE_LABEL[card.currentDeployment.unitType] ??
                    humanise(card.currentDeployment.unitType))
                  : null,
              },
              { label: "Effective from", value: formatDate(card.currentDeployment?.effectiveFrom) },
              ...(open
                ? [
                    { label: "Order ref", value: open.deploymentOrderRef, mono: true },
                    { label: "Moved by", value: open.movedBy },
                  ]
                : []),
              ...(earlier !== null ? [{ label: "Earlier postings", value: String(earlier) }] : []),
            ]}
          />
        </Panel>

        {/* Shown empty to whoever can fill it, with Add in its header (D103). */}
        {(card.emergencyContact || edit(card)) && (
          <Panel
            title="Emergency contact"
            testId="panel-emergency"
            aside={edit(card) && <EmergencyEditor card={card} onChanged={onChanged} />}
          >
            {card.emergencyContact &&
            (card.emergencyContact.name ||
              card.emergencyContact.relation ||
              card.emergencyContact.phone) ? (
              <Fields
                items={[
                  { label: "Name", value: card.emergencyContact.name },
                  { label: "Relation", value: humanise(card.emergencyContact.relation) },
                  { label: "Phone", value: card.emergencyContact.phone, mono: true },
                ]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No emergency contact recorded yet.</p>
            )}
          </Panel>
        )}

        {card.capabilities.canSeeThisYear && <ThisYearPanel employeeId={card.id} />}
      </Grid>
      {card.capabilities.canSeeViews && <WhoHasLooked employeeId={card.id} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════ Personal

function Personal({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  return (
    <div className="flex flex-col gap-4">
      <Grid>
        <Panel
          title="Identity"
          testId="panel-identity"
          aside={edit(card) && <IdentityEditor card={card} onChanged={onChanged} />}
        >
          <Fields
            items={[
              { label: "Full name", value: card.fullName },
              { label: "Name as printed on ID", value: card.nameAsPerId },
              { label: "Sex", value: humanise(card.sex) },
              { label: "Date of birth", value: formatDate(card.dateOfBirth) },
              { label: "Age", value: card.age != null ? `${card.age} (worked out)` : null },
              { label: "Marital status", value: humanise(card.maritalStatus) },
              { label: "Nationality", value: card.nationality },
              { label: "Native state", value: card.nativeState },
            ]}
          />
        </Panel>

        <Panel
          title="Education and experience"
          aside={edit(card) && <EducationEditor card={card} onChanged={onChanged} />}
          footer="Total experience is the experience before joining plus service here, and keeps counting by itself. Without the first, it is the previous organisations on the History tab."
        >
          <Fields
            items={[
              { label: "Qualification", value: card.educationQualification },
              ...(card.priorExperienceMonths != null
                ? [
                    {
                      label: "Experience before joining",
                      value: formatMonths(card.priorExperienceMonths),
                    },
                  ]
                : []),
              {
                label: "Total experience",
                value:
                  card.totalExperienceMonths != null
                    ? formatMonths(card.totalExperienceMonths)
                    : null,
              },
              { label: "Reason for leaving last org", value: card.reasonForLeavingLastOrg },
            ]}
            columns={1}
          />
        </Panel>

        <Panel
          title="Physical record"
          aside={edit(card) && <PhysicalEditor card={card} onChanged={onChanged} />}
          footer="For uniform and safety equipment issue. It appears in no export."
        >
          <Fields
            items={[
              {
                label: "Height",
                value: card.physical?.heightCm ? `${card.physical.heightCm} cm` : null,
              },
              {
                label: "Chest",
                value: card.physical?.chestCm ? `${card.physical.chestCm} cm` : null,
              },
              {
                label: "Weight",
                value: card.physical?.weightKg ? `${card.physical.weightKg} kg` : null,
              },
              { label: "Blood group", value: card.bloodGroup },
            ]}
          />
        </Panel>
      </Grid>
      {/* A note, not a panel (D104): nothing restricted is ever shown here. */}
      <p data-testid="restricted-note" className="text-caption text-muted-foreground">
        Religion, caste category and disability status are kept apart from this tab, on Statutory
        and bank, where only those allowed can see them. Every look is logged.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════ Family

function Family({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  const family = card.familyMembers ?? [];
  const current = card.nominations?.find((n) => !n.effectiveTo);
  const total = current?.nominees.reduce((s, n) => s + Number(n.sharePercent), 0) ?? 0;
  const superseded = (card.nominations ?? []).filter((n) => n.effectiveTo).length;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Family"
        aside={
          <span className="flex items-center gap-3">
            <span data-testid="family-summary">{familySummary(family.map((f) => f.relation))}</span>
            {edit(card) && <FamilyEditor card={card} onChanged={onChanged} />}
          </span>
        }
        footer="There is no Son 1 and Son 2. A person has as many sons, daughters or other relatives as they actually have. Dependents flow into medical insurance and the PF nomination check."
      >
        <RecordTable
          testId="family-table"
          headers={["Relation", "Name", "Date of birth", "Dependent"]}
          empty="Nobody recorded yet."
          rows={family.map((f) => ({
            key: f.id,
            cells: [
              humanise(f.relation),
              f.name,
              formatDate(f.dateOfBirth),
              f.isDependent ? "Yes" : "No",
            ],
          }))}
        />
      </Panel>

      <Panel
        title="Nominees"
        aside={
          <span className="flex items-center gap-3">
            {current && (
              <span className={total === 100 ? "text-success" : "text-destructive"}>
                Shares total {total}%
              </span>
            )}
            {edit(card) && <NominationEditor card={card} onChanged={onChanged} />}
          </span>
        }
        footer={`Changing a nominee archives the old nomination rather than overwriting it, because the superseded form is what a claim produces.${superseded ? ` ${superseded} earlier ${superseded === 1 ? "nomination" : "nominations"} on record.` : ""}`}
      >
        {current ? (
          <RecordTable
            testId="nominee-table"
            headers={["Name", "Relation", "Date of birth", "Share", "Scheme"]}
            empty="No nominees."
            rows={current.nominees.map((n) => ({
              key: n.id,
              cells: [
                n.name,
                humanise(n.relation),
                formatDate(n.dateOfBirth),
                `${Number(n.sharePercent)}%`,
                current.scheme ?? "All",
              ],
            }))}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No nomination recorded yet.</p>
        )}
      </Panel>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════ Employment

function Employment({
  card,
  onSeeHistory,
  onChanged,
}: {
  card: EmployeeCard;
  onSeeHistory?: () => void;
  onChanged: Changed;
}) {
  const postings = card.deployments?.length;
  return (
    <div className="flex flex-col gap-4">
      <Grid>
        <Panel
          title="Position"
          testId="panel-position"
          aside={edit(card) && <PositionEditor card={card} onChanged={onChanged} />}
        >
          <Fields
            items={[
              { label: "Employee code", value: card.employeeCode, mono: true },
              { label: "Designation", value: card.designation?.name },
              { label: "Grade", value: card.designation?.grade },
              { label: "Department", value: card.department?.name },
              ...("employmentType" in card
                ? [
                    {
                      label: "Employment type",
                      value: card.employmentType
                        ? (EMPLOYMENT_TYPE_LABEL[card.employmentType] ??
                          humanise(card.employmentType))
                        : null,
                    },
                  ]
                : []),
              {
                label: "Reports to",
                value: card.reportsTo?.fullName ? (
                  card.reportsTo.id ? (
                    <PersonLink employeeId={card.reportsTo.id}>
                      {card.reportsTo.fullName}
                    </PersonLink>
                  ) : (
                    card.reportsTo.fullName
                  )
                ) : null,
              },
              { label: "Direct reports", value: String(card.directReportCount) },
            ]}
          />
        </Panel>

        <Panel
          title="Dates and status"
          aside={edit(card) && <DatesEditor card={card} onChanged={onChanged} />}
          footer={
            "reJoiningDate" in card
              ? "Re-joining keeps the original joining date. Continuity is worked out from both."
              : undefined
          }
        >
          <Fields
            items={[
              { label: "Joined", value: formatDate(card.dateOfJoining) },
              ...("reJoiningDate" in card
                ? [{ label: "Re-joined", value: formatDate(card.reJoiningDate) }]
                : []),
              ...("confirmedOn" in card
                ? [{ label: "Confirmed", value: formatDate(card.confirmedOn) }]
                : []),
              { label: "Status", value: EMPLOYEE_STATUS_LABEL[card.status] },
              ...("terminationDate" in card
                ? [
                    { label: "Termination date", value: formatDate(card.terminationDate) },
                    { label: "Termination reason", value: card.terminationReason },
                  ]
                : []),
            ]}
          />
        </Panel>

        <Panel
          title="Deployment"
          aside={
            <span className="flex items-center gap-3">
              {onSeeHistory && (
                <button
                  type="button"
                  onClick={onSeeHistory}
                  className="-my-2.5 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
                >
                  See history
                </button>
              )}
              {edit(card) && <MoveUnitDialog card={card} onChanged={onChanged} />}
            </span>
          }
        >
          <Fields
            items={[
              { label: "Current unit", value: card.currentDeployment?.unitName },
              { label: "Since", value: formatDate(card.currentDeployment?.effectiveFrom) },
              ...(postings != null
                ? [{ label: "Postings on record", value: String(postings) }]
                : []),
            ]}
          />
        </Panel>

        <ShiftCalendarPanel card={card} onChanged={onChanged} />
      </Grid>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════ History

function CurrentOrArchived({ open }: { open: boolean }) {
  return open ? (
    <StatusBadge tone="success">Current</StatusBadge>
  ) : (
    <StatusBadge tone="neutral">Archived</StatusBadge>
  );
}

function History({ card, onChanged }: { card: EmployeeCard; onChanged: Changed }) {
  const today = todayIso();
  // D98: the card carries `proof` only to those who may open and attach one.
  const proofs = (card.addresses ?? []).some((a) => "proof" in a);
  const [attaching, setAttaching] = useState<string | null>(null);
  const [proofError, setProofError] = useState("");
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg border border-info-line bg-info-muted px-3.5 py-2.5 text-sm">
        <strong className="font-semibold">Nothing on this tab is ever deleted.</strong> Correcting a
        current row closes it with an end date and opens a new one. The old row stays, greyed, with
        who changed it and when, because an address or a posting from three years ago is what a
        statutory notice or a claim will ask about.
      </p>

      {card.addresses && (
        <Panel
          title="Address history"
          aside={edit(card) && <AddAddressDialog card={card} onChanged={onChanged} />}
          footer="Archived rows are read only. There is no edit or delete control for them."
        >
          <RecordTable
            testId="address-history"
            headers={[
              "Type",
              "Address",
              "From",
              "To",
              "Police station",
              "Recorded by",
              ...(proofs ? ["Proof"] : []),
              "Status",
            ]}
            empty="No address recorded yet."
            rows={card.addresses.map((a) => ({
              key: a.id,
              muted: a.effectiveTo !== null,
              cells: [
                humanise(a.addressType),
                // A readable width of its own: the table scrolls sideways on a phone
                // rather than the address going one word per line.
                <span key="a" className="block min-w-[13rem]">
                  {[a.line, a.city, a.district, a.state, a.pincode].filter(Boolean).join(", ")}
                </span>,
                formatDate(a.effectiveFrom),
                formatDate(lastDay(a.effectiveTo)),
                a.nearestPoliceStation ?? "—",
                a.recordedBy ?? "—",
                ...(proofs
                  ? [
                      <ProofCell
                        key="p"
                        address={a}
                        onAttach={(id) => {
                          setProofError("");
                          setAttaching(id);
                        }}
                        onError={setProofError}
                      />,
                    ]
                  : []),
                <CurrentOrArchived key="s" open={a.effectiveTo === null} />,
              ],
            }))}
          />
          {proofError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {proofError}
            </p>
          )}
          {attaching && (
            <div className="mt-3">
              <AttachProofForm
                employeeId={card.id}
                addressId={attaching}
                onCancel={() => setAttaching(null)}
                onDone={async () => {
                  setAttaching(null);
                  await onChanged();
                }}
              />
            </div>
          )}
        </Panel>
      )}

      {card.deployments && (
        <Panel
          title="Deployment history"
          aside={edit(card) && <MoveUnitDialog card={card} onChanged={onChanged} />}
          footer="Attendance, the muster roll and the client invoice each read whichever unit was current on the day, not the one current now."
        >
          <RecordTable
            testId="deployment-history"
            headers={["Unit", "From", "To", "Duration", "Order ref", "Moved by", "Status"]}
            empty="No postings recorded yet."
            rows={card.deployments.map((d) => ({
              key: d.id,
              muted: d.effectiveTo !== null,
              cells: [
                d.unitRetired ? `${d.unitName} (retired unit)` : d.unitName,
                formatDate(d.effectiveFrom),
                formatDate(lastDay(d.effectiveTo)),
                formatMonths(monthsBetween(d.effectiveFrom, d.effectiveTo, today)),
                <span key="o" className="font-mono">
                  {d.deploymentOrderRef}
                </span>,
                d.movedBy ?? "—",
                <CurrentOrArchived key="s" open={d.effectiveTo === null} />,
              ],
            }))}
          />
        </Panel>
      )}

      {card.previousOrganisations && (
        <Panel
          title="Previous organisations"
          aside={edit(card) && <PreviousOrgsEditor card={card} onChanged={onChanged} />}
          footer="Total experience on the Personal tab is these rows plus service here, so it is never typed by hand."
        >
          <RecordTable
            testId="previous-orgs"
            headers={["Organisation", "Designation", "From", "To", "Length", "Reason for leaving"]}
            empty="None recorded."
            rows={card.previousOrganisations.map((p) => ({
              key: p.id,
              cells: [
                p.organisationName,
                p.designation ?? "—",
                formatDate(p.fromDate),
                formatDate(p.toDate),
                formatMonths(monthsBetween(p.fromDate, p.toDate, today)),
                p.reasonForLeaving ?? "—",
              ],
            }))}
          />
        </Panel>
      )}
    </div>
  );
}
