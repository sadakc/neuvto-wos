import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/** A link to somebody's card. Your own card is My Card; anybody else's sits under Directory. */
export function PersonLink({
  employeeId,
  children,
  className,
}: {
  employeeId: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      to="/app/$"
      params={{ _splat: "employee/directory/person" }}
      search={{ id: employeeId } as never}
      className={cn("text-primary underline-offset-2 hover:underline", className)}
    >
      {children}
    </Link>
  );
}
