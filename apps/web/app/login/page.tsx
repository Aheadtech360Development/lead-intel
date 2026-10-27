import { login } from "./actions";

/**
 * The first screen anyone sees, so it is the first promise the product makes.
 *
 * It says three things and nothing else: whose product this is, that accounts are not self-served,
 * and where to type. No marketing, no illustration — this is an internal instrument, and a sign-in
 * page that oversells itself is the wrong first impression for one.
 */
export default function LoginPage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card pad" style={{ width: "min(400px, 100%)", display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="brand-logo" aria-hidden>
            L
          </span>
          <span>
            <span className="brand-name" style={{ display: "block" }}>
              Lead Intel
            </span>
            <span className="brand-sub" style={{ display: "block" }}>
              AheadTech360
            </span>
          </span>
        </div>

        <div>
          <h1 style={{ fontSize: 21 }}>Sign in</h1>
          <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--ink-3)" }}>
            Internal to AheadTech360. Accounts are created by an admin.
          </p>
        </div>

        <form style={{ display: "grid", gap: 2 }}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          <button className="btn lg" style={{ width: "100%" }} formAction={login}>
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
