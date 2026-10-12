/** How each stage of joining is drawn. Colour is emphasis; the label always says it. */

import type { StatusTone } from "@/components/shared/status-badge";
import type { Stage } from "./contracts";

export const STAGE_TONE: Record<Stage, StatusTone> = {
  draft: "info",
  invited: "warning",
  active: "success",
  deactivated: "neutral",
  removed: "neutral",
};
