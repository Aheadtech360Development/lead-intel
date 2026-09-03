import { redirect } from "next/navigation";

// The proxy already redirects signed-out users to /login, so anyone reaching this page is
// authenticated. They land on the dashboard rather than the list because its first section is
// "what to do next" — which is the question someone opening the tool actually has, and the one
// the old landing page (a table with twenty filters above it) answered worst.
export default function RootPage() {
  redirect("/dashboard");
}
