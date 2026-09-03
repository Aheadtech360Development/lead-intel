"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * No signup action here on purpose. Per spec, accounts are created by an admin — through the
 * Supabase Dashboard (Authentication -> Users -> Add user / Invite), not by anyone visiting this
 * page. That path also goes through app/auth/confirm/route.ts when an invite email is used.
 */
export async function login(formData: FormData) {
  const supabase = await createClient();

  // Type-cast for convenience; the form's `required` attributes cover basic presence, and
  // Supabase itself rejects a malformed email or password on the auth call below.
  const data = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  };

  const { error } = await supabase.auth.signInWithPassword(data);

  if (error) {
    redirect("/error");
  }

  redirect("/records");
}
