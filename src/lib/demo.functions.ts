import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DemoSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  company: z.string().max(200).optional().or(z.literal("")),
  employees: z.string().max(50).optional().or(z.literal("")),
  message: z.string().max(2000).optional().or(z.literal("")),
});

export const submitDemoRequest = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => DemoSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("demo_requests").insert({
      name: data.name,
      email: data.email,
      company: data.company || null,
      employees: data.employees || null,
      message: data.message || null,
    });
    if (error) {
      console.error("submitDemoRequest failed", error);
      throw new Error("Could not submit request. Please try again.");
    }
    return { ok: true };
  });
