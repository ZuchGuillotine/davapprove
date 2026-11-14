import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { getAuth } from "./api";

type Mode = "signin" | "signup" | "reset";

function message(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "invalid_credentials")
    return "Email or password is incorrect. Please try again.";
  if (code === "email_not_confirmed")
    return "Confirm your email before signing in. Check your inbox for the confirmation link.";
  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit"
  )
    return "Too many requests. Please wait a few minutes and try again.";
  if (
    code === "email_address_not_authorized" ||
    code === "email_provider_disabled"
  )
    return "Email delivery is not ready for this address. Contact the project owner for beta access.";
  return error instanceof Error
    ? error.message
    : "Unable to complete this request. Please try again.";
}

export default function AuthPanel({
  available,
  emailEnabled,
}: {
  available: boolean;
  emailEnabled: boolean;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  function changeMode(next: Mode) {
    setMode(next);
    setPassword("");
    setConfirmation("");
    setError("");
    setNotice("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !available || (mode !== "signin" && !emailEnabled)) return;
    const auth = getAuth();
    if (!auth) return;
    setError("");
    setNotice("");
    if (mode === "signup" && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await auth.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await auth.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin + "/" },
        });
        if (error) throw error;
        // Supabase can deliberately return an obfuscated user for an existing account.
        if (!data.session)
          setNotice(
            "Check your email to confirm your account before signing in. If you already have an account, sign in or reset your password.",
          );
      } else {
        const { error } = await auth.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin + "/?auth=recovery",
        });
        if (error) throw error;
        setNotice(
          "If this email has an account, a password-reset link will arrive shortly. Open it to choose a new password.",
        );
      }
      setPassword("");
      setConfirmation("");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-panel" aria-label="Account access">
      <div className="auth-tabs" aria-label="Account options">
        <button
          type="button"
          className={mode === "signin" ? "active" : ""}
          aria-pressed={mode === "signin"}
          disabled={busy}
          onClick={() => changeMode("signin")}
        >
          Sign in
        </button>
        <button
          type="button"
          className={mode === "signup" ? "active" : ""}
          aria-pressed={mode === "signup"}
          disabled={busy}
          onClick={() => changeMode("signup")}
        >
          Create account
        </button>
      </div>
      <form
        onSubmit={submit}
        aria-label={
          mode === "reset"
            ? "Reset password"
            : mode === "signup"
              ? "Create account"
              : "Sign in"
        }
      >
        <label>
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={busy}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourstudio.com"
          />
        </label>
        {mode !== "reset" && (
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              required
              minLength={mode === "signup" ? 8 : undefined}
              disabled={busy}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {mode === "signup" && (
          <>
            <label>
              Confirm password
              <input
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                disabled={busy}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
            <p className="small muted">
              Use at least 8 characters. Confirm your email to activate your
              account. Your projects are private until you share them.
            </p>
          </>
        )}
        {mode === "reset" && (
          <p className="small muted">
            We’ll send a link so you can choose a new password.
          </p>
        )}
        <button
          className="primary full"
          disabled={busy || !available || (mode !== "signin" && !emailEnabled)}
        >
          {busy
            ? "Please wait…"
            : mode === "signin"
              ? "Sign in to workspace"
              : mode === "signup"
                ? "Create beta account"
                : "Send reset link"}
          <ArrowRight size={17} />
        </button>
      </form>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!emailEnabled && mode !== "signin" && (
        <p className="small muted">
          Email confirmation and recovery are being set up. Contact the project
          owner for beta access; existing accounts can sign in with a password.
        </p>
      )}
      <button
        type="button"
        className="text-button auth-reset"
        disabled={busy}
        onClick={() => changeMode(mode === "reset" ? "signin" : "reset")}
      >
        {mode === "reset" ? "Back to sign in" : "Forgot password?"}
      </button>
    </section>
  );
}

export function PasswordForm({ onSaved }: { onSaved: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    const auth = getAuth();
    if (!auth) {
      setError("Sign in again to change your password.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await auth.auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      setConfirmation("");
      onSaved();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="password-form" aria-label="Set password">
      <label>
        New password
        <input
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={busy}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        Confirm new password
        <input
          name="confirm-new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={busy}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </label>
      <p className="small muted">Use at least 8 characters.</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="primary full" disabled={busy}>
        {busy ? "Saving password…" : "Save password"}
      </button>
    </form>
  );
}
