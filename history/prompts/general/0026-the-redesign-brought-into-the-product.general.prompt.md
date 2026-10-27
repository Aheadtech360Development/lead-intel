---
id: 0026
title: The redesign brought into the product
stage: general
date: 2026-10-13
surface: agent
model: claude-opus-5
feature: none
branch: main
user: Aheadtech360Development
command: ("acha ye design mai kuch new updates kerne hain is prompt ke related to isko properly design karo." → the 64-section UI/UX brief → "sahi hai ye design karo hamare store ko phir mai age aur cheezen batata hoon")
labels: ["design-system", "tokens", "dark-mode", "typography", "app-shell", "navigation", "accessibility", "ui"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
 - design/ui/lead-intel-app.html (the approved prototype this port follows; published artifact 19oJgxR1KgphCyuQNveBU6)
 - apps/web/app/globals.css (rewritten — petrol token system, light + dark, on-accent token, 25+ component classes, every old token name kept as an alias)
 - apps/web/app/layout.tsx (Inter / Inter Tight / JetBrains Mono self-hosted via next/font; data-theme stamped from the cookie)
 - apps/web/lib/theme.ts (new — THEME_COOKIE, readTheme, NEXT_THEME, THEME_LABEL)
 - apps/web/app/actions.ts (setTheme server action)
 - apps/web/app/ui.tsx (new AppShell: four nav groups, drawn SVG icon set, crumbs + search + spend chip + theme switch; Icon exported; StatCard/Badge/TierBadge/Meter/Th/TD/Fact/Price/Funnel/FilterOption restyled)
 - apps/web/app/login/page.tsx (rebuilt on the new card)
 - apps/web/app/records/[id]/page.tsx (tabs on the shared .tabs style; the model's read now carries the violet "AI insight" badge)
 - apps/web/app/dashboard/page.tsx, apps/web/app/spend/page.tsx (pass spentCents to the top bar)
tests:
 - apps/web typecheck clean after every step (npx tsc --noEmit -p apps/web/tsconfig.json)
 - /login rendered at 1000px in light and dark through Playwright — page errors: none; body font resolves to Inter, grounds to #f4f7f7 and #09100f
 - fonts confirmed self-hosted: the three next/font variable classes are on <html> in the served HTML, no font-host request
---

## Prompt

> sahi hai ye design karo hamare store ko phir mai age aur cheezen batata hoon

Following the 64-section "LEAD INTEL — COMPLETE PRODUCT UI/UX REDESIGN" brief and the clickable
prototype built from it, which the operator accepted.

## Response snapshot

The port was done at the layer that reaches every screen rather than screen by screen:

1. **Tokens.** `globals.css` rewritten on the prototype's petrol palette, with light and dark
   defined token-level in three states (bare `:root`, `prefers-color-scheme` guarded against an
   explicit light choice, and `[data-theme="dark"]`). Every name the previous palette used —
   `--paper`, `--rule`, `--brand`, `--shadow`, `--radius` — is kept as an alias, so thirty screens
   written against the old names wear the new design, including dark mode, without being rewritten.
2. **Two corrections to the prototype's own system.** Violet is reserved for AI output, so money
   moved to amber ("costs money or needs a decision") rather than sharing it; and `--on-accent`
   was added because the dark accent is a pale cyan, where white button text is unreadable.
3. **Contrast kept at the operator's standard, not the brief's.** The prototype's inks measure
   ~4.8:1 at `--ink-3`. Small print here is a third of every screen and was reported as too faint
   twice, so the inks are set by measurement at 16.8 / 11.4 / 8.7 / 5.9:1 and the type scale sits
   above the prototype's 13px.
4. **Typography.** Inter, Inter Tight and JetBrains Mono, self-hosted through `next/font` — no
   third-party request in front of the first paint, which matters on a product already reported as
   slow.
5. **Shell.** Sidebar in four groups (Main · Intelligence · Add businesses · Settings & data) with
   a drawn icon set replacing emoji; top bar carrying crumbs, a search box that posts to the leads
   list's existing `q`, the running spend, and a light/dark switch. Both switches are forms over
   cookies — the product still ships no client-side JavaScript.
6. **Components.** StatCard, Badge, TierBadge, Meter, Th, TD, Fact, Price, Funnel, FilterOption,
   Panel, InfoBox, Banner and the lead tabs moved onto the new classes, so the change lands on
   every page that uses them.

## Outcome

- Impact: the product now wears the approved design everywhere, in light and dark, with no screen
  rewritten and no functionality touched.
- Pending: per-screen work from the brief (dashboard command centre, leads table density, drawers
  for filters) is not done — those are structural and were left for the operator's next round of
  feedback. Not deployed: running on localhost only, awaiting their look.
