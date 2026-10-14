/**
 * Proof on an address (D98), on the History tab.
 *
 * The card carries `proof` on each address only for the person and the
 * Employee Admin, the two who may open and attach one; for anybody else the
 * key is absent and the column is not drawn.
 *
 * The current address offers View and Attach or Replace. An archived row has
 * no control at all (criterion 2); it says whether a proof is on file, and the
 * Documents tab opens it.
 *
 * Opening goes through the logged open (D95), never straight to storage.
 */

import { useState } from "react";
import { FilePicker } from "@/components/shared/file-picker";
import { isAppError } from "@/platform/errors";
import type { Address } from "../contracts";
import { attachAddressProof, openDocument } from "../handlers";

/** The Proof cell of one address row. */
export function ProofCell({
  address,
  onAttach,
  onError,
}: {
  address: Address;
  onAttach: (addressId: string) => void;
  onError: (message: string) => void;
}) {
  const proof = address.proof ?? null;
  if (address.effectiveTo !== null) {
    return <span>{proof ? "On file" : "None"}</span>;
  }
  return (
    <span className="flex min-w-[10rem] flex-col items-start gap-1 whitespace-nowrap">
      {proof ? (
        <>
          <span className="block max-w-[14rem] truncate" title={proof.fileName}>
            {proof.fileName}
          </span>
          <button
            type="button"
            onClick={() =>
              void openDocument(proof.documentId)
                .then((url) => window.open(url, "_blank", "noopener"))
                .catch((e) => onError(isAppError(e) ? e.message : "That proof couldn't be opened."))
            }
            className="text-sm underline underline-offset-4"
          >
            View proof
          </button>
        </>
      ) : (
        <span>None</span>
      )}
      <button
        type="button"
        onClick={() => onAttach(address.id)}
        className="text-sm underline underline-offset-4"
      >
        {proof ? "Replace proof" : "Attach proof"}
      </button>
    </span>
  );
}

/** Uploads a proof for one address. A replaced proof stays in the record. */
export function AttachProofForm({
  employeeId,
  addressId,
  onDone,
  onCancel,
}: {
  employeeId: string;
  addressId: string;
  onDone: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <form
      data-testid="attach-proof"
      className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!file) return;
        setBusy(true);
        setError("");
        attachAddressProof({ employeeId, addressId, file })
          .then(() => onDone())
          .catch((err) =>
            setError(isAppError(err) ? err.message : "The proof didn't attach. Try again."),
          )
          .finally(() => setBusy(false));
      }}
    >
      <div className="min-w-0 flex-1">
        <FilePicker
          label="Proof of address"
          file={file}
          onChange={setFile}
          hint="PDF or a photo, up to 10 MB. A proof already on file is replaced and stays in the record."
        />
      </div>
      <button
        type="submit"
        disabled={busy || !file}
        className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
      >
        {busy ? "Attaching…" : "Attach"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm"
      >
        Cancel
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
