import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { claimRole, getMyRoleContext, registerCompany } from "@/lib/auth.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Blue Collar Tips" },
      { name: "description", content: "Sign in to Blue Collar Tips to manage employee tips, customer ratings, team invites, and company reputation tools." },
      { property: "og:title", content: "Sign in — Blue Collar Tips" },
      { property: "og:description", content: "Sign in or create your Blue Collar Tips account to manage tips, ratings, and your team." },
      { property: "og:url", content: "https://roadsidetips.lovable.app/auth" },
    ],
    links: [{ rel: "canonical", href: "https://roadsidetips.lovable.app/auth" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const claim = useServerFn(claimRole);
  const getRole = useServerFn(getMyRoleContext);
  const register = useServerFn(registerCompany);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signupType, setSignupType] = useState<"company" | "employee">("company");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onForgotPassword() {
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError("Enter your email above first, then tap “Forgot password”.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setInfo("Check your email for a link to set a new password.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not send reset email");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const inv = params.get("invite");
      const em = params.get("email");
      if (inv) {
        setInviteCode(inv.toUpperCase());
        setMode("signup");
        setSignupType("employee");
      }
      if (em) setEmail(em);
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  async function routeAfterAuth() {
    try {
      const ctx = await getRole();
      if (!ctx.roles.length && !ctx.driver) {
        try {
          if (mode === "signup" && signupType === "company") {
            await register({ data: { companyName: companyName.trim() } });
          } else {
            await claim({ data: { inviteCode: inviteCode || undefined } });
          }
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : "Could not assign role");
          return;
        }
      }
      navigate({ to: "/dashboard" });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sign in succeeded but routing failed");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        if (signupType === "company" && companyName.trim().length < 2) {
          throw new Error("Enter your company name.");
        }
        if (signupType === "employee" && !inviteCode.trim()) {
          throw new Error("Enter the invite code your employer sent you.");
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      await routeAfterAuth();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← Back
        </Link>
        <h1 className="display mt-4 text-2xl font-bold">
          {mode === "signin" ? "Sign in" : "Create account"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "signin"
            ? "Welcome back."
            : signupType === "company"
              ? "Register your company to start collecting tips and ratings."
              : "Joining a team? Enter the invite code your employer sent you."}
        </p>

        {mode === "signup" && (
          <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1 text-sm">
            <button
              type="button"
              onClick={() => { setSignupType("company"); setError(null); }}
              className={`rounded-md px-3 py-2 font-medium transition ${
                signupType === "company"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Register a company
            </button>
            <button
              type="button"
              onClick={() => { setSignupType("employee"); setError(null); }}
              className={`rounded-md px-3 py-2 font-medium transition ${
                signupType === "employee"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Join as employee
            </button>
          </div>
        )}

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          {mode === "signup" && (
            <div>
              <label className="block text-sm font-medium">Full name</label>
              <input
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                maxLength={120}
              />
            </div>
          )}
          {mode === "signup" && signupType === "company" && (
            <div>
              <label className="block text-sm font-medium">Company name</label>
              <input
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                maxLength={120}
                placeholder="Acme Towing LLC"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                You'll become the company admin and can invite your team.
              </p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium">Email</label>
            <input
              type="email"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Password</label>
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          {mode === "signup" && signupType === "employee" && (
            <div>
              <label className="block text-sm font-medium">Invite code</label>
              <input
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm uppercase"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                maxLength={32}
                placeholder="ABCD1234"
                required
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Ask your company admin for this code, or use the invite link they emailed you.
              </p>
            </div>
          )}
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {info && (
            <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{info}</div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        {mode === "signin" && (
          <button
            type="button"
            onClick={onForgotPassword}
            className="mt-4 block text-sm text-muted-foreground hover:underline"
          >
            Forgot password?
          </button>
        )}

        <button
          type="button"
          className="mt-2 block text-sm text-muted-foreground hover:underline"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setInfo(null);
          }}
        >
          {mode === "signin"
            ? "Don't have an account? Create one"
            : "Already have an account? Sign in"}
        </button>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing you agree to our{" "}
          <Link to="/terms" className="underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}