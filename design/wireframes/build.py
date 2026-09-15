# -*- coding: utf-8 -*-
"""
Generates the Lead Intel wireframe artboards (.dc.html) and canvas.json.

Low-fidelity on purpose: black, white and grey, one blue for the primary action, and the four row
tints because they are a feature rather than decoration. Structure and content first — the visual
design comes later from these.

Run: python design/wireframes/build.py
"""
import io, json, os

OUT = os.path.dirname(os.path.abspath(__file__))

INK = "#141414"
INK2 = "#3a3a3a"
LINE = "#bdbdbd"
LINE2 = "#dcdcdc"
FILL = "#f2f2f2"
FILL2 = "#fafafa"
BLUE = "#2f5bd3"
RED = "#b3261e"
GREEN = "#1e7a4f"
TINT = {"red": "#fbdfe4", "blue": "#dbe8fb", "peach": "#fdeed7", "green": "#dcf2e4"}
FONT = "'Atkinson Hyperlegible', system-ui, sans-serif"
HAND = "'Patrick Hand', 'Comic Sans MS', cursive"


# ---------------------------------------------------------------- page frame

def page(body, width=1440):
    return (
        '<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n'
        '  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&amp;family=Patrick+Hand&amp;display=swap">\n'
        "  <style>\n"
        "    body { margin: 0; background: #ffffff; }\n"
        "    a { color: " + BLUE + "; } a:hover { color: #1f3f99; }\n"
        "    * { box-sizing: border-box; }\n"
        "  </style>\n</helmet>\n"
        '<div style="width: ' + str(width) + "px; min-height: 100%; background: #ffffff; color: " + INK + "; font-family: " + FONT + '; font-size: 15px; line-height: 1.45;">\n'
        + body
        + "\n</div>\n</x-dc>\n</body>\n</html>\n"
    )


def row(*items, gap=12, align="center", justify="flex-start", wrap=True, style=""):
    return (
        '<div style="display: flex; flex-direction: row; gap: ' + str(gap) + "px; align-items: " + align
        + "; justify-content: " + justify + "; " + ("flex-wrap: wrap; " if wrap else "") + style + '">'
        + "".join(items) + "</div>"
    )


def col(*items, gap=12, style=""):
    return '<div style="display: flex; flex-direction: column; gap: ' + str(gap) + "px; " + style + '">' + "".join(items) + "</div>"


def grid(n, *items, gap=16, style=""):
    return (
        '<div style="display: grid; grid-template-columns: repeat(' + str(n) + ", minmax(0, 1fr)); gap: "
        + str(gap) + "px; " + style + '">' + "".join(items) + "</div>"
    )


def text(t, size=15, weight=400, color=INK, style=""):
    return '<div style="font-size: ' + str(size) + "px; font-weight: " + str(weight) + "; color: " + color + "; " + style + '">' + t + "</div>"


def span(t, size=15, weight=400, color=INK):
    return '<span style="font-size: ' + str(size) + "px; font-weight: " + str(weight) + "; color: " + color + ';">' + t + "</span>"


def label(t):
    return text(t, size=12, weight=700, color=INK2, style="letter-spacing: 0.06em; text-transform: uppercase;")


def hand(t, size=17, color=BLUE, style=""):
    """A handwritten wireframe note inside an artboard — explanation, not UI."""
    return text(t, size=size, color=color, style="font-family: " + HAND + "; line-height: 1.25; " + style)


# ---------------------------------------------------------------- controls

def btn(t, kind="secondary", small=False):
    pad = "7px 12px" if small else "10px 16px"
    fs = "14px" if small else "15px"
    if kind == "primary":
        s = "background: " + BLUE + "; color: #ffffff; border: 1.5px solid " + BLUE + ";"
    elif kind == "danger":
        s = "background: #ffffff; color: " + RED + "; border: 1.5px solid " + RED + ";"
    elif kind == "link":
        return '<span style="color: ' + BLUE + "; font-size: " + fs + '; text-decoration: underline; white-space: nowrap;">' + t + "</span>"
    else:
        s = "background: #ffffff; color: " + INK + "; border: 1.5px solid " + INK + ";"
    return (
        '<div style="display: inline-flex; align-items: center; gap: 8px; padding: ' + pad + "; border-radius: 6px; font-size: "
        + fs + "; font-weight: 700; white-space: nowrap; " + s + '">' + t + "</div>"
    )


def inp(placeholder, width="100%"):
    return (
        '<div style="width: ' + width + "; min-height: 44px; padding: 10px 12px; border: 1.5px solid " + LINE + "; border-radius: 6px; color: #777777; background: #ffffff; font-size: 15px;\">"
        + placeholder + "</div>"
    )


def off_field(lbl, placeholder, why, tip=False):
    """A control that exists but cannot be used yet. Visibly off, and it says why on hover."""
    bubble = ""
    if tip:
        bubble = ('<div style="position: absolute; top: 74px; left: 0; width: 330px; background: ' + INK + '; color: #ffffff; border-radius: 10px; padding: 11px 13px; font-size: 14px; line-height: 1.45; z-index: 5;">'
                  + why + "</div>")
    return (
        '<div style="position: relative; display: flex; flex-direction: column; gap: 6px;">'
        + row(text(lbl, size=14, weight=700, color="#8a8a8a"), badge("off"), gap=8, wrap=False)
        + '<div style="width: 100%; min-height: 44px; padding: 10px 12px; border: 1.5px dashed ' + LINE + '; border-radius: 6px; color: #9a9a9a; background: ' + FILL + '; font-size: 15px;">' + placeholder + "</div>"
        + text("Hover to see why", size=12, color="#8a8a8a") + bubble + "</div>"
    )


STAGES = [
    ("1", "Sourcing", "Getting businesses in", "Google Maps search, a CSV file, or by hand", "Search can cost — the price is shown first"),
    ("2", "Filtering", "Narrowing to who you want", "Your ICPs, then the filters on the leads list", "Free"),
    ("3", "Analysis", "Judging what is wrong", "Their website against your checklists, reviews, Instagram", "Free, except the page-by-page read"),
    ("4", "Enrichment", "Buying what is missing", "Google listing, Instagram, phone — only for rows you tick", "Costs money, always confirmed first"),
]


def stages(active=None):
    out = []
    for n, name, what, how, cost in STAGES:
        on = name == active
        out.append(
            '<div style="border: ' + ("2px solid " + INK if on else "1.5px solid " + LINE) + '; border-radius: 10px; padding: 14px 16px; background: ' + (FILL2 if on else "#ffffff") + ';">'
            + row(badge(n, True), text(name, size=17, weight=700), gap=10, wrap=False)
            + '<div style="height: 6px;"></div>' + text(what, size=14, weight=700)
            + text(how, size=13, color=INK2) + '<div style="height: 6px;"></div>' + text(cost, size=13, color=INK2) + "</div>"
        )
    return grid(4, *out, gap=14)


def field(lbl, placeholder, hint=""):
    return col(
        text(lbl, size=14, weight=700),
        inp(placeholder),
        (text(hint, size=13, color=INK2) if hint else ""),
        gap=6,
    )


def select(lbl, value):
    return col(
        text(lbl, size=14, weight=700),
        '<div style="display: flex; justify-content: space-between; padding: 10px 12px; border: 1.5px solid ' + LINE + '; border-radius: 6px; font-size: 15px;">'
        + span(value) + span("▾", color=INK2) + "</div>",
        gap=6,
    )


def box(checked=False):
    return (
        '<div style="width: 18px; height: 18px; border: 1.5px solid ' + INK + "; border-radius: 3px; flex: 0 0 18px; background: "
        + (INK if checked else "#ffffff") + ';"></div>'
    )


def radio(t, on=False, sub=""):
    dot = '<div style="width: 18px; height: 18px; border-radius: 99px; border: 1.5px solid ' + INK + '; flex: 0 0 18px; background: ' + ('radial-gradient(' + INK + ' 45%, #ffffff 50%)' if on else '#ffffff') + ';"></div>'
    return row(dot, col(text(t, size=15, weight=700 if on else 400), text(sub, size=13, color=INK2) if sub else "", gap=2), gap=10, align="flex-start", wrap=False)


def check(t, checked=False, sub=""):
    return row(box(checked), col(text(t, size=15, weight=700 if checked else 400), text(sub, size=13, color=INK2) if sub else "", gap=2), gap=10, align="flex-start", wrap=False)


def chip(t, fill="#ffffff", active=False):
    border = INK if active else LINE
    return (
        '<div style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; border: 1.5px solid '
        + border + "; background: " + fill + "; font-size: 14px; font-weight: " + ("700" if active else "400") + '; white-space: nowrap;">' + t + "</div>"
    )


def swatch(color, size=14):
    return '<div style="width: ' + str(size) + "px; height: " + str(size) + "px; border-radius: 3px; background: " + color + "; border: 1px solid " + LINE + '; flex: 0 0 auto;"></div>'


def icon():
    return '<div style="width: 18px; height: 18px; border: 1.5px solid ' + INK2 + '; border-radius: 4px; flex: 0 0 18px;"></div>'


def ph(t, h=120, style=""):
    return (
        '<div style="height: ' + str(h) + "px; background: " + FILL + "; border: 1.5px dashed " + LINE + "; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: " + INK2 + "; font-size: 14px; text-align: center; padding: 12px; " + style + '">'
        + t + "</div>"
    )


def bar(pct, color=INK, h=8):
    return (
        '<div style="height: ' + str(h) + "px; background: " + LINE2 + '; border-radius: 99px; overflow: hidden;"><div style="width: ' + str(pct) + "%; height: 100%; background: " + color + ';"></div></div>'
    )


def badge(t, filled=False):
    return (
        '<div style="display: inline-flex; align-items: center; justify-content: center; min-width: 26px; padding: 2px 8px; border-radius: 5px; font-weight: 700; font-size: 14px; '
        + ("background: " + INK + "; color: #ffffff;" if filled else "border: 1.5px solid " + INK + ";") + '">' + t + "</div>"
    )


def card(title, inner, sub="", right="", pad=20):
    head = row(col(text(title, size=18, weight=700), text(sub, size=14, color=INK2) if sub else "", gap=3), right, justify="space-between", align="flex-start", wrap=False)
    return (
        '<div style="border: 1.5px solid ' + LINE + '; border-radius: 10px; background: #ffffff;">'
        '<div style="padding: ' + str(pad) + "px " + str(pad) + "px 14px; border-bottom: 1.5px solid " + LINE2 + ';">' + head + "</div>"
        '<div style="padding: ' + str(pad) + 'px;">' + inner + "</div></div>"
    )


def stat(value, lbl, sub=""):
    return col(text(value, size=30, weight=700), text(lbl, size=14, weight=700), text(sub, size=13, color=INK2) if sub else "", gap=2,
               style="border: 1.5px solid " + LINE + "; border-radius: 10px; padding: 16px;")


