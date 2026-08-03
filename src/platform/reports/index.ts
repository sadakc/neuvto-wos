/**
 * Platform · Reports
 *
 * The only import path for the reporting furniture. Modules contribute reports
 * through `ModuleDefinition.reports` and render them with what is exported here;
 * the platform never learns what any of them are about (D30).
 */

export { toCsv, downloadCsv, reportFilename, type CsvValue } from "./csv";
export { reportHeaders, reportMatrix, type ReportColumn } from "./table";
export { ReportView } from "./ReportView";
export { dateInZone, monthBounds } from "./dates";
export { useOrgClock, type OrgClock } from "./useOrgClock";
