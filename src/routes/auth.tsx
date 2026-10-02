import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { auth } from "@/auth/client";
import { claimRole, getMyRoleContext, registerCompany } from "@/lib/auth.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Blue Collar Tips" },
      { name: "description", content: "Sign in to Blue Collar Tips to manage employee tips, customer ratings, team invites, and company reputation tools." },
      { property: "og:title", content: "Sign in — Blue Collar Tips" },
      { property: "og:description", content: "Sign in or create your Blue Collar Tips account to manage tips, ratings, and your team." },
      { property: "og:url", content: "https://bluecollartips.app/auth" },
    ],
    links: [{ rel: "canonical", href: "https://bluecollartips.app/auth" }],
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
      const { error } = await auth.resetPasswordForEmail(email.trim(), {
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
    let inviteFromUrl: string | null = null;
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const inv = params.get("invite");
      inviteFromUrl = inv;
      const em = params.get("email");
      const oauthError = params.get("oauthError");
      const signup = params.get("signup");
      if (signup === "company" || signup === "employee") {
        setMode("signup");
        setSignupType(signup);
      }
      if (inv) {
        setInviteCode(inv.toUpperCase());
        setMode("signup");
        setSignupType("employee");
      }
      if (em) setEmail(em);
      if (oauthError) setError(oauthError);
    }
    auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      if (inviteFromUrl) {
        try {
          await claim({ data: { inviteCode: inviteFromUrl } });
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : "Could not accept invite");
          return;
        }
      }
      navigate({ to: "/dashboard" });
    });
  }, [claim, navigate]);

  async function routeAfterAuth() {
    try {
      const ctx = await getRole();
      // An existing account may redeem another company's invite to gain a
      // second, separately scoped employee workspace.
      if (inviteCode.trim()) {
        try {
          await claim({ data: { inviteCode: inviteCode.trim() } });
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : "Could not accept invite");
          return;
        }
      } else if (!ctx.roles.length && !ctx.driver) {
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
        const { error } = await auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
      } else {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      await routeAfterAuth();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function continueWithGoogle() {
    setError(null);
    const params = new URLSearchParams();
    if (mode === "signup") {
      if (signupType === "company") {
        if (companyName.trim().length < 2) {
          setError("Enter your company name before continuing with Google.");
          return;
        }
        params.set("intent", "company");
        params.set("companyName", companyName.trim());
      } else {
        if (!inviteCode.trim()) {
          setError("Enter your employee invite code before continuing with Google.");
          return;
        }
        params.set("intent", "employee");
        params.set("inviteCode", inviteCode.trim());
      }
    } else {
      params.set("intent", "signin");
    }
    window.location.assign(`/api/auth/google?${params.toString()}`);
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
            : "Joining a team? Enter the 5-digit company code or the invitation code emailed to you."}
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

        <button
          type="button"
          onClick={continueWithGoogle}
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-md border border-input bg-background px-4 py-2.5 text-sm font-medium hover:bg-muted"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
            <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.33 2.98-7.39Z" />
            <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.38l-3.24-2.53c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.77-5.61-4.14H3.04v2.61A10 10 0 0 0 12 22Z" />
            <path fill="#FBBC05" d="M6.39 13.91A6 6 0 0 1 6.08 12c0-.66.11-1.3.31-1.91V7.48H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.52l3.35-2.61Z" />
            <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.48l3.35 2.61C7.18 7.72 9.39 5.95 12 5.95Z" />
          </svg>
          {mode === "signin" ? "Continue with Google" : "Create account with Google"}
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />or continue with email<div className="h-px flex-1 bg-border" />
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
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
              <label className="block text-sm font-medium">Company or invitation code</label>
              <input
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm uppercase"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                maxLength={32}
                placeholder="12345"
                required
              />
              <p className="mt-1 text-xs text-muted-foreground">
                A company code requires admin approval. An invitation sent to this exact email is accepted automatically.
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