def price(amount, what, who):
    return col(text(amount, size=16, weight=700), text("for " + what, size=13, color=INK2), text("billed by " + who, size=13, color=INK2), gap=1)


def table(cols, rows, tints=None):
    template = " ".join(w for _, w in cols)
    head = "".join('<div style="padding: 10px 12px; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: ' + INK2 + ';">' + c + "</div>" for c, _ in cols)
    out = '<div style="border: 1.5px solid ' + LINE + '; border-radius: 10px; overflow: hidden;">'
    out += '<div style="display: grid; grid-template-columns: ' + template + "; background: " + FILL + "; border-bottom: 1.5px solid " + LINE + ';">' + head + "</div>"
    for i, r in enumerate(rows):
        bg = (tints[i] if tints and tints[i] else "#ffffff")
        cells = "".join('<div style="padding: 12px; font-size: 14px;">' + c + "</div>" for c in r)
        out += '<div style="display: grid; grid-template-columns: ' + template + "; border-bottom: 1px solid " + LINE2 + "; background: " + bg + '; align-items: start;">' + cells + "</div>"
    return out + "</div>"


# ---------------------------------------------------------------- the frame every signed-in screen sits in

NAV = [
    ("Overview", ["Dashboard", "Leads", "My leads", "Instagram"]),
    ("Add businesses", ["Find businesses", "Imported files"]),
    ("Set up", ["ICPs", "Checklists", "How it works", "Data & spend"]),
]


def rail(active, collapsed=False):
    if collapsed:
        items = "".join(
            '<div style="width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; '
            + ("background: " + FILL + "; border: 1.5px solid " + INK + ";" if n == active else "") + '">' + icon() + "</div>"
            for _, g in NAV for n in g
        )
        return (
            '<div style="width: 64px; flex: 0 0 64px; border-right: 1.5px solid ' + LINE + '; padding: 16px 12px; display: flex; flex-direction: column; gap: 6px; align-items: center; min-height: 100%;">'
            + '<div style="width: 32px; height: 32px; border: 2px solid ' + INK + '; border-radius: 8px; margin-bottom: 4px;"></div>'
            + btn("»", small=True) + '<div style="height: 10px;"></div>' + items + "</div>"
        )
    groups = ""
    for g, names in NAV:
        groups += label(g).replace("<div", '<div', 1)
        for n in names:
            on = n == active
            groups += (
                '<div style="display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; font-size: 15px; '
                + ("background: " + FILL + "; font-weight: 700; border: 1.5px solid " + INK + ";" if on else "border: 1.5px solid transparent;")
                + '">' + icon() + span(n.replace("&", "&amp;"), weight=700 if on else 400) + "</div>"
            )
        groups += '<div style="height: 12px;"></div>'
    return (
        '<div style="width: 240px; flex: 0 0 240px; border-right: 1.5px solid ' + LINE + '; padding: 18px 14px; display: flex; flex-direction: column; gap: 4px; min-height: 100%;">'
        + row(row('<div style="width: 26px; height: 26px; border: 2px solid ' + INK + '; border-radius: 7px;"></div>', text("Lead Intel", size=18, weight=700), gap=10, wrap=False), btn("«", small=True), justify="space-between", wrap=False)
        + '<div style="height: 18px;"></div>' + groups
        + '<div style="margin-top: auto; padding-top: 24px;">' + text("you@aheadtech360.com", size=13, color=INK2) + '<div style="height: 8px;"></div>' + btn("Sign out", small=True) + "</div></div>"
    )


def taskbar(label_text="Reading 12 ticked websites page by page", done=5, total=12, cost="1.8¢ so far", elapsed="3m 10s"):
    pct = int(done / total * 100) if total else 100
    return (
        '<div style="border: 1.5px solid ' + INK + '; border-radius: 10px; padding: 14px 16px; background: ' + FILL2 + ';">'
        + row(
            row('<div style="width: 14px; height: 14px; border-radius: 99px; border: 2.5px solid ' + BLUE + '; border-top-color: transparent;"></div>',
                text("1 task running", size=15, weight=700), gap=10, wrap=False),
            row(text("Updates once a minute", size=13, color=INK2), btn("Refresh now", "link", small=True), gap=10),
            justify="space-between",
        )
        + '<div style="height: 10px;"></div>'
        + row(text(label_text, size=15, weight=700), text(str(done) + " of " + str(total) + " done", size=14, color=INK2),
              '<div style="margin-left: auto; display: flex; gap: 14px; align-items: center;">' + text(cost, size=14, weight=700) + text(elapsed, size=14, color=INK2) + btn("Stop", "danger", small=True) + "</div>", gap=14)
        + '<div style="height: 8px;"></div>' + bar(pct, BLUE, 9)
        + '<div style="height: 6px;"></div>' + text("Now: a4graphic.com, page 3 of 5", size=13, color=INK2)
        + "</div>"
    )


def shell(active, title, sub, actions, body, task=False, back=None, collapsed=False, overlay="", min_h=0):
    top = (
        '<div style="display: flex; align-items: center; gap: 14px; padding: 16px 32px; border-bottom: 1.5px solid ' + LINE + ';">'
        + (col(btn("← " + back, "link", small=True), text(title, size=24, weight=700), gap=4) if back else text(title, size=24, weight=700))
        + '<div style="margin-left: auto; display: flex; gap: 10px; flex-wrap: wrap;">' + actions + "</div></div>"
    )
    main = (
        '<div style="flex: 1; min-width: 0;">' + top
        + '<div style="padding: 24px 32px 48px; display: flex; flex-direction: column; gap: 20px;">'
        + (text(sub, size=15, color=INK2, style="max-width: 820px;") if sub else "")
        + (taskbar() if task else "")
        + body + "</div></div>"
    )
    return page('<div style="position: relative; display: flex; min-height: ' + (str(min_h) + "px" if min_h else "100%") + ';">' + rail(active, collapsed) + main + overlay + "</div>")


def drawer(title, sub, inner, footer, width=640):
    """A panel over the right of the screen. Every add / edit form lives in one, closed until asked for."""
    return (
        '<div style="position: absolute; inset: 0; background: rgba(20, 20, 20, 0.42);"></div>'
        '<div style="position: absolute; top: 0; right: 0; bottom: 0; width: ' + str(width) + 'px; background: #ffffff; border-left: 2px solid ' + INK + ';">'
        '<div style="padding: 22px 28px 16px; border-bottom: 1.5px solid ' + LINE + ';">'
        + row(col(text(title, size=22, weight=700), text(sub, size=14, color=INK2) if sub else "", gap=4), btn("✕ Close", small=True), justify="space-between", align="flex-start", wrap=False)
        + '</div><div style="padding: 22px 28px; display: flex; flex-direction: column; gap: 18px;">' + inner + "</div>"
        '<div style="padding: 16px 28px; border-top: 1.5px solid ' + LINE + '; background: ' + FILL2 + ';">' + footer + "</div></div>"
    )


def save(name, html):
    io.open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n").write(html)


# ================================================================= PAGE 1 — DAILY WORK

