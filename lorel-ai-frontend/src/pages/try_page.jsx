import { useEffect, useState } from "react";

import { EyeIcon, EyeOffIcon } from "../components/icons";
import Navbar from "../components/navbar";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Link, useRouter } from "../lib/router";

const PERKS = [
  { id: "01", title: "Unlimited questions", detail: "Ask the demo library anything. Every claim comes back cited to its page." },
  { id: "02", title: "Your own books", detail: "Upload a text-based PDF and ask it questions. Private to your account. (Beta)" },
  { id: "03", title: "Nothing kept by default", detail: "Chats vanish when you leave. Save only the ones you want to come back to." },
];

function fieldErrors(error) {
  const errors = {};
  for (const detail of error?.details ?? []) {
    const field = detail.field?.replace(/^body\./, "");
    if (field && !errors[field]) errors[field] = detail.message;
  }
  return errors;
}

export default function TryPage() {
  const { status, signIn, signUp } = useAuth();
  const { query, navigate } = useRouter();
  const [mode, setMode] = useState(query.get("mode") === "signin" ? "signin" : "signup");
  const [form, setForm] = useState({ email: "", password: "", displayName: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const next = query.get("next")?.startsWith("/") ? query.get("next") : "/app";

  useEffect(() => {
    if (status === "signedIn") navigate(next, { replace: true });
  }, [status, next, navigate]);

  const switchMode = (value) => {
    setMode(value);
    setError(null);
    navigate(`/try?mode=${value}`, { replace: true });
  };
  const update = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "signup") {
        await signUp({ email: form.email, password: form.password, displayName: form.displayName.trim() || undefined });
      } else {
        await signIn(form.email, form.password);
      }
      // The auth state change redirects to the app
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, null));
    } finally {
      setSubmitting(false);
    }
  }

  const errors = fieldErrors(error);
  const general = error && !Object.keys(errors).length ? error.message : null;

  return (
    <div className="try-page">
      <Navbar />
      <main className="try">
        <section className="try__pitch">
          <span className="hero-pill">
            <i className="hero-pill__pulse" />
            free account · no card
          </span>
          <h1>
            Ask the books,
            <br />
            <span>not the internet.</span>
          </h1>
          <p className="hero-lede">
            The same answer engine as the demo, without the three-question limit. Every answer is written from book
            passages and cited to the page you can check.
          </p>
          <ol className="try__perks">
            {PERKS.map((perk) => (
              <li key={perk.id}>
                <span className="pipeline-node__id">{perk.id}</span>
                <div>
                  <h3>{perk.title}</h3>
                  <p>{perk.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="try__card" aria-labelledby="auth-heading">
          <div className="segmented" role="tablist" aria-label="Account">
            <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "is-active" : ""} onClick={() => switchMode("signup")}>
              Create account
            </button>
            <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "is-active" : ""} onClick={() => switchMode("signin")}>
              Sign in
            </button>
          </div>

          <h2 id="auth-heading" className="try__card-title">
            {mode === "signup" ? "Start asking in a minute." : "Welcome back."}
          </h2>

          <form className="form" onSubmit={submit} noValidate>
            {mode === "signup" && (
              <label className="field">
                <span className="field__label">
                  Name <em>optional</em>
                </span>
                <input value={form.displayName} onChange={update("displayName")} autoComplete="name" maxLength={80} placeholder="What should we call you?" />
              </label>
            )}
            <label className={`field${errors.email ? " has-error" : ""}`}>
              <span className="field__label">Email</span>
              <input type="email" value={form.email} onChange={update("email")} autoComplete="email" required placeholder="you@example.com" aria-invalid={Boolean(errors.email)} />
              {errors.email && <span className="field__error">{errors.email}</span>}
            </label>
            <label className={`field${errors.password ? " has-error" : ""}`}>
              <span className="field__label">Password</span>
              <span className="field__with-action">
                <input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={update("password")}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  required
                  minLength={mode === "signup" ? 8 : undefined}
                  placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                  aria-invalid={Boolean(errors.password)}
                />
                <button type="button" className="icon-button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </span>
              {errors.password && <span className="field__error">{errors.password}</span>}
            </label>

            {general && (
              <p className="form__error" role="alert">
                {general}
                {error.code === "email_taken" && (
                  <>
                    {" "}
                    <button type="button" className="text-button" onClick={() => switchMode("signin")}>
                      Sign in instead
                    </button>
                  </>
                )}
              </p>
            )}

            <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={submitting}>
              {submitting ? (mode === "signup" ? "Creating your account…" : "Signing in…") : mode === "signup" ? "Create free account" : "Sign in"}
            </button>
          </form>

          <p className="try__fine">
            {mode === "signup" ? (
              <>
                Already have an account?{" "}
                <button type="button" className="text-button" onClick={() => switchMode("signin")}>
                  Sign in
                </button>
              </>
            ) : (
              <>
                New here?{" "}
                <button type="button" className="text-button" onClick={() => switchMode("signup")}>
                  Create a free account
                </button>
              </>
            )}
          </p>
          <p className="try__fine try__fine--muted">
            Passwords are hashed with scrypt; sessions use an httpOnly cookie. <Link to="/#demo">Try the demo first →</Link>
          </p>
        </section>
      </main>
    </div>
  );
}
