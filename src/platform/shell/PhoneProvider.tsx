/**
 * Platform · Shell · Holds what the current screen declared (doc 11.4), for
 * the app bar. `phone` is whether the phone shell is in charge.
 */

import { useState, type ReactNode } from "react";
import { PhoneContext, type SubNav } from "./phone-context";

export function PhoneProvider({ phone, children }: { phone: boolean; children: ReactNode }) {
  const [sub, setSub] = useState<SubNav | null>(null);
  return (
    <PhoneContext.Provider value={{ phone, sub: phone ? sub : null, setSub }}>
      {children}
    </PhoneContext.Provider>
  );
}