def leads(state="base"):
    def step(n, title, sub, right=""):
        return row(badge(n, True), col(text(title, size=18, weight=700), text(sub, size=14, color=INK2), gap=2),
                   ('<div style="margin-left: auto;">' + right + "</div>" if right else ""), gap=12, wrap=False)

    def dd(name, value="", open_=False):
        on = bool(value)
        return (
            '<div style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; font-size: 14px; white-space: nowrap; '
            + ("border: 2px solid " + INK + "; background: " + FILL + "; font-weight: 700;" if on or open_ else "border: 1.5px solid " + LINE + ";")
            + '">' + name + (": " + value if value else "") + span("▴" if open_ else "▾", color=INK2) + "</div>"
        )

    def off_dd(name):
        return ('<div style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; font-size: 14px; white-space: nowrap; '
                'border: 1.5px dashed ' + LINE + "; background: " + FILL + "; color: #8a8a8a;" + '">' + name + span(" off", size=12, weight=700, color="#8a8a8a") + "</div>")

    def picked(t):
        return chip(t + span(" ✕", weight=700), fill=FILL, active=True)

    # STEP 1 — which businesses
    bar_row = row(
        inp("Search by name or town", "260px"),
        dd("ICP", "D2C fashion brands"), dd("Show", "Worth calling"), dd("Priority", "1", open_=(state == "filter")), dd("What to sell"),
        dd("Website"), dd("Colour", "No website"), dd("Reviews"), dd("Where"), dd("Claimed"), dd("Where from"), dd("Instagram & ads"),
        off_dd("Budget"), off_dd("Revenue"),
        gap=8)
    menu = ""
    if state == "filter":
        menu = (
            '<div style="position: absolute; top: 58px; left: 530px; width: 360px; background: #ffffff; border: 2px solid ' + INK + '; border-radius: 10px; padding: 16px; box-shadow: 0 14px 30px -10px rgba(0,0,0,0.35);">'
            + col(label("Priority — pick one or more"),
                  check("1 · Lots wrong and already spends money", True, "29 businesses"),
                  check("2 · Spends money, little wrong", False, "31 businesses"),
                  check("3 · Lots wrong, no sign of spending", False, "94 businesses"),
                  check("4 · Lowest priority", False, "22 businesses"),
                  row(btn("Show these", "primary", small=True), btn("Clear priority", "link", small=True), gap=12), gap=10)
            + "</div>"
        )
    showing = row(
        text("Showing only:", size=14, weight=700),
        picked("ICP: D2C fashion brands"), picked("Worth calling"), picked("Priority 1"), picked(swatch(TINT["blue"]) + " No website"),
        btn("Clear all", "link", small=True),
        '<div style="margin-left: auto;">' + text("29 of 422 businesses", size=16, weight=700) + "</div>",
        gap=8)
    step1 = (
        '<div style="border: 1.5px solid ' + LINE + '; border-radius: 10px; padding: 18px; display: flex; flex-direction: column; gap: 14px;">'
        + step("1", "Choose which businesses", "Pick from the menus. Every choice appears as a chip below, so you always see what is on.")
        + '<div style="position: relative;">' + bar_row + menu + "</div>"
        + '<div style="border-top: 1.5px solid ' + LINE2 + '; padding-top: 12px;">' + showing + "</div>"
        + row(hand("Only what you chose is shown. The table, its columns and the buttons never move — only the rows change.", size=16),
              '<div style="margin-left: auto; width: 360px; background: ' + INK + '; color: #ffffff; border-radius: 10px; padding: 11px 13px; font-size: 14px; line-height: 1.45;">Budget and revenue are switched off. Nobody publishes what a small business earns, so there is nothing to filter on yet — see Data &amp; spend.</div>',
              gap=16, align="flex-start", wrap=False)
        + "</div>"
    )

    # STEP 2 — tick
    legend = row(text("Row colour:", size=13, weight=700),
                 *[row(swatch(TINT[c]), text(t, size=13), gap=5, wrap=False) for c, t in [("red", "reviews only"), ("blue", "no website"), ("peach", "no Instagram"), ("green", "has both")]],
                 gap=12)

    def biz(name, where):
        return col(span("<u>" + name + "</u>", weight=700, color=BLUE), text(where, size=13, color=INK2), gap=2)

    def scores(p, sg):
        return col(row(text("Problem", size=12), text(str(p), size=12, weight=700), justify="space-between"), bar(p, INK, 6),
                   row(text("Signals", size=12), text(str(sg), size=12, weight=700), justify="space-between"), bar(sg, "#777777", 6), gap=3)

    cols = [("", "44px"), ("Priority", "80px"), ("Business", "2.2fr"), ("What to sell", "2fr"), ("Scores", "150px"), ("ICP", "1.1fr"), ("Instagram", "1.1fr"), ("Contact", "1fr"), ("", "100px")]
    rows = [
        [box(True), badge("1", True), biz("A4 Graphic", "Miami, FL · by search"), text("Build them a website", weight=700) + text("No website, 4.9★ from 109 reviews", size=13, color=INK2), scores(90, 40), "D2C fashion brands", "@a4_graphic_miami", "phone", btn("Claim", small=True)],
        [box(True), badge("1", True), biz("Vachale Beauty Concepts", "Dallas, TX · by search"), text("Build them a website", weight=700) + text("Proven demand, no site of their own", size=13, color=INK2), scores(90, 38), "In no ICP", "@vachalebeautyconcepts", "email + phone", btn("Claim", small=True)],
        [box(False), badge("1", True), biz("Fresh Press USA", "Dallas, TX · from a file"), text("Build them a website", weight=700) + text("Link in bio points to a dead site", size=13, color=INK2), scores(84, 36), "D2C fashion brands", "@freshpressusa", "email", btn("Claim", small=True)],
        [box(True), badge("1", True), biz("Inked Pro", "Austin, TX · by search"), text("Build them a website", weight=700) + text("Instagram only, 3,100 followers", size=13, color=INK2), scores(80, 52), "D2C fashion brands", "@inkedpro", "phone", text("Mine", size=14, weight=700)],
    ]
    step2 = col(
        step("2", "Tick the ones you want", "Or tick none — the next step can use every business shown."),
        row(text("3 ticked", size=15, weight=700), btn("Tick all 29 shown", "link", small=True), btn("Untick all", "link", small=True),
            '<div style="margin-left: auto;">' + legend + "</div>", gap=14),
        table(cols, rows, [TINT["blue"]] * 4),
        text("Showing 4 of 29 · <u>Next page</u>", size=14, color=INK2),
        text("<b>Problem</b> is how much is wrong with their online presence, out of 100. <b>Signals</b> is how much evidence there is that they already pay for things.", size=13, color=INK2),
        gap=12, style="border: 1.5px solid " + LINE + "; border-radius: 10px; padding: 18px;")

    # STEP 3 — act
    step3 = (
        '<div style="border: 2px solid ' + INK + '; border-radius: 10px; padding: 16px 18px; background: ' + FILL2 + ';">'
        + step("3", "Do something with them", "Analyse, read pages, re-score, buy data, claim or download — all in one place, with the price before anything starts.",
               row(text("3 ticked", size=15, weight=700), btn("Choose what to do →", "primary"), gap=14, wrap=False))
        + "</div>"
        + hand("Pinned to the bottom of the screen while you scroll. With nothing ticked it reads “all 29 shown”.", size=16)
    )

    overlay = ""
    if state == "actions":
        def action(title, what, cost, who, on=False):
            return (
                '<div style="border: ' + ("2px solid " + INK if on else "1.5px solid " + LINE) + '; border-radius: 10px; padding: 14px 16px;">'
                + row(row('<div style="width: 18px; height: 18px; border-radius: 99px; border: 1.5px solid ' + INK + "; flex: 0 0 18px; background: " + ("radial-gradient(" + INK + " 45%, #ffffff 50%)" if on else "#ffffff") + ';"></div>',
                          col(text(title, size=16, weight=700), text(what, size=13, color=INK2), gap=2), gap=12, align="flex-start", wrap=False),
                      col(text(cost, size=14, weight=700, style="text-align: right;"), text(who, size=12, color=INK2, style="text-align: right;"), gap=1),
                      justify="space-between", align="flex-start", wrap=False)
                + "</div>"
            )
        inner = (
            col(label("Which businesses?"), radio("The 3 you ticked", True, "A4 Graphic, Vachale Beauty Concepts, Inked Pro"), radio("All 29 shown by your choices", False), gap=10)
            + col(label("What should happen?"),
                  action("Full analysis", "Read their site, run the 51 checks, read pages in a browser, re-score", "about 0.36¢ a site", "Google AI Studio (Gemini)", on=True),
                  action("Read websites page by page", "A browser reads each page and writes what to fix", "0.36¢ a site", "Google AI Studio (Gemini)"),
                  action("Re-score", "Work the scores out again from what is stored", "Free", "our own code"),
                  action("Get paid data", "Google listing, Instagram, ads — priced on the next screen", "priced next", "before anything is spent"),
                  action("Claim them", "Mark them as yours so nobody else calls", "Free", "—"),
                  action("Download as a spreadsheet", "CSV with every column", "Free", "—"),
                  gap=10)
        )
        footer = row(col(text("About 1.1¢ for 3 businesses", size=16, weight=700), text("billed by Google AI Studio (Gemini)", size=13, color=INK2), gap=1),
                     row(btn("Cancel"), btn("Start full analysis", "primary"), gap=10), justify="space-between")
        overlay = drawer("Do something with them", "Nothing starts until you press the button at the bottom.", inner, footer)

    body = step1 + step2 + step3
    return shell("Leads", "Leads",
                 "Your call list, best call first. Three steps: choose businesses, tick them, then act.",
                 btn("Add businesses ▾", "primary"),
                 body, task=True, collapsed=True, overlay=overlay, min_h=1460)


def leads_filter():
    return leads("filter")


def leads_actions():
    return leads("actions")


def lead_header(active_tab):
    tabs = ["Overview", "Website pages", "Checks & scores", "Calls & history"]
    tabbar = row(*[
        '<div style="padding: 12px 4px; font-size: 16px; ' + ("font-weight: 700; border-bottom: 3px solid " + INK + ";" if t == active_tab else "color: " + INK2 + "; border-bottom: 3px solid transparent;") + '">' + t + "</div>"
        for t in tabs
    ], gap=28, style="border-bottom: 1.5px solid " + LINE + ";")

    facts = grid(5,
                 col(label("Phone"), text("(786) 397-8359", size=18, weight=700, color=BLUE), text("from Google", size=13, color=INK2), gap=3),
                 col(label("Google rating"), text("★★★★★ 4.9", size=18, weight=700), text("109 reviews", size=13, color=INK2), gap=3),
                 col(label("Website"), text("a4graphic.com ↗", size=18, weight=700, color=BLUE), text("Couldn't check", size=13, color=INK2), gap=3),
                 col(label("Instagram"), text("@a4_graphic_miami", size=18, weight=700, color=BLUE), text("found on their site", size=13, color=INK2), gap=3),
                 col(label("Where from"), text("Found by search", size=18, weight=700), text("Google Maps", size=13, color=INK2), gap=3),
                 gap=20)

    actions = col(
        row(btn("Full analysis of this business", "primary"), btn("Claim this lead"), gap=10, justify="flex-end"),
        row(btn("Re-read & re-score", small=True), btn("Read page by page", small=True), btn("Analyse their Instagram", small=True), gap=8, justify="flex-end"),
        text("Free, except Instagram (0.26¢, Apify) and the page read (0.36¢, Gemini)", size=13, color=INK2, style="text-align: right;"),
        gap=8,
    )

    head = (
        '<div style="border: 1.5px solid ' + LINE + '; border-radius: 10px; padding: 22px;">'
        + row(col(row(badge("1", True), text("A4 Graphic", size=28, weight=700), gap=12), text("Miami, FL · Printing", size=15, color=INK2), gap=4), actions, justify="space-between", align="flex-start")
        + '<div style="height: 18px;"></div>' + facts
        + '<div style="height: 16px;"></div>'
        + '<div style="border: 1.5px solid ' + INK + '; border-radius: 8px; padding: 12px 14px; font-size: 14px;"><b>Check this one by hand before calling.</b> Google has no website for them, and they have 4.9 stars from 109 reviews — either there is genuinely no site, or their listing is missing it.</div>'
        + "</div>"
    )
    return head + tabbar


def lead_overview():
    why = card("Why this lead",
               col(label("Sell them"), text("Build them a website", size=22, weight=700),
                   text("Google has no website for them, and they have 4.9 stars from 109 reviews.", size=14, color=INK2),
                   col(row(text("Problem — how much is wrong", size=14, weight=700), text("90 / 100", size=14, weight=700), justify="space-between"), bar(90), text("Above 55, so there is enough wrong to be worth a call", size=13, color=INK2), gap=5),
                   col(row(text("Signals — do they spend money?", size=14, weight=700), text("0 / 100", size=14, weight=700), justify="space-between"), bar(0), text("Below 35, no sign they pay for anything yet", size=13, color=INK2), gap=5),
                   row(badge("1", True), text("Priority 1 — proven demand and no website", size=15, weight=700), gap=10),
                   gap=14))

    say = card("What to say when they answer",
               col(text("Built from one specific thing we found. If nothing solid was found, no line is suggested.", size=13, color=INK2),
                   '<div style="border-left: 3px solid ' + INK + '; padding: 8px 14px; font-size: 16px;">&ldquo;Hi, I was looking for a print shop in Miami — you have 109 five-star reviews on Google, but I couldn&rsquo;t find your website anywhere…&rdquo;</div>',
                   row(btn("Call opener", small=True), btn("Message opener", small=True), btn("Copy", "link", small=True), gap=8), gap=12))

    def group(title, items, note):
        return col(row(label(title), text(note, size=13, color=INK2), gap=10), grid(4, *[col(label(k), text(v, size=16, weight=700), text(s, size=13, color=INK2), gap=2) for k, v, s in items], gap=18), gap=12,
                   style="padding-bottom: 18px; border-bottom: 1.5px solid " + LINE2 + ";")

    know = card("Everything we know about them",
                col(
                    group("From their Google listing", [("Rating", "★★★★★ 4.9", "Google Places"), ("Reviews", "109", "Google Places"), ("Still trading?", "Yes", "Google Places"), ("Listing bought?", "Not yet", "would cost 3.5¢, Google")], "reliable"),
                    group("From their own website", [("Pages the crawler read", "0", "server said 403"), ("Pages a browser read", "5", "page-by-page read"), ("Speed on a phone", "48 / 100", "content in 18.5s"), ("Email on their site", "None found", "their own pages")], "free, our own reading"),
                    group("Away from their site", [("Followers", "Not bought", "would cost 0.26¢, Apify"), ("Facebook", "Their page ↗", "linked from their site"), ("Running ads?", "Never checked", "would cost 11.6¢, Apify"), ("YouTube", "Miami Print & Advertise", "last video Aug 2020")], "found or bought"),
                    text("Anything unknown says so — “Not bought”, “None found”, “Never checked” — never a blank.", size=13, color=INK2),
                    gap=18),
                sub="Grouped by where each fact came from, because they are not equally reliable.")

    social = card("Their Instagram",
                  col(text("Found on their website. Paste a different one if this is wrong.", size=14, color=INK2),
                      row(inp("instagram.com/a4_graphic_miami", "420px"), btn("Save"), gap=10), gap=10))

    return shell("Leads", "", "", "", lead_header("Overview") + row(col(why, say, gap=20, style="flex: 1; min-width: 0;"), col(know, social, gap=20, style="flex: 1.4; min-width: 0;"), gap=20, align="flex-start", wrap=False), back="Back to leads")


