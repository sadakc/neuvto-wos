import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import submitDemoRequestTool from "./tools/submit-demo-request";

// The OAuth issuer MUST be the direct Supabase host — the Lovable proxy URL is
// rewritten on publish and mcp-js rejects it (RFC 8414 issuer mismatch).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "neuvto-mcp",
  title: "Neuvto WOS",
  version: "0.1.0",
  instructions:
    "Tools for Neuvto WOS. Use `whoami` to verify the connected user, and `submit_demo_request` to file a new demo/lead request.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, submitDemoRequestTool],
});
