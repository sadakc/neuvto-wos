/**
 * The lists a position is chosen from, and the "Add …" at the foot of each
 * (D103). Shared by the card's Position editor and the Add Employee form, so
 * both offer the same lists and add to them the same way.
 */

import { useEffect, useState } from "react";
import type { AdminOverview } from "./contracts";
import {
  addDepartment,
  getAdminOverview,
  listDesignations,
  listManagerCandidates,
  makeManager,
  saveDesignation,
  saveUnit,
  type Option,
} from "./handlers";
import type { AddChoice } from "./components/FieldEditor";

/** The units a person can be deployed to are added the same way (D104). */
export const addUnitChoice: AddChoice = {
  kind: "name",
  label: "Add a unit…",
  prompt: "New unit",
  rule: "text100",
  second: {
    prompt: "Client (for a client site)",
    hint: "Leave it empty for one of your own establishments. Everything else about the unit is in Configuration.",
  },
  create: (name, client) =>
    saveUnit(null, client ? { name, unitType: "client_site", clientName: client } : { name }),
};

/**
 * The four lists a position is chosen from, with an "Add …" at the foot of
 * each (D103): a designation or a department joins the company's one list,
 * the same one Configuration and Organisation show; "Reports to" makes
 * somebody a Manager first, because only somebody who approves has reports
 * (D57).
 */
export function usePositionLists() {
  const [designations, setDesignations] = useState<Option[] | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  useEffect(() => {
    listDesignations()
      .then(setDesignations)
      .catch(() => setDesignations([]));
    getAdminOverview()
      .then(setOverview)
      .catch(() => setOverview(null));
  }, []);
  return {
    designations: designations ?? [],
    departments: overview?.departments ?? [],
    managers: overview?.managers ?? [],
  };
}

export const addDesignationChoice: AddChoice = {
  kind: "name",
  label: "Add a designation…",
  prompt: "New designation",
  rule: "text100",
  second: {
    prompt: "Grade (optional)",
    hint: "Everybody with this designation has this grade.",
    maxLength: 30,
  },
  create: (name, grade) => saveDesignation(null, grade ? { name, grade } : { name }),
};

export const addDepartmentChoice: AddChoice = {
  kind: "name",
  label: "Add a department…",
  prompt: "New department",
  rule: "text100",
  create: (name) => addDepartment(name),
};

export const addManagerChoice: AddChoice = {
  kind: "pick",
  label: "Make somebody a Manager…",
  prompt: "Make a Manager",
  note: "Only somebody who can approve has people reporting to them. This gives them the Manager role, so their reports' leave reaches them.",
  choices: async () =>
    (await listManagerCandidates()).map((c) => [c.profileId, c.fullName] as [string, string]),
  create: async (profileId) => {
    await makeManager(profileId);
    return profileId;
  },
};