def lead_website():
    def scorecard(kind, path, score, fails, has_shot, read):
        left = col(
            row(text(kind, size=18, weight=700), btn(path + " ↗", "link", small=True), '<div style="margin-left: auto;">' + text(str(score) + " / 100", size=20, weight=700) + "</div>", gap=12),
            text(str(len(fails)) + " to fix · 6 fine · 2 not checkable", size=13, color=INK2),
            col(*[row(text("✕", weight=700), text(f, size=14), gap=10, align="flex-start", wrap=False) for f in fails], gap=6),
            '<div style="border: 1.5px solid ' + LINE + '; border-radius: 8px; padding: 12px 14px; background: ' + FILL2 + ';">'
            + label("What the model makes of it") + '<div style="height: 6px;"></div>' + text(read, size=14) + '<div style="height: 6px;"></div>'
            + text("<b>Open with:</b> “I noticed your contact page has several forms…”", size=14) + "</div>",
            gap=10, style="flex: 1; min-width: 0;")
        shot = (ph("Screenshot of the page<br>(home and product pages only)<br>click to open full size", 300, "width: 360px; flex: 0 0 360px;") if has_shot
                else '<div style="width: 360px; flex: 0 0 360px;">' + text("No screenshot — only the home and product pages keep one", size=13, color=INK2) + "</div>")
        return '<div style="border: 1.5px solid ' + LINE + '; border-radius: 10px; padding: 18px;">' + row(left, shot, gap=24, align="flex-start", wrap=False) + "</div>"

    body = lead_header("Website pages") + card(
        "Their website, page by page",
        col(
            row(text("5 pages read in a real browser · 2 screenshots kept · read 14 Sep", size=14, color=INK2), btn("Read it again", small=True), justify="space-between"),
            scorecard("Home", "/", 62, ["No tap-to-call number in the header", "No reviews anywhere on the home page"], True, "The page is trying to get people to order transfers, and that is clear from the headings — but the buttons ask for nothing specific."),
            scorecard("Products", "/collections", 71, ["Nothing on the product page vouches for the quality"], True, "It is clear what is for sale, but not why someone should choose them over a competitor."),
            scorecard("Contact", "/contact-us", 55, ["The enquiry form asks for too much"], False, "Four separate forms — a visitor will not know which one to use."),
            gap=16),
        sub="Judged against your checklists. Change a checklist and these verdicts update straight away.",
    )
    return shell("Leads", "", "", "", body, back="Back to leads")


def lead_checks():
    areas = [("Website quality", 88), ("Being found on Google", 72), ("Reviews & reputation", 20), ("Turning visitors into customers", 64), ("Social media", 55), ("Ads & tracking", 90)]
    area = card("Score by area", col(*[col(row(text(n, size=14, weight=700), text(str(v) + " / 100", size=14, weight=700), justify="space-between"), bar(v), gap=4) for n, v in areas], gap=14),
                sub="Higher means more is wrong. The worst area decides what to sell them.")
    problems = card("The biggest problems",
                    table([("Check", "90px"), ("What we found", "3fr"), ("Evidence", "2fr"), ("Points", "80px")],
                          [["W1", "No working website", "Google listing has no site", "30"], ["S4", "Not found for their own trade in their town", "not in the top 20", "18"], ["D2", "No tracking of any kind", "no analytics tag", "12"], ["K3", "No tap-to-call number", "phone not linked", "8"]]),
                    sub="Ordered by how much each one matters.")
    busy = card("How busy is their website?", grid(3, stat("48", "Speed on a phone", "out of 100"), stat("18.5s", "Until the main content shows"), stat("—", "Monthly visits", "not bought · 0.12¢, DataForSEO"), gap=14))
    every = card("Every single check",
                 col(row(chip("12 wrong", active=True), chip("31 fine"), chip("8 we couldn't measure"), gap=8),
                     table([("Check", "90px"), ("Result", "120px"), ("What it means", "3fr"), ("Where it came from", "2fr")],
                           [["W5", "Wrong", "No mobile layout", "their own website"], ["R1", "Fine", "Enough reviews to be chosen", "Google listing"], ["O3", "Not measured", "Facebook activity — Meta does not publish it", "—"]]),
                     gap=12),
                 sub="Collapsed by default. “Not measured” is never counted as good or bad.", right=btn("Show all 51", small=True))
    sources = card("Where every value came from", ph("List of every stored value with its source and when it was last checked", 90), right=btn("Show", small=True))
    return shell("Leads", "", "", "", lead_header("Checks & scores") + row(col(area, busy, gap=20, style="flex: 1; min-width: 0;"), col(problems, every, sources, gap=20, style="flex: 1.6; min-width: 0;"), gap=20, align="flex-start", wrap=False), back="Back to leads")


def lead_calls(logging=False):
    prev = card("Calls", table([("When", "140px"), ("How", "110px"), ("What happened", "1.5fr"), ("Notes", "2fr")],
                               [["12 Sep, 11:20", "Phone", "No answer", "—"], ["10 Sep, 16:05", "Phone", "Asked to call back", "Owner is Dani, back Friday"]]),
                sub="Logging each call teaches the system which findings actually get replies.", right=btn("+ Log a call", "primary", small=True))
    hist = card("What has been run on this business",
                col(*[col(row(text(t, size=15, weight=700), text(st, size=14, color=INK2), '<div style="margin-left: auto;">' + text(tm, size=13, color=INK2) + "</div>", gap=12), bar(p, c, 7), text(d, size=13, color=INK2), gap=5)
                      for t, st, tm, p, c, d in [
                          ("Full analysis of A4 Graphic", "done", "2m 40s", 100, GREEN, "Read 5 pages, kept 2 screenshots, found their Instagram and Facebook. Re-scored: Priority 1."),
                          ("Buying their Instagram", "failed", "4s", 100, RED, "Stopped by you. Nothing was bought."),
                      ]], gap=16),
                sub="Closed unless something is running. Newest first.", right=btn("Hide", small=True))
    overlay = ""
    if logging:
        overlay = drawer("Log a call", "A4 Graphic · (305) 555-0142",
                         grid(2, select("How did you reach them?", "Phone call"), select("What happened?", "Interested — call back"), gap=16)
                         + select("If they objected, why?", "Already has someone")
                         + field("Notes", "What they said, who you spoke to, when to call back"),
                         row(btn("Cancel"), btn("Save this call", "primary"), gap=10, justify="flex-end"), width=560)
    return shell("Leads", "", "", "", lead_header("Calls & history") + row(col(prev, gap=20, style="flex: 1; min-width: 0;"), col(hist, gap=20, style="flex: 1; min-width: 0;"), gap=20, align="flex-start", wrap=False), back="Back to leads", overlay=overlay, min_h=920)


def lead_calls_logging():
    return lead_calls(True)


def buy():
    def source(title, what, each, count, total, who, ticked, notes, warn="", disabled=False):
        return (
            '<div style="border: 1.5px solid ' + (INK if ticked else LINE) + '; border-radius: 10px; padding: 18px; ' + ("background: " + FILL + "; color: #777777;" if disabled else "") + '">'
            + row(row(box(ticked), col(text(title, size=18, weight=700), text(what, size=14, color=INK2), gap=3), gap=14, align="flex-start", wrap=False),
                  col(text(total, size=22, weight=700, style="text-align: right;"), text(each + " × " + count, size=13, color=INK2, style="text-align: right;"), text("billed by " + who, size=13, color=INK2, style="text-align: right;"), gap=1),
                  justify="space-between", align="flex-start", wrap=False)
            + '<div style="height: 10px;"></div>' + row(*[text(n, size=14, weight=700) for n in notes], gap=20)
            + ('<div style="height: 10px;"></div><div style="border: 1.5px solid ' + INK + '; border-radius: 8px; padding: 10px 12px; font-size: 14px;"><b>Read this first:</b> ' + warn + "</div>" if warn else "")
            + "</div>"
        )
    body = col(
        text("3 businesses selected", size=20, weight=700),
        text("Nothing here buys anything until you press the button at the bottom. Anything already bought costs nothing again.", size=15, color=INK2),
        source("Google listing details", "Star rating, number of reviews, opening hours, the category Google uses.", "3.5¢", "2", "7¢", "Google Places API", True, ["✓ 1 already bought — free", "0 have nothing to look up"]),
        source("Their Instagram: followers and category", "Followers, posts, Instagram's category, their bio and link.", "0.26¢", "2", "1¢", "Apify", True, ["1 has no Instagram account on record — skipped"], "Instagram publishes a follower count, never a list of who follows."),
        source("Are they running Facebook or Instagram ads?", "Whether ads are live, how many, since when, what they say.", "11.6¢", "3", "35¢", "Apify", False, ["Hand-picked only — at most 10 at once"], "Meta does not publish how much an ordinary business spends on ads."),
        source("Owner's mobile number", "A direct mobile for the owner.", "73¢", "3", "$2.19", "Lusha", False, ["Not connected — needs a Lusha key"], "Calling a personal mobile is not covered by the business exemption in US law.", disabled=True),
        '<div style="border: 2px solid ' + INK + '; border-radius: 10px; padding: 20px;">'
        + row(col(text("Total", size=15, weight=700), text("8¢", size=34, weight=700), gap=0),
              col(text("Never spend more than", size=14, weight=700), inp("$5.00", "160px"), text("The run stops at this and keeps what it already bought", size=13, color=INK2), gap=6),
              row(btn("Cancel"), btn("Buy for 8¢", "primary"), gap=10), justify="space-between", align="flex-end")
        + "</div>",
        gap=16, style="max-width: 960px;")
    return shell("Leads", "", "", "", text("Buy extra data", size=26, weight=700) + body, back="Back to leads")


