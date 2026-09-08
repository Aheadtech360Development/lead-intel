import { login } from "./actions";

export default function LoginPage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 4,
          padding: "36px 32px",
        }}
      >
        <h1 style={{ fontSize: 34, margin: "0 0 6px" }}>Lead Intel</h1>
        <p style={{ margin: "0 0 28px", color: "var(--ink-3)" }}>
          AheadTech360 internal. Accounts are created by an admin.
        </p>
        <form>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          <button className="btn" style={{ width: "100%", marginTop: 6 }} formAction={login}>
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
