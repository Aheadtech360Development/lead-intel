import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { signOut } from "../actions";
import { AppShell, InfoBox, NotBuilt } from "../ui";

/**
 * The per-person notification list — agreed, specified, not built.
 *
 * What exists today is deliberately named on the screen, because it is not nothing: a banner while
 * a task runs, a five-second message when one finishes, and the task's own row carrying its state
 * and reason. The missing part is the *record* of those events, per person, that survives a page
 * reload. See `specs/multi-user/spec.md` §10.
 */
export default async function NotificationsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  return (
    <AppShell
      current="notifications"
      email={viewer.email}
      signOutAction={signOut}
      title="Notifications"
      what="Yours only — another person's notifications are theirs, and the administrator's are separate again."
    >
      <NotBuilt
        what={
          <>
            A list of the nine things worth telling you about, kept per person: a task finished, stopped or never
            started · leads given to you · a transfer asked for · a transfer decided · leads arriving from one ·
            something deleted · a paid lookup and what it cost · a budget run out or topped up · a new Showcase post.
          </>
        }
        instead={
          <>
            The running-task banner appears on every screen while something is working, a message appears for five
            seconds when a task finishes, and <Link href="/tasks">Tasks</Link> keeps every run with its state, its
            reason and its cost. Nothing is lost — it is just not collected in one place yet.
          </>
        }
        steps={[
          {
            title: "An event is written when it happens",
            what: "Not when you next open the page. A task that finishes at two in the morning is still there in the morning.",
          },
          {
            title: "Yours shows only yours",
            what: "Enforced in the database, not by hiding rows on the screen — so typing the address by hand gives the same answer.",
          },
          {
            title: "Opening the panel does not clear it",
            what: "You decide what you have dealt with. Read state is per row, and it is yours to set.",
          },
          {
            title: "Every notification goes somewhere",
            what: "A task notification opens the task, a transfer opens the request, a purchase opens the spend it is part of.",
          },
        ]}
      >
        <InfoBox title="One thing still open" tone="warn">
          How long a notification is kept before it is cleared has not been decided (`spec.md` §14). It is a real
          decision with a cost attached — a year of task notifications for a team of five is a lot of rows for
          something nobody reads twice.
        </InfoBox>
      </NotBuilt>
    </AppShell>
  );
}
