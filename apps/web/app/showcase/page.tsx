import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { signOut } from "../actions";
import { AppShell, InfoBox, NotBuilt } from "../ui";

/**
 * The one shared place — agreed, specified, not built.
 *
 * Everything else on this side of the product is private to whoever it belongs to. Showcase is the
 * single exception the operator asked for, and the thing it must never become is a side door onto
 * somebody else's leads: a method is shared whole, a lead is shared in part and says so.
 * See `specs/multi-user/spec.md` §11.
 */
export default async function ShowcasePage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  return (
    <AppShell
      current="showcase"
      email={viewer.email}
      signOutAction={signOut}
      title="Showcase"
      what="The only screen where you see somebody else's work. Put up what worked; take what is useful."
    >
      <NotBuilt
        what={
          <>
            A short post, optionally with something attached: a <b>way of working</b> — an opener, a filter, a rule
            that keeps paying off — which is shared whole, or a <b>lead</b>, which is shared only as figures.
          </>
        }
        instead={
          <>
            Nothing in the product is shared between people yet, because there is only one account. Everything that
            would be posted here — openers, filters, what a lead looked like — lives on the lead it came from.
          </>
        }
        steps={[
          { title: "Anyone can post", what: "Members and the administrator, in the same list, with no ranking and no leaderboard." },
          {
            title: "A method is shared whole",
            what: "An opener or a filter is a way of working, not somebody's data, so all of it goes up and anyone can take it.",
          },
          {
            title: "A lead is shared in part",
            what: "Followers, scores, website status — and never the name, the phone number or your call notes. Posting a lead does not hand over the record.",
          },
          {
            title: "The person who posted it, and the administrator, can remove it",
            what: "Nobody else. A post is not editable by the people reading it.",
          },
        ]}
      >
        <InfoBox title="Why this is the only shared screen" tone="info">
          The whole member side is built so that one person&rsquo;s leads, calls, spend and tasks are invisible to
          everybody else. That boundary is worth keeping precisely because there is one deliberate hole in it, in a
          place where sharing is the point.
        </InfoBox>
      </NotBuilt>
    </AppShell>
  );
}
