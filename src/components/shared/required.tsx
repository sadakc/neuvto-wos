/**
 * The red asterisk on a required field's label, and the rule that goes with it
 * (Sada, 14 Oct 2026): a form's button is never greyed out for something
 * missing. Pressing it says what is missing, in red under each field, and
 * nothing is sent. Disabled stays for "saving" and for "not yours to change".
 */

/**
 * The asterisk is drawn by CSS, so it is not part of the label's text: the
 * field is still called "UAN", not "UAN*". Screen readers hear "required" from
 * the control's own `required` or `aria-required`.
 */
const MARK = "after:ml-0.5 after:text-destructive after:content-['*']";

/** A field's label with its asterisk when it is required. */
export function LabelText({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  if (!required) return <>{children}</>;
  return (
    <span data-required="true" className={MARK}>
      {children}
    </span>
  );
}

/** The red line under a field that is wrong. */
export function FieldError({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <span id={id} role="alert" className="mt-1 block text-sm text-destructive">
      {children}
    </span>
  );
}
