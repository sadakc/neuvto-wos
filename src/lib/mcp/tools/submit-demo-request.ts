import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "submit_demo_request",
  title: "Submit demo request",
  description: "Create a new Neuvto demo/lead request on behalf of the signed-in user.",
  inputSchema: {
    name: z.string().trim().min(1).max(120).describe("Contact name for the lead."),
    email: z.string().trim().email().max(200).describe("Contact email for the lead."),
    company: z.string().trim().max(200).optional().describe("Company name (optional)."),
    employees: z.string().trim().max(50).optional().describe("Employee count / band (optional)."),
    message: z.string().trim().max(2000).optional().describe("Notes about the request (optional)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ name, email, company, employees, message }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("demo_requests")
      .insert({
        name,
        email,
        company: company || null,
        employees: employees || null,
        message: message || null,
      })
      .select()
      .maybeSingle();
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: `Demo request submitted (id: ${data?.id ?? "unknown"}).` }],
      structuredContent: { row: data },
    };
  },
});
