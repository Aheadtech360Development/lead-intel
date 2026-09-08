import { createBusiness } from "./actions";
import { AppShell } from "../../ui";

export default async function NewRecordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <AppShell
      autoRefresh={false}
      back={{ href: "/records", label: "Back to leads" }}
      title="Add one by hand"
      what="For a business you already know about. Everything you type is marked first-party and verified — you confirmed it — and it is deduplicated against everything you already have, so adding one twice cannot create a second copy."
    >
      <>
      {error && (
        <div
          style={{
            padding: "12px 16px",
            marginBottom: 20,
            background: "var(--warn-bg)",
            border: "1px solid #d3ac71",
            borderRadius: 3,
            color: "var(--warn-ink)",
            fontSize: 16,
          }}
        >
          {error}
        </div>
      )}

      <form
        action={createBusiness}
        style={{ background: "var(--surface)", border: "1px solid var(--rule)", borderRadius: 3, padding: 24 }}
      >
        <div className="field">
          <label htmlFor="name">Business name</label>
          <input id="name" name="name" type="text" required placeholder="Unique Screen Printing" />
        </div>
        <div className="field">
          <label htmlFor="domain">Website</label>
          <input id="domain" name="domain" type="text" placeholder="uniquescreenprinting.com" />
        </div>
        <div className="field">
          <label htmlFor="phone">Phone</label>
          <input id="phone" name="phone" type="text" placeholder="(305) 757-6723" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="field">
            <label htmlFor="city">City</label>
            <input id="city" name="city" type="text" placeholder="Miami" />
          </div>
          <div className="field">
            <label htmlFor="state">State</label>
            <input id="state" name="state" type="text" placeholder="FL" />
          </div>
        </div>
        <button className="btn" type="submit" style={{ marginTop: 6 }}>
          Save record
        </button>
      </form>
      </>
    </AppShell>
  );
}