def dashboard():
    funnel = card("Your pipeline",
                  grid(5, *[col(text(v, size=30, weight=700), text(l, size=14, weight=700), text(s, size=13, color=INK2), bar(p, INK, 6), gap=4)
                            for v, l, s, p in [("422", "Businesses", "found or imported", 100), ("422", "Analysed", "websites read and checked", 100), ("176", "Worth calling", "passed the free checks", 42), ("29", "Priority 1", "call these first", 7), ("2", "Calls logged", "outcomes recorded", 1)]], gap=18),
                  sub="Each step is a subset of the one before it — read across to see where leads drop off.")
    nxt = card("What to do next",
               grid(3,
                    col(text("Call your 29 Priority 1 leads", size=16, weight=700), text("Proven demand and something to sell them.", size=14, color=INK2), btn("Open Priority 1", "primary", small=True), gap=10),
                    col(text("98 Instagram accounts not looked up", size=16, weight=700), text("Followers can lift a no-website business to Priority 1.", size=14, color=INK2), btn("Price them", small=True), gap=10),
                    col(text("Log your first calls", size=16, weight=700), text("Outcomes teach the system which findings get replies.", size=14, color=INK2), btn("Go to leads", small=True), gap=10),
                    gap=20))

    def breakdown(title, items):
        return card(title, col(*[col(row(text(n, size=14), text(str(c), size=14, weight=700), justify="space-between"), bar(int(c / 422 * 100), INK, 6), gap=4) for n, c in items], gap=12))

    grid1 = grid(3,
                 breakdown("How good the leads are", [("1 · Call these first", 29), ("2 · Spends money, little wrong", 31), ("3 · Lots wrong, no spending", 94), ("4 · Lowest priority", 22), ("Not scored", 246)]),
                 breakdown("What you could sell them", [("Build them a website", 58), ("Get them found on Google", 41), ("Run their social media", 33), ("Make their site convert", 19), ("Set up ads & tracking", 13)]),
                 breakdown("State of their websites", [("Working", 297), ("Couldn't check", 117), ("Dead / parked", 8)]),
                 gap=20)
    grid2 = grid(3,
                 breakdown("Your ICPs", [("D2C fashion brands", 58), ("Embroidery shops", 64), ("Screen printers", 42), ("In no ICP", 222)]),
                 breakdown("Where they came from", [("Found by search", 299), ("From a file", 121), ("Added by hand", 2)]),
                 card("What it has cost", col(text("$5.38", size=34, weight=700), text("spent with every provider, all time", size=14, color=INK2),
                                             col(*[row(text(n, size=14), text(v, size=14, weight=700), justify="space-between") for n, v in [("Google Places", "$2.62"), ("Apify (Instagram)", "$0.43"), ("Gemini", "$0.21"), ("Everything else", "free")]], gap=8),
                                             btn("See every rate", "link", small=True), gap=10)),
                 gap=20)
    return shell("Dashboard", "Dashboard", "How the whole list is doing, and what to do next.", btn("Find businesses", "primary"), stages() + funnel + nxt + grid1 + grid2)


# ================================================================= PAGE 2 — ADD BUSINESSES

def find():
    form = card("Search Google Maps",
                col(select("Search for one of your ICPs", "D2C fashion brands"),
                    col(text("Its words will all be searched:", size=14, weight=700),
                        row(chip("t-shirt printing"), chip("hoodie brand"), chip("streetwear"), chip("custom apparel"), gap=8),
                        row(btn("Edit this ICP", "link", small=True), btn("Or search a word that is not in an ICP", "link", small=True), gap=14), gap=8),
                    field("Where?", "e.g. Dallas, TX"),
                    select("How far around it?", "25 miles"),
                    row(btn("Next: check the cost", "primary"), text("Nothing is spent on this step", size=14, color=INK2), gap=14),
                    gap=16))
    side = col(
        card("Types of business that work well", row(chip("Print shop"), chip("Embroidery"), chip("DTF transfers"), chip("Sign company"), chip("Screen printing"), chip("Promotional products"), gap=8)),
        card("What happens", col(*[row(badge(str(i + 1)), col(text(t, size=15, weight=700), text(s, size=13, color=INK2), gap=2), gap=12, align="flex-start", wrap=False) for i, (t, s) in enumerate([
            ("We search a grid of points", "Every word of the ICP, over a grid — Google caps each search at 60"),
            ("Duplicates are removed", "Chains and platforms are flagged, never silently dropped"),
            ("Each business is matched to an ICP", "Anything no ICP describes is kept aside, not deleted"),
            ("You see the cost first", "on the next screen, before anything is spent")])], gap=14)),
        gap=20)
    return shell("Find businesses", "Find businesses", "Search Google Maps for one of your ICPs.", "", stages("Sourcing") + grid(2, form, side, gap=24))


def confirm_search():
    body = grid(2,
                card("Your search", col(*[row(text(k, size=15, color=INK2), text(v, size=15, weight=700), justify="space-between") for k, v in [("Looking for", "print shop"), ("Around", "Dallas, TX"), ("Radius", "25 miles"), ("Centre found", "32.7767, -96.7970")]], gap=12), right=btn("Change", "link", small=True)),
                card("What it will cost", col(text("35¢ – $1.40", size=34, weight=700), text("for 10 to 40 Google Maps searches", size=15, color=INK2), text("billed by Google Places API · 3.5¢ each", size=14, color=INK2),
                                              text("The exact number depends on how busy the area is — busy areas get split into smaller circles.", size=14, color=INK2), gap=8)),
                card("Limits", col(field("Stop after this many businesses", "300"), field("Never spend more than", "$2.00", "The search stops at this and keeps what it found"), gap=14)),
                card("After the search", col(check("Read every website and score them", True, "Free"), check("Match them to my ICPs", True, "Free"), gap=12)),
                gap=20)
    return shell("Find businesses", "Check the cost", "Nothing has been spent yet.", btn("Back") + btn("Start search", "primary"), body)


def search_run():
    counters = grid(4, stat("128", "Businesses found"), stat("6", "Excluded", "chains and platforms"), stat("22 / 31", "Searches done"), stat("91¢", "Spent so far", "Google Places"), gap=16)
    body = col(
        '<div style="border: 1.5px solid ' + INK + '; border-radius: 10px; padding: 18px;">'
        + row(text("Searching around Dallas, TX", size=18, weight=700), text("running · 4m 12s", size=14, color=INK2), btn("Stop", "danger", small=True), gap=14)
        + '<div style="height: 10px;"></div>' + bar(71, BLUE, 10) + "</div>",
        counters,
        grid(2, card("Search grid", ph("Map of the search circles<br>done · still searching · split because full · failed", 320)),
             card("Problems", col(text("2 searches failed and will be retried", size=15, weight=700), text("Google returned a temporary error for two circles. Nothing was charged for them.", size=14, color=INK2), gap=6)), gap=20),
        row(btn("View these businesses in Leads", "primary"), gap=10),
        gap=20)
    return shell("Find businesses", "Search in progress", "", "", body)


def import_upload():
    body = grid(2,
                card("Choose your file", col(ph("Drop a CSV file here, or click to choose one", 200), text("Nothing is added until you have seen the preview on the next step.", size=14, color=INK2), btn("Read the file", "primary"), gap=14)),
                card("What your file needs", col(
                    table([("Column", "1fr"), ("Needed?", "1fr"), ("Also accepted as", "2fr")],
                          [["name", "Yes", "Business Name, company"], ["website", "No", "url, domain"], ["phone", "No", "Phone Number, tel"], ["email", "No", "e-mail"], ["city, state", "No", "town, region"]]),
                    text("Rows that already exist in your list are merged into them, never duplicated.", size=14, color=INK2), gap=12)),
                gap=24)
    return shell("Imported files", "Import a list", "Add businesses from a spreadsheet.", "", body)


def import_preview():
    counts = grid(5, stat("120", "Rows in the file"), stat("94", "New businesses"), stat("18", "Already in your list", "will be merged"), stat("3", "Possible duplicates", "check these"), stat("5", "Could not be read"), gap=14)
    plan = card("What should we do with this file?",
                col(check("Read their websites and score them", True, "Free"),
                    check("Match them to my ICPs", True, "Free"),
                    check("Then go and get their Instagram", False, "Paid — priced on the next screen before anything is spent"),
                    text("Facebook and Instagram ads are not offered here on purpose — they are bought business by business.", size=13, color=INK2),
                    gap=12))
    groups = col(
        card("New businesses (94)", table([("Row", "70px"), ("Name", "2fr"), ("Website", "1.5fr"), ("Phone", "1.2fr"), ("Town", "1fr")], [["2", "Fresh Press USA", "freshpressusa.com", "(214) 555-0101", "Dallas"], ["3", "Inked Pro", "inkedpro.com", "—", "Austin"]]), right=btn("Show all", small=True)),
        card("Already in your list (18)", text("Matched by website, phone or name and town. Their new details are added to the existing record.", size=14, color=INK2), right=btn("Show", small=True)),
        card("Could not be read (5)", table([("Row", "70px"), ("Why", "3fr")], [["12", "No business name"], ["45", "“abc” is not a website"]]), right=btn("Show", small=True)),
        gap=16)
    return shell("Imported files", "Check your file", "leads_instantly.csv — nothing has been added yet.", btn("Start over") + btn("Import 112 rows", "primary"), counts + row(col(groups, gap=16, style="flex: 1.6; min-width: 0;"), col(plan, gap=16, style="flex: 1; min-width: 0;"), gap=20, align="flex-start", wrap=False))


def imported_files():
    body = table([("File", "2fr"), ("When", "1fr"), ("Rows", "80px"), ("Businesses", "110px"), ("Status", "120px"), ("", "140px")],
                 [["<u>20260821_leads_instantly.csv</u>", "21 Aug, 14:02", "120", "112", "Imported", btn("Delete", "danger", small=True)],
                  ["<u>printers_texas.csv</u>", "19 Aug, 10:40", "40", "—", "Preview only", btn("Delete", "danger", small=True)]])
    return shell("Imported files", "Imported files", "Every list you uploaded, and exactly what each one produced.", btn("Import a list", "primary"), body)


def import_detail():
    body = col(
        grid(4, stat("120", "Rows in the file"), stat("94", "Businesses created"), stat("18", "Merged into existing"), stat("5", "Could not be read"), gap=14),
        card("What this file was told to do", row(chip("✓ Read their websites and score them", active=True), chip("✓ Matched to your ICPs", active=True), chip("Instagram — not requested"), gap=8), right=btn("Go on to buy their Instagram", small=True)),
        card("Businesses this file created", table([("Business", "2fr"), ("Where", "1fr"), ("Priority", "90px"), ("Problem", "90px"), ("Worth calling", "120px")],
                                                   [["<u>Fresh Press USA</u>", "Dallas", badge("3"), "72", "Yes"], ["<u>Inked Pro</u>", "Austin", badge("4"), "40", "No"]]), right=btn("Open these in Leads", small=True)),
        gap=20)
    return shell("Imported files", "20260821_leads_instantly.csv", "", btn("Delete this file", "danger"), body, back="Back to imported files")


