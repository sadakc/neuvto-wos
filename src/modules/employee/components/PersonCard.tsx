/**
 * Somebody else's card, reached from the Directory or a "Reports to" link.
 * Sits under Directory so the tab bar keeps Directory lit while you read it.
 */

import { useSearch } from "@tanstack/react-router";
import { CardScreen } from "./CardScreen";

export default function PersonCard() {
  const search = useSearch({ strict: false }) as { id?: unknown };
  const id = typeof search.id === "string" ? search.id : undefined;
  if (!id) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        Choose somebody from the Directory.
      </p>
    );
  }
  return <CardScreen employeeId={id} />;
}
