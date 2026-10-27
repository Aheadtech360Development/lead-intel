import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { signOut } from "../actions";
import { AppShell, InfoBox, NotBuilt } from "../ui";

/**
 * Asking for leads to be passed to a colleague — agreed, specified, not built.
 *
 * The honest part of this feature is the state in the middle: **asked for, and still yours.** A
 * transfer that moves leads the moment it is requested is not a transfer that needs approving, and
 * the operator was explicit that the administrator decides. See `specs/multi-user/spec.md` §9.
 */
export default async function TransfersPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  return (
    <AppShell
      current="transfers"
      email={viewer.email}
      signOutAction={signOut}
      title="Transfers"
      what={
        viewer.isAdmin
          ? "Requests from the team to pass leads to each other. Nothing moves until you approve it."
          : "Hand some of your leads to a colleague. The administrator has to approve it first, so nothing moves the moment you ask."
      }
    >
      <NotBuilt
        what={
          <>
            Tick some leads, choose a colleague, say why, and send the request. The leads stay with you — on your list,
            yours to work — until the administrator decides. If it is approved they move with their call history
            attached; if it is refused, nothing changes at all.
          </>
        }
        instead={
          <>
            Claiming and releasing already work. Releasing a lead puts it back in the pool for anyone to pick up, and
            your calls stay on the record for whoever takes it — which gets a lead from one person to another, just
            without the second signature. <Link href="/records">The leads list</Link> has both.
          </>
        }
        steps={[
          { title: "Tick the leads", what: "From the leads list, the same selection that drives every other bulk action." },
          { title: "Choose who and say why", what: "Anyone on the team. The reason is what the administrator reads before deciding." },
          {
            title: "Waiting — and still yours",
            what: "The request is recorded and the leads do not move. They stay on your list and you can withdraw the request.",
          },
          {
            title: "Approved, refused, or part-approved",
            what: "A partial approval names which lead was held back and why. Nothing ever moves silently.",
          },
          { title: "A refusal can be asked again after a day", what: "Agreed deliberately, so a no is not permanent and not a nag either." },
        ]}
      >
        <InfoBox title="Why approval at all" tone="info">
          Leads cost money to find. A transfer is a quiet way for work to be moved off someone&rsquo;s list, so the
          person paying for the list is the person who signs it off. That was the operator&rsquo;s decision, not a
          technical constraint.
        </InfoBox>
      </NotBuilt>
    </AppShell>
  );
}
