export default function ErrorPage() {
  return (
    <main style={{ maxWidth: 420, margin: "80px auto", padding: "0 24px", textAlign: "center" }}>
      <h1 style={{ fontSize: 22 }}>Sign-in didn&apos;t work</h1>
      <p style={{ color: "var(--ink-3)" }}>
        The link may have expired, or the email and password don&apos;t match. Try again, or ask
        an admin to resend an invite.
      </p>
      <a className="btn" href="/login" style={{ display: "inline-block", marginTop: 12 }}>
        Back to sign in
      </a>
    </main>
  );
}
