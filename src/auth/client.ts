import { getCurrentUser, requestPasswordReset, signIn, signOut, signUp } from "@/lib/auth.functions";

export const auth = {
  async getSession() {
    const result = await getCurrentUser();
    return { data: { session: result.user ? { user: result.user } : null }, error: null };
  },
  async signInWithPassword(input: { email: string; password: string }) {
    try { await signIn({ data: input }); return { error: null }; } catch (error) { return { error }; }
  },
  async signUp(input: { email: string; password: string; options?: { data?: { full_name?: string }; emailRedirectTo?: string } }) {
    try { await signUp({ data: { email: input.email, password: input.password, fullName: input.options?.data?.full_name ?? input.email } }); return { error: null }; } catch (error) { return { error }; }
  },
  async signOut() { await signOut(); return { error: null }; },
  async resetPasswordForEmail(email: string, _options?: { redirectTo?: string }) {
    try { await requestPasswordReset({ data: { email } }); return { error: null }; } catch (error) { return { error }; }
  },
};