def add_by_hand():
    body = grid(2,
                card("The business", col(field("Business name", "e.g. Crystal DTF", "Required"), field("Website", "crystaldtf.com"), field("Phone", "(214) 555-0199"), grid(2, field("Town", "Dallas"), field("State", "TX"), gap=14),
                                         row(btn("Add business", "primary"), btn("Cancel"), gap=10), gap=16)),
                card("What happens next", col(text("The record opens straight away. From there:", size=15),
                                              check("Full analysis reads their website and scores them", False, "Free, except the page read at 0.36¢"),
                                              check("Their Google rating needs their Google listing", False, "A name alone cannot find it yet — add the website or phone"), gap=12)),
                gap=24)
    return shell("Leads", "Add one by hand", "", "", body)


# ================================================================= PAGE 3 — INSTAGRAM AND SET UP

def instagram():
    stats = grid(5, stat("194", "Have an Instagram link"), stat("160", "Looked up"), stat("34", "Linked, never looked up"), stat("228", "No Instagram found"), stat("11", "Running ads now"), gap=14)
    note = card("What Instagram will and will not tell you", grid(2,
                col(label("You get"), text("Follower count, posts, the category Instagram shows, bio, link, verified, private", size=14), gap=6),
                col(label("Nobody can get"), text("Who follows them — Instagram never publishes the list, at any price", size=14), gap=6), gap=20))
    tools = row(chip("All", active=True), chip("Looked up"), chip("Not looked up"), chip("Running ads"), chip("10,000+ followers"), '<div style="margin-left: auto;">' + btn("Price the 34 not looked up", "primary", small=True) + "</div>", gap=8)
    tbl = table([("Business", "2fr"), ("Account", "1.5fr"), ("Followers", "110px"), ("Posts", "80px"), ("Instagram's category", "1.5fr"), ("Your ICP", "1fr"), ("Ads", "110px"), ("Where from", "1fr")],
                [["<u>Crystal DTF</u>", "@crystaldtf", "6,423", "212", "Printing service", "DTF transfer shops", "No ads live", "import"],
                 ["<u>A4 Graphic</u>", "@a4_graphic_miami", "Not looked up", "—", "—", "D2C fashion brands", "Never checked", "search"],
                 ["<u>TwinMark Embroidery</u>", "@twinmark", "1,208", "88", "Embroidery", "Embroidery shops", "2 ads live", "search"]])
    return shell("Instagram", "Instagram", "Followers, Instagram's own category, and who is running ads.", "", stats + note + tools + tbl, collapsed=True)


def icp(adding=False):
    summary = grid(4, stat("6", "ICPs you have written"), stat("200", "Businesses in an ICP"), stat("222", "In no ICP", "nobody wanted these"), stat("4", "Industries covered"), gap=14)
    unmatched = ('<div style="border: 1.5px solid ' + LINE + '; border-radius: 10px; padding: 14px 18px;">'
                 + row(col(text("222 businesses match no ICP", size=16, weight=700), text("They came from a search or a file but none of your ICPs describe them.", size=13, color=INK2), gap=2),
                       row(btn("Show them in Leads", small=True), btn("Delete them", "danger", small=True), gap=10), justify="space-between") + "</div>")
    rules = card("Your ICPs",
                 table([("Order", "70px"), ("ICP", "1.6fr"), ("Industry", "1.1fr"), ("Words it is searched by", "2.4fr"), ("Must have", "1.3fr"), ("In it", "80px"), ("", "170px")],
                       [["1", "D2C fashion brands", "Fashion", "t-shirt printing, hoodie brand, streetwear", "Instagram, 1,000+ followers", "58", btn("Edit", small=True) + " " + btn("Delete", "link", small=True)],
                        ["2", "DTF transfer shops", "Printing", "dtf transfers, direct to film, dtf printer", "a working website", "16", btn("Edit", small=True) + " " + btn("Delete", "link", small=True)],
                        ["3", "Screen printers", "Printing", "screen printing, silkscreen", "20+ Google reviews", "42", btn("Edit", small=True) + " " + btn("Delete", "link", small=True)],
                        ["4", "Embroidery shops", "Printing", "embroidery, monogram, patches", "—", "64", btn("Edit", small=True) + " " + btn("Delete", "link", small=True)],
                        ["5", "Sports & team wear", "Apparel", "team uniforms, jersey printing", "—", "12", btn("Edit", small=True) + " " + btn("Delete", "link", small=True)],
                        ["6", "Accessories brands", "Fashion", "caps, tote bags, custom accessories", "—", "8", btn("Edit", small=True) + " " + btn("Delete", "link", small=True)]]),
                 sub="Checked from the top down. The first ICP that matches wins, so put the most specific first.",
                 right=btn("Match everyone again", small=True))
    overlay = ""
    if adding:
        inner = (
            field("Name it", "D2C fashion brands", "What you call this kind of customer")
            + select("Industry", "Fashion")
            + col(label("Words to find them on Google Maps"),
                  row(chip("t-shirt printing ✕"), chip("hoodie brand ✕"), chip("streetwear ✕"), chip("custom apparel ✕"), btn("+ Add a word", small=True), gap=8),
                  text("Find businesses can run all of these in one go for this ICP.", size=13, color=INK2), gap=8)
            + col(label("Only count them as this ICP if…"),
                  check("They have a working website", False),
                  check("They have an Instagram account", True),
                  grid(2, field("At least this many followers", "1,000"), field("At least this many Google reviews", "20"), gap=14),
                  field("Only in these places", "Texas, Florida", "Leave empty for anywhere"),
                  gap=10)
            + col(label("Money — not available yet"),
                  grid(2, off_field("Budget range", "$500 – $5,000 a month", "Switched off: no provider publishes what a small business spends, and nothing on their website says it.", tip=True),
                       off_field("Approximate revenue", "$1M – $5M a year", "Switched off: revenue for small private businesses is not published. It can be bought per business later if you want it.")),
                  '<div style="height: 86px;"></div>',
                  gap=10)
            + col(label("Words in their own text"),
                  field("On their website, look for…", "t-shirt, screen print, custom apparel"),
                  field("On their Instagram, look for…", "tees, merch"),
                  field("…but never these words", "wholesale only"), gap=10)
            + '<div style="border: 1.5px solid ' + LINE + '; border-radius: 8px; padding: 14px;">'
            + col(text("Preview: 58 businesses would be D2C fashion brands", size=15, weight=700), text("12 are in another ICP now and would move.", size=13, color=INK2),
                  table([("Business", "2fr"), ("Matched on", "2fr")], [["Inked Pro", "“custom apparel” + 3,100 followers"], ["Fresh Press USA", "“screen print”"]]), gap=8)
            + "</div>"
        )
        overlay = drawer("Add an ICP", "Editing an ICP opens this same panel, filled in.", inner, row(btn("Cancel"), btn("Save ICP", "primary"), gap=10, justify="flex-end"))
    return shell("ICPs", "ICPs", "Who you actually want to sell to. Every business is matched against these, and the leads list filters by them.",
                 btn("+ Add an ICP", "primary"), stages("Filtering") + summary + unmatched + rules, overlay=overlay, min_h=(1700 if adding else 0))


def icp_adding():
    return icp(True)


def checklists(adding=False):
    rules = card("Rules",
                 table([("Rule", "2fr"), ("Applies to", "1.3fr"), ("Checks that", "2fr"), ("Weight", "80px"), ("Failing", "90px"), ("", "150px")],
                       [["Phone in the header", "Home page", "Tap-to-call number is present", "25", "7", btn("Edit", small=True) + " " + btn("Off", "link", small=True)],
                        ["Home page shows reviews", "Home page", "Reviews are present", "22", "9", btn("Edit", small=True) + " " + btn("Off", "link", small=True)],
                        ["Exactly one main heading", "Every page", "Main headings equals 1", "15", "31", btn("Edit", small=True) + " " + btn("Off", "link", small=True)]]))
    overlay = ""
    if adding:
        inner = (
            field("Name it", "Contact page has a form")
            + grid(2, select("Which pages", "Contact page"), select("Which ICP", "Every ICP"), gap=14)
            + grid(3, select("Check that", "Forms on the page"), select("…and that it", "is at least"), field("Number", "1"), gap=14)
            + field("Weight", "25", "How much failing this lowers the page's score")
            + field("What to say when it fails", "The contact page has no form, so getting in touch means writing an email from scratch.")
            + '<div style="border: 1.5px solid ' + LINE + '; border-radius: 8px; padding: 14px;">'
            + col(text("Preview: fails on 4 of 12 contact pages already read", size=15, weight=700),
                  table([("Business", "2fr"), ("Page", "1fr"), ("Found", "1fr")], [["A4 Graphic", "/contact-us", "0 forms"], ["LUNUBRI", "/contact", "0 forms"]]), gap=8)
            + "</div>"
        )
        overlay = drawer("Add a rule", "Editing a rule opens this same panel, filled in.", inner, row(btn("Cancel"), btn("Save rule", "primary"), gap=10, justify="flex-end"))
    return shell("Checklists", "Checklists", "What a good page looks like, in your words. Verdicts update on every business as soon as you save.",
                 btn("+ Add a rule", "primary"), rules, overlay=overlay, min_h=960)


def checklists_adding():
    return checklists(True)


def how_it_works():
    sections = [
        ("The four stages: sourcing, filtering, analysis, enrichment", "Sourcing and enrichment can cost money. Filtering and analysis never do.", True),
        ("How a business gets its two scores", "Problem = how much is wrong (60% the worst area, 40% the average). Signals = do they already pay for things.", True),
        ("How the four priorities are decided", "Problem 55+ and Signals 35+ is Priority 1. No website but 10,000+ followers or 50+ reviews at 4★ also counts.", False),
        ("What the product decides to sell them", "One of six, from whichever area scored worst.", False),
        ("The two things you write yourself", "Your ICPs and your checklists. Changing either never costs anything.", False),
        ("Where AI is used, and where it is not", "Three optional places. It is shown measurements, never asked to find facts.", False),
        ("Everything that costs money", "Every paid source, its price per business, and who bills it.", False),
        ("What cannot be obtained at any price", "Who follows an account, what a business spends on ads, whether a listing is claimed.", False),
        ("Where each part runs", "The website, the background worker, and the database.", False),
    ]
    items = []
    for i, (t, s, open_) in enumerate(sections):
        inner = row(badge(str(i + 1)), col(text(t, size=18, weight=700), text(s, size=15, color=INK2), gap=4), '<div style="margin-left: auto;">' + text("−" if open_ else "+", size=22, weight=700) + "</div>", gap=14, align="flex-start", wrap=False)
        if open_:
            inner += '<div style="height: 14px;"></div>' + (stages() if i == 0 else ph("Detail: the six areas with their weights, and a worked example using a real business", 170))
        items.append('<div style="border: 1.5px solid ' + (INK if open_ else LINE) + '; border-radius: 10px; padding: 18px;">' + inner + "</div>")
    body = '<div style="border: 2px solid ' + INK + '; border-radius: 10px; padding: 18px; font-size: 17px;"><b>In one sentence:</b> we source local businesses, filter them down to your ICPs, analyse their website against your checklists, and only then buy anything extra.</div>' + col(*items, gap=12, style="max-width: 1000px;")
    return shell("How it works", "How it works", "Every rule in the product, in plain words.", "", body)


