---
id: 0024
title: Leads in three steps, forms in panels
stage: general
date: 2026-09-14
surface: agent
model: claude-opus-5
feature: none
branch: main
user: Aheadtech360Development
command: (wireframe feedback)
labels: ["wireframes", "design", "leads", "forms", "ux"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
 - design/wireframes/build.py (drawer + radio primitives; leads rebuilt as three steps; categories, checklists and call log forms moved into panels)
 - design/wireframes/*.dc.html (27 artboards, 5 new: LeadsFilter, LeadsActions, LeadCallsLog, CategoriesAdd, ChecklistsAdd)
 - design/wireframes/canvas.json, design/wireframes/lead-intel-wireframes.html
tests:
 - Playwright screenshots of every changed artboard; frame heights matched to measured content
 - seed-canvas --check ok (28 files); published as Version 3 of the same canvas
---

## Prompt

acha mene wireframe dekha usme kuch pages mai changes kerni hain woh bata raha hoon, sabse pehle jahan per bhi hum kisi form se koi cheez add ker rahe hain to woh form tab khule jab add kerna ho werna display nhi ho jese checklist or categories wagera mai kia hua hai wese nhi chahye hume, 
doosra ye hai ke leads ka page abhi bhi confusing hai isme step by step kerdo ke jo select kia hai woh display ho, abhi kia hota hai jese kisi bhi filter ya color wagera per click kerte hain to display sab hote hain lekin format change hote rehte hain to mujhe is terhan se nhi chahye jo select karoon wohi display ho, or Leads ke page mai adhi confusion filters ker dete hain or adhi ye uper jo ata hai na Whole-list action wagera ke button woh sab bhi aik tareeke mai dikhao ye dekh ker pata chale ke ho kia raha hai to ye do masle hain baki to kafi sahi hai to isko wireframe mai update karo

## Response snapshot

- Forms: Categories, Checklists and the call log now show only the list plus "+ Add a rule" / "+ Log a call". The form opens in a panel from the right (new artboards show that state); Edit opens the same panel. Written into Shared pieces as a rule.
- Leads: rebuilt as 1 Choose which businesses (one menu per filter, Colour included; choices shown as removable chips with the remaining count), 2 Tick the ones you want (fixed columns, colour key above the table), 3 Do something with them (one button opening a panel: ticked or all shown, one action, price and who bills it). Whole-list actions, ticked actions and "paid data for all" are folded into step 3. The left filter column is gone so the table never changes width.
- Canvas republished to the same link (Version 3).

## Outcome

- Impact: wireframe only; no app code changed.
- Next: operator reviews the canvas; the app itself is rebuilt to match only once the wireframes are agreed.
