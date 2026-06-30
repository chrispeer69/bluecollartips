import { supabase } from "@/integrations/supabase/client";

// DEV-ONLY auto-login. Creates (or reuses) a local dev super-admin account so
// you can navigate the app without manually signing in. Disabled in production.
const DEV_EMAIL = "dev@bluecollar.local";
const DEV_PASSWORD = "dev-password-123!";

let started = false;

export async function ensureDevSession(): Promise<void> {
  if (!import.meta.env.DEV) return;
  if (started) return;
  started = true;

  const { data } = await supabase.auth.getSession();
  if (data.session) return;

  const signIn = await supabase.auth.signInWithPassword({
    email: DEV_EMAIL,
    password: DEV_PASSWORD,
  });
  if (!signIn.error) return;

  const signUp = await supabase.auth.signUp({
    email: DEV_EMAIL,
    password: DEV_PASSWORD,
    options: { data: { full_name: "Dev Admin" } },
  });
  if (signUp.error) {
    console.warn("[dev-auth] could not create dev user:", signUp.error.message);
    return;
  }

  // Try to claim super_admin (only works if no super_admin exists yet).
  try {
    const { claimRole } = await import("@/lib/auth.functions");
    await claimRole({ data: {} });
  } catch (e) {
    console.warn("[dev-auth] claimRole skipped:", (e as Error).message);
  }
}