def data_spend():
    totals = grid(4, stat("$5.38", "Total spent", "every provider, all time"), stat("315", "Paid calls made"), stat("1.3¢", "Average per business"), stat("6", "Things that cost nothing"), gap=14)
    free = card("Free — runs on every business automatically", grid(3, *[col(text(n, size=15, weight=700), text(s, size=13, color=INK2), gap=3) for n, s in [
        ("Reading their website", "pages, email, phone, social links"), ("51 checks", "evidence stored with every answer"), ("Scoring and sorting", "arithmetic over what is stored"),
        ("Google PageSpeed", "speed on a phone"), ("YouTube channel", "daily limit applies"), ("Your ICPs and checklists", "re-run as often as you like")]], gap=16))
    paid = card("Paid — bought only when you confirm",
                table([("Data", "2fr"), ("What you get", "2.5fr"), ("For one business", "130px"), ("For all 422", "120px"), ("Billed by", "1.3fr"), ("Can it be bought?", "140px")],
                      [["Google listing details", "Rating, reviews, hours, category", "3.5¢", "$14.77", "Google Places API", "Yes"],
                       ["Their Instagram", "Followers, posts, category, bio", "0.26¢", "$1.10", "Apify", "Yes"],
                       ["Facebook / Instagram ads", "Live ads, how many, since when", "11.6¢", "hand-picked only", "Apify", "Yes"],
                       ["Owner's mobile", "Direct mobile for the owner", "73¢", "$308", "Lusha", "Needs a key"],
                       ["Website traffic", "Estimated monthly visits", "0.12¢", "51¢", "DataForSEO", "Needs a key"]]))
    ledger = card("What you have actually spent", table([("What was bought", "2fr"), ("Calls", "90px"), ("Failed", "90px"), ("Total paid", "120px")],
                                                       [["Google listing details", "75", "0", "$2.62"], ["Instagram profile", "160", "2", "43¢"], ["The model's read on a page", "80", "0", "21¢"]]),
                  sub="Counted from the ledger, which is written before every paid call.")
    walls = card("Cannot be bought at any price", grid(3, *[col(text(n, size=15, weight=700), text(s, size=13, color=INK2), gap=3) for n, s in [
        ("Who follows an Instagram account", "Instagram never publishes the list"), ("What a business spends on ads", "Meta only publishes it for political ads"), ("Whether a Google listing is claimed", "the field does not exist")]], gap=16))
    return shell("Data & spend", "Data &amp; spend", "What each kind of data costs, who bills it, and what you have spent.", "", totals + free + paid + ledger + walls)


# ================================================================= PAGE 4 — SHARED PIECES

def login():
    form = col(
        row('<div style="width: 34px; height: 34px; border: 2.5px solid ' + INK + '; border-radius: 9px;"></div>', text("Lead Intel", size=24, weight=700), gap=12),
        text("Sign in", size=30, weight=700),
        field("Email", "you@aheadtech360.com"),
        field("Password", "••••••••"),
        btn("Sign in", "primary"),
        '<div style="border: 1.5px solid ' + RED + '; border-radius: 8px; padding: 10px 12px; font-size: 14px; color: ' + RED + ';">That email and password do not match. Check both and try again.</div>',
        gap=18, style="width: 420px;")
    return page('<div style="min-height: 900px; display: flex; align-items: center; justify-content: center; background: ' + FILL2 + ';">'
                + '<div style="background: #ffffff; border: 1.5px solid ' + LINE + '; border-radius: 12px; padding: 40px;">' + form + "</div></div>")


def shared():
    def block(title, inner, note=""):
        return col(text(title, size=20, weight=700), (hand(note) if note else ""), inner, gap=10)

    navs = row(
        '<div style="height: 620px; display: flex; border: 1.5px solid ' + LINE + '; border-radius: 10px; overflow: hidden;">' + rail("Leads") + "</div>",
        '<div style="height: 620px; display: flex; border: 1.5px solid ' + LINE + '; border-radius: 10px; overflow: hidden;">' + rail("Leads", collapsed=True) + "</div>",
        gap=28, align="flex-start")

    def job(title, state, count, pct, colour, detail, stop=False, stripe=False):
        fill = ("repeating-linear-gradient(115deg, " + colour + " 0 12px, #d9d9d9 12px 24px)" if stripe else colour)
        return (
            '<div style="border: 1.5px solid ' + LINE + '; border-radius: 10px; padding: 14px 16px;">'
            + row(text(title, size=15, weight=700), text(count, size=14, color=INK2), '<div style="margin-left: auto; display: flex; gap: 10px; align-items: center;">' + text(state, size=13, weight=700) + (btn("Stop", "danger", small=True) if stop else "") + "</div>", gap=12)
            + '<div style="height: 8px;"></div><div style="height: 9px; border-radius: 99px; background: ' + LINE2 + '; overflow: hidden;"><div style="width: ' + str(pct) + "%; height: 100%; background: " + fill + ';"></div></div>'
            + '<div style="height: 6px;"></div>' + text(detail, size=13, color=INK2) + "</div>"
        )

    jobs = col(
        taskbar(),
        grid(2,
             job("Buying Instagram for 2 businesses", "Waiting to start", "", 100, "#9e9e9e", "Queued behind another task", stop=True, stripe=True),
             job("Reading every website not yet read", "Running", "size not known yet", 100, BLUE, "Working out how many there are", stop=True, stripe=True),
             job("Re-scoring every business", "Done", "422 of 422", 100, GREEN, "Re-scored 422. 176 worth calling, 29 of them Priority 1. Cost nothing."),
             job("Full analysis of A4 Graphic", "Stopped", "3 of 5", 60, RED, "Stopped by you. Anything already read is kept."),
             gap=14),
        gap=14)

    banners = col(
        '<div style="border: 1.5px solid ' + GREEN + '; border-radius: 8px; padding: 12px 14px; font-size: 15px;"><b>Saved.</b> Buying their Instagram now — the new numbers appear on this record once it finishes.</div>',
        '<div style="border: 1.5px solid ' + RED + '; border-radius: 8px; padding: 12px 14px; font-size: 15px;"><b>Nothing ran.</b> The background worker could not be reached. Nothing was changed or spent.</div>',
        gap=10)

    tip = row(
        col(btn("Get paid data for ticked", "primary"),
            '<div style="width: 320px; background: ' + INK + '; color: #ffffff; border-radius: 10px; padding: 12px 14px; font-size: 14.5px; line-height: 1.5;">Opens a confirm screen that prices extra data for the rows you ticked. Nothing is bought until you confirm there.</div>',
            gap=8),
        col(chip("1 · Lots wrong and already spends money"),
            '<div style="width: 320px; background: ' + INK + '; color: #ffffff; border-radius: 10px; padding: 12px 14px; font-size: 14.5px; line-height: 1.5;">Show only Priority 1 businesses — 29 of them. Click again to remove the filter.</div>',
            gap=8),
        gap=40, align="flex-start")

    key = col(*[row(swatch(c, 26), col(text(t, size=15, weight=700), text(s, size=13, color=INK2), gap=2), gap=12, wrap=False) for c, t, s in [
        (TINT["red"], "Has Google reviews · no website, no Instagram", "Proven customers, nowhere online to send them. Call these first."),
        (TINT["blue"], "Has Instagram · no working website", "An audience already built, and no site behind it."),
        (TINT["peach"], "Has a working website · no Instagram", "Findable, but absent from the platform their customers use."),
        (TINT["green"], "Has both", "Least to sell them."),
        ("#ffffff", "No colour", "Nobody knows yet — usually a site we could not reach.")]], gap=12)

    unknown = grid(3,
                   col(label("Known"), text("1,208 followers", size=17, weight=700), text("Apify, 3 Sep", size=13, color=INK2), gap=2),
                   col(label("Not bought"), text("Not bought", size=17, weight=700, color=INK2), text("would cost 0.26¢, Apify", size=13, color=INK2), gap=2),
                   col(label("Could not check"), text("Couldn't check", size=17, weight=700, color=INK2), text("their server refused us", size=13, color=INK2), gap=2), gap=20)

    buttons = row(btn("Primary action", "primary"), btn("Secondary action"), btn("Stop / delete", "danger"), btn("Quiet link", "link"), btn("Small", small=True), gap=14)

    empty = '<div style="border: 1.5px dashed ' + LINE + '; border-radius: 10px; padding: 36px; text-align: center;">' + text("No businesses yet", size=20, weight=700) + '<div style="height: 6px;"></div>' + text("Find some on Google Maps, or import a list you already have.", size=15, color=INK2) + '<div style="height: 14px;"></div>' + row(btn("Find businesses", "primary"), btn("Import a list"), gap=10, justify="center") + "</div>"

    body = col(
        text("Shared pieces", size=30, weight=700),
        text("Parts that appear on many screens. Design them once.", size=16, color=INK2),
        block("Navigation — open and closed", navs, "Closed by default and remembered. Closed shows icons with the name on hover."),
        block("Tasks running in the background", jobs, "Shown at the top of every screen while anything runs. Updates once a minute, Refresh now for sooner. Stop on anything still going."),
        block("Messages after an action", banners, "Always says what happened AND what was or was not spent."),
        block("Adding or editing something", row(btn("+ Add a rule", "primary"), text("→", size=22), text("a panel slides in from the right; the page behind stays where it was", size=15), gap=14),
              "Forms are never shown open on a page. They appear only after Add or Edit, and Cancel or ✕ puts everything back."),
        block("Something that is switched off", row(
            off_field("Budget range", "$500 – $5,000 a month", "Switched off: no provider publishes what a small business spends, and nothing on their website says it.", tip=True),
            '<div style="width: 300px;"></div>', gap=40, align="flex-start") + '<div style="height: 86px;"></div>',
              "Never hidden and never a dead button. It is visibly off, and hovering says why."),
        block("The four stages", stages("Filtering"), "The whole product is these four. Every screen belongs to one of them."),
        block("Hover help", tip, "Every button and filter says what clicking it does. Never cut off by the edge of a panel."),
        block("Row colours in the leads list", key, "The key is shown above the table. To see only one colour, choose it in the Colour menu in step 1."),
        block("Known, not bought, could not check", unknown, "Three different answers. A blank is never used for any of them."),
        block("Buttons", buttons),
        block("Empty state", empty),
        gap=36, style="padding: 40px;")
    return page(body)


