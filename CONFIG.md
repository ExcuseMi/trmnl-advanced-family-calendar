# Calendar Configuration reference

This document explains, field by field, the JSON you paste into the plugin's **Calendar
Configuration** setting in TRMNL. It's the same JSON the
[Configuration Editor](tools/config-editor.html) generates for you — you don't need to read this
to use the plugin. It's here for when you want to hand-edit the JSON, understand exactly what a
setting does, or troubleshoot why an event isn't showing the color you expected.

If you just want to get set up, use the
**[Configuration Editor](https://excusemi.github.io/trmnl-family-calendar/tools/config-editor.html)**
instead — it builds this JSON for you through a form, and lets you test it against your real
calendars before you save anything.

---

## Contents

- [The short version](#the-short-version)
- [Overview](#overview)
- [`hours`](#hours)
- [`calendars[]`](#calendars)
- [`people[]`](#people)
- [A quick primer on regex](#a-quick-primer-on-regex)
- [How a color gets decided](#how-a-color-gets-decided)
- [Full example](#full-example)
- [Common mistakes](#common-mistakes)

---

## The short version

At minimum, all you need is one calendar:

```json
{
  "calendars": [
    { "url": "https://your-calendar-app.example.com/your-secret-link.ics" }
  ]
}
```

Everything else — colors, people, holidays — is optional, and layers on top of this without
changing it.

---

## Overview

The whole configuration is **one JSON object** with up to three top-level keys, all optional
except `calendars`:

| Key | What it's for |
|---|---|
| [`hours`](#hours) | The default time-of-day range the grid shows |
| [`calendars`](#calendars) | Your ICS feeds — the actual event sources |
| [`people`](#people) | Names you can attach to events, each with their own color/badge |

```json
{
  "hours": { ... },
  "calendars": [ { ... }, { ... } ],
  "people": [ { ... } ]
}
```

A note on how strict this is: **nothing here is validated harshly.** If an entry is missing a
required field, has invalid JSON, or points at a broken URL, the plugin skips that one entry and
keeps going with everything else, rather than showing an error for your whole calendar. This is
deliberate — it's meant to tolerate you editing the JSON a bit at a time.

---

## `hours`

```json
"hours": { "start": 7, "end": 21 }
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `start` | whole number, 0–23 | no | `7` | Hour of day the grid starts at |
| `end` | whole number, 1–24 | no | `21` | Hour of day the grid ends at |

This is only the *default* range — the plugin always **widens it automatically** so that
sunrise, sunset, and every actual event on screen are visible, no matter what you set here. It
only ever shrinks the *unused* hours out of the way (e.g. the middle of the night), never hides
something real. So you can leave this out entirely and the grid will size itself sensibly around
your actual day.

---

## `calendars[]`

The list of ICS feeds to show. **This is the only required part of the configuration** — without
at least one calendar, the plugin has nothing to display.

```json
"calendars": [
  {
    "url": "https://cloud.example.com/family.ics",
    "id": "Family",
    "color": "pink"
  }
]
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `url` | text | **yes** | — | The ICS feed's address. `webcal://` links are converted to `https://` automatically. |
| `id` | text | no | — | A short label for your own reference. Doesn't affect rendering. |
| `color` | [color name](#colors) | no | auto-assigned | Pins this calendar's color. Without it, calendars are colored in the order they appear, cycling through 10 colors. |
| `exclude` | regex, or list of regex | no | — | Any event whose title matches **hides it entirely**, only from this calendar. See [regex primer](#a-quick-primer-on-regex). |
| `personRules` | list (see below) | no | — | Rules for attaching a [person](#people) to specific events on this calendar. |
| `defaultPerson` | text, or list of text | no | — | Person name(s) to attach to every event on this calendar that no `personRules` entry matched. One name, or a list for a calendar that's already shared between people. |

**Where do I find my ICS link?** Every major calendar app has one, usually tucked into settings:

- **Nextcloud**: Calendar → hover a calendar → ⋯ → *Copy private link*
- **Google Calendar**: Settings → your calendar → *Secret address in iCal format*
- **Outlook / Apple Calendar**: similarly under calendar sharing/export settings

Treat this link like a password — anyone with it can read your calendar.

### `calendars[].personRules[]`

Each entry attaches a [person](#people) to specific events on that one calendar, by matching
their title:

```json
"personRules": [
  { "match": "\\bL6\\b", "person": "Alex" },
  { "match": "\\bL6\\b", "person": "Alex", "rename": false },
  { "match": "family trip", "person": ["Alex", "Jordan"] }
]
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `match` | regex | **yes** | — | Tested against every event's title on this calendar. |
| `person` | text, or list of text | **yes** | — | The person's name (see [`people[]`](#people)) — one name, or a list of them for a shared event (e.g. `["Alex", "Jordan"]`). Doesn't have to already be declared there — but only a *declared* person contributes a badge; an undeclared name still renames, just with no styling. |
| `rename` | true/false | no | `true` | Whether the matched text gets replaced with `person`'s name(s) — joined with " & " when there's more than one. Set `false` to attach the person's color/badge *without* changing the title — e.g. tagging "L6" events as Alex's without rewriting "L6" to "Alex" on screen. |

Rules are checked **in the order you list them**, against each other's output — so if an
earlier rule renames "L6" to "Alex", a later rule can match against "Alex" instead of "L6". If
more than one rule matches the same event, the **last** one wins.

---

## `people[]`

A person is a **color**, plus one small badge shown in the header's own corner (not repeated on
every one of their events — see below). People don't do any matching themselves; *where* a
person's name gets attached to an event is entirely controlled by that calendar's
[`personRules`/`defaultPerson`](#calendarspersonrules).

```json
"people": [
  { "name": "Alex", "color": "pink", "badge": "K" }
]
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | text | **yes** | — | Also the name `personRules[].person` / `defaultPerson` reference to attach this person. |
| `color` | [color name](#colors) | no | — | If set, overrides the calendar's own color for this person's events. |
| `badge` | short text (1–3 characters) | no | `name`'s first letter | Shown in the header's small per-person badge. |

A person with no `color` set still gets the header badge — it just doesn't change the event's own
color, which stays whatever the calendar alone would produce.

The header's own top-left corner (full view only) shows one small badge for every person with at
least one event anywhere in the visible range — a glance at the top of the grid answers "does
anyone have something coming up" without reading every chip below it. Automatic: no setting to
turn it on, it just reflects whoever's actually tagged (by `personRules`/`defaultPerson`)
somewhere in view. This is the *only* place a person's badge shows — individual event chips never
carry one.

---

## A quick primer on regex

Several fields (`exclude`, `personRules[].match`) use **regular expressions** — a pattern
language for matching text, not just an exact phrase. A few things that cover almost every real
case:

| Pattern | Matches | Example |
|---|---|---|
| `Birthday` | that word anywhere in the title (case doesn't matter) | matches "Birthday", "birthday", "Sam's Birthday Party" |
| `a\|b\|c` | any one of several words | `birthday\|verjaardag` matches either English or Dutch |
| `\bL6\b` | a whole word only, not part of another word | `\bL6\b` matches "L6" but not "L60" or "XL6" |

That's genuinely enough for most people — `word1|word2|word3` and `\bWORD\b` cover the vast
majority of real configurations. If you want to go further, any general regex reference (search
"regex cheat sheet") applies here directly — this uses standard JavaScript-flavored regex.

One JSON detail to know: inside a JSON string, a backslash has to be written **twice**
(`\\b`, not `\b`) — that's a JSON escaping rule, not a regex one. The Configuration Editor's
form fields handle this for you automatically; only matters if you're hand-typing the JSON.

---

## How a color gets decided

This is the part that trips people up most, so here it is spelled out plainly, least to most
specific:

1. **Base color** — the calendar's own pinned `color`, or if it doesn't have one, colors are
   auto-assigned in the order calendars appear.
2. **Person color** — if the event has a person attached (via `personRules`/`defaultPerson`)
   *and* that person has a `color` set, it overrides the base.

### Worked example

```json
{
  "calendars": [
    { "url": ".../school.ics", "color": "blue", "personRules": [{ "match": "\\bL6\\b", "person": "Alex" }] }
  ],
  "people": [
    { "name": "Alex", "color": "pink", "badge": "K" }
  ]
}
```

- An event titled **"L6 Math"** → attached to Alex → **pink**, badge **"K"**. The calendar's own
  blue never shows because Alex's color overrides it.
- An event titled **"Staff Meeting"** (no "L6") → matches nothing → plain **blue** (the
  calendar's own color), no badge at all.

---

## Full example

Everything combined, including a public holiday calendar (which the
[Configuration Editor](tools/config-editor.html) can add for you with one click — pick your
country, and it fills in a real calendar entry like the one below):

```json
{
  "hours": { "start": 7, "end": 21 },
  "calendars": [
    { "id": "Alex", "url": "https://cloud.example.com/alex.ics", "defaultPerson": "Alex" },
    {
      "id": "School",
      "url": "https://cloud.example.com/school.ics",
      "color": "blue",
      "exclude": ["\\bL[1345]\\b", "\\bK[123]\\b"],
      "personRules": [
        { "match": "\\bL6\\b", "person": "Alex" }
      ]
    },
    {
      "id": "Holidays",
      "url": "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics",
      "color": "red"
    }
  ],
  "people": [
    { "name": "Alex", "color": "pink", "badge": "K" }
  ]
}
```

### Colors

One of: `red` `orange` `yellow` `lime` `green` `cyan` `blue` `violet` `purple` `pink`, an
explicit gray shade `gray-10` through `gray-75` (in steps of 5 — `gray-10` is darkest, `gray-75`
is lightest), or literal `black` / `white`. Named colors automatically render as real color on
color TRMNL panels and fall back to a distinct gray on black-and-white ones; an explicit
`gray-N` (or `black`/`white`) gives you direct control over exactly how light or dark something
reads.

---

## Common mistakes

- **A single backslash in a regex.** `\bL6\b` in raw JSON is invalid — it needs to be `\\bL6\\b`.
  If your pattern silently doesn't match anything, this is the first thing to check. (The
  Configuration Editor's form fields avoid this entirely — only matters if hand-editing JSON.)
- **Expecting `id` to rename or match events on its own.** It doesn't — renaming/matching always
  happens through `personRules`/`defaultPerson`, never `id` directly; `id` is purely a label for
  your own reference.
- **A person with no color pinned still needing to look different.** If you want Alex's events
  to visually stand out, `people[].color` has to actually be set — otherwise their events just
  keep whatever color the calendar itself uses, with only the header's own badge to tell them
  apart (see [`people[]`](#people) — no per-event badge exists to fall back on).
- **A trailing comma, or a stray quote**, breaking the whole JSON. Paste it into the
  [Configuration Editor](tools/config-editor.html) or any JSON validator to check before saving —
  malformed JSON falls back to showing nothing configured at all.