# ================================================================= write everything and lay out the canvas

SCREENS = [
    # file, builder, height, page, title
    ("Main.dc.html", leads, 1460, "work", "Leads · three steps"),
    ("LeadsFilter.dc.html", leads_filter, 1460, "work", "Leads · choosing a filter"),
    ("LeadsActions.dc.html", leads_actions, 1460, "work", "Leads · doing something"),
    ("LeadOverview.dc.html", lead_overview, 1380, "work", "Lead · Overview"),
    ("LeadWebsite.dc.html", lead_website, 1720, "work", "Lead · Website pages"),
    ("LeadChecks.dc.html", lead_checks, 1560, "work", "Lead · Checks & scores"),
    ("LeadCalls.dc.html", lead_calls, 920, "work", "Lead · Calls & history"),
    ("LeadCallsLog.dc.html", lead_calls_logging, 920, "work", "Lead · logging a call"),
    ("BuyData.dc.html", buy, 1240, "work", "Buy extra data"),
    ("Dashboard.dc.html", dashboard, 1560, "work", "Dashboard"),
    ("FindBusinesses.dc.html", find, 940, "add", "Find businesses"),
    ("ConfirmSearch.dc.html", confirm_search, 920, "add", "Check the cost"),
    ("SearchRun.dc.html", search_run, 960, "add", "Search in progress"),
    ("ImportUpload.dc.html", import_upload, 920, "add", "Import a list"),
    ("ImportPreview.dc.html", import_preview, 1040, "add", "Check your file"),
    ("ImportedFiles.dc.html", imported_files, 920, "add", "Imported files"),
    ("ImportDetail.dc.html", import_detail, 960, "add", "One imported file"),
    ("AddByHand.dc.html", add_by_hand, 920, "add", "Add one by hand"),
    ("Instagram.dc.html", instagram, 960, "setup", "Instagram"),
    ("Icp.dc.html", icp, 1180, "setup", "ICPs"),
    ("IcpAdd.dc.html", icp_adding, 1700, "setup", "ICPs · adding one"),
    ("Checklists.dc.html", checklists, 960, "setup", "Checklists"),
    ("ChecklistsAdd.dc.html", checklists_adding, 960, "setup", "Checklists · adding a rule"),
    ("HowItWorks.dc.html", how_it_works, 1600, "setup", "How it works"),
    ("DataSpend.dc.html", data_spend, 1500, "setup", "Data & spend"),
    ("Login.dc.html", login, 920, "shared", "Sign in"),
    ("SharedPieces.dc.html", shared, 3420, "shared", "Shared pieces"),
]

NOTES = {
    "Main.dc.html": "LEADS — three steps, top to bottom.\n\n1. Choose which businesses: search plus one menu per filter (Priority, Colour, Website…). Every choice shows as a chip under the menus with ✕ to remove it, and the count of what is left.\n2. Tick the ones you want — or none.\n3. Do something with them: one button opens every action with its price.\n\n• Only what you chose is shown. Columns, widths and buttons never move when a filter changes.\n• Colour is a filter like any other; the key sits above the table.\n• ICP is the first filter — it is how the list is narrowed to your customers.\n• Budget and revenue are visibly off with the reason on hover.",
    "LeadsFilter.dc.html": "LEADS — one filter menu open.\n\n• Each menu lists its options with how many businesses each gives.\n• Show these applies it and adds the chip. Nothing else on the page moves.",
    "LeadsActions.dc.html": "LEADS — step 3 open.\n\n• Replaces the old scattered buttons (whole-list actions, ticked actions, paid data for all).\n• First: which businesses — the ticked ones or all shown.\n• Then: one action, each with its price and who bills it.\n• The total sits next to the Start button. Paid data still goes to its own confirm screen.",
    "LeadOverview.dc.html": "ONE BUSINESS — split into four tabs so nothing is buried.\n\n• Header: who they are, how to reach them, priority, and every action on this business.\n• Full analysis = read site + 51 checks + browser page read + re-score, in that order.\n• Overview: why this lead, what to say, and everything known — grouped by source, never a blank.",
    "LeadWebsite.dc.html": "WEBSITE PAGES tab.\n\n• One card per page read in a real browser: score, checks it failed, the model's read, a line to open the call with.\n• Screenshots only for the home and product pages.\n• Verdicts follow the checklists, so editing a checklist changes these immediately.",
    "LeadChecks.dc.html": "CHECKS & SCORES tab.\n\n• Score by area (higher = more wrong), the biggest problems with evidence, speed.\n• Every one of the 51 checks: wrong / fine / could not measure — the last is never counted either way.\n• Where every value came from.",
    "LeadCalls.dc.html": "CALLS & HISTORY tab.\n\n• Calls so far, with + Log a call. The form is not on the page until you press it.\n• Every task ever run on this business, with what it did and cost. Collapsed unless something is running.",
    "BuyData.dc.html": "BUY EXTRA DATA — the only screen where money is spent.\n\n• Each kind of data: what it gives, price each × how many = total, who bills it.\n• Already bought = free again. Things that cannot be looked up are skipped and counted.\n• The source you came for is ticked already.\n• Spending limit the run stops at. Warnings in plain words.",
    "Dashboard.dc.html": "DASHBOARD — how the whole list is doing.\n\n• Pipeline left to right, each a subset of the one before.\n• Next actions, each with one button.\n• Breakdowns are links into the leads list with that filter on.\n• What it has cost, by provider.",
    "FindBusinesses.dc.html": "FIND BUSINESSES — step 1 of a search.\n\n• Type of business, place, radius.\n• Nothing is spent here; the next screen shows the cost.",
    "ConfirmSearch.dc.html": "CHECK THE COST — step 2.\n\n• Cost range and number of Google searches, with who bills it.\n• Limits: how many businesses, maximum spend.\n• What runs afterwards (free).",
    "SearchRun.dc.html": "SEARCH IN PROGRESS — step 3.\n\n• Progress, found, excluded, spend so far, Stop.\n• Grid of search circles.\n• Failures shown with whether they cost anything.",
    "ImportUpload.dc.html": "IMPORT — step 1.\n\n• Choose a CSV. Column names are matched loosely.\n• Nothing is added before the preview.",
    "ImportPreview.dc.html": "IMPORT — step 2, check before adding.\n\n• New / already in your list (merged, never duplicated) / possible duplicates / could not read, each with reasons.\n• What to do after: read & score, sort into categories (free), get Instagram (paid, priced next).",
    "ImportedFiles.dc.html": "IMPORTED FILES — every list uploaded, with delete.",
    "ImportDetail.dc.html": "ONE IMPORTED FILE — what it produced and what it was told to do, with a link to open those businesses in Leads.",
    "AddByHand.dc.html": "ADD ONE BY HAND.\n\n• Name is required; website and phone make everything else possible.\n• Honest note: a name alone cannot find the Google listing yet.",
    "Instagram.dc.html": "INSTAGRAM — the off-site view.\n\n• Who has an account, who has been looked up, followers, category, ads.\n• Price the ones not looked up in one step.\n• What Instagram will and will not tell anyone.",
    "LeadCallsLog.dc.html": "LOGGING A CALL — the panel after + Log a call: channel, result, objection, notes. Cancel closes it with nothing saved.",
    "Icp.dc.html": "ICPs — who you actually want to sell to. This replaces Categories completely.\n\n• Each ICP: a name, an industry, the words it is searched by, and what a business must have to count as one.\n• Checked top down, first match wins.\n• Businesses no ICP describes are kept in one place, not deleted.\n• Nothing here costs anything.",
    "IcpAdd.dc.html": "ADDING AN ICP — in a panel, like every other form.\n\n• The words are the same ones Find businesses will search Google Maps with, so an ICP is written once and used for sourcing AND filtering.\n• Conditions: website, Instagram, followers, reviews, places.\n• Budget and revenue are shown but switched off, with the reason on hover.\n• Preview says how many businesses it would take, and how many would move.",
    "Checklists.dc.html": "CHECKLISTS — your rules, and + Add a rule. No form on the page.",
    "ChecklistsAdd.dc.html": "CHECKLISTS — adding a rule, in a panel.\n\n• Which pages, which category, what to check, weight, and the sentence to say when it fails.\n• Preview on pages already read. Rules can be switched off.",
    "HowItWorks.dc.html": "HOW IT WORKS — every rule in plain words, as an accordion. Numbers on this page come from the same settings the product uses.",
    "DataSpend.dc.html": "DATA & SPEND.\n\n• Totals, what is free, every paid source with price and who bills it.\n• The ledger of what was actually spent.\n• What cannot be bought at any price.",
    "Login.dc.html": "SIGN IN — email and password, with a plain error.",
    "SharedPieces.dc.html": "SHARED PIECES — design these once, use everywhere: navigation (open / closed), background tasks (waiting, running, unknown size, done, stopped), messages, hover help, row colours, the three kinds of unknown, buttons, empty state.",
}

PAGES = [("work", "Daily work"), ("add", "Adding businesses"), ("setup", "Instagram & set up"), ("shared", "Sign in & shared pieces")]


def layout():
    artboards, annotations = [], []
    per_row = 4
    for pid, _ in PAGES:
        items = [s for s in SCREENS if s[3] == pid]
        y = 0
        for r in range(0, len(items), per_row):
            chunk = items[r:r + per_row]
            row_h = max(h for _, _, h, _, _ in chunk)
            for i, (f, _, h, _, title) in enumerate(chunk):
                x = i * (1440 + 160)
                artboards.append({"file": f, "x": x, "y": y, "w": 1440, "h": h, "title": title, "page": pid})
                annotations.append({"id": "note-" + f.replace(".dc.html", "").lower(), "x": x, "y": y + h + 40, "w": 760, "text": NOTES[f], "page": pid})
            y += row_h + 40 + 420
    return {"pages": [{"id": p, "name": n} for p, n in PAGES], "artboards": artboards, "annotations": annotations,
            "launch": {"view": "canvas", "page": "work"}}


if __name__ == "__main__":
    for f, builder, _, _, _ in SCREENS:
        save(f, builder())
    io.open(os.path.join(OUT, "canvas.json"), "w", encoding="utf-8").write(json.dumps(layout(), indent=2, ensure_ascii=False))
    print("wrote", len(SCREENS), "artboards and canvas.json")
