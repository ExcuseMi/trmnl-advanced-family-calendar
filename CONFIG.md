# Calendar Configuration reference

This document explains, field by field, the JSON you paste into the plugin's **Calendar
Configuration** setting in TRMNL. It's the same JSON the
[Configuration Editor](tools/config-editor.html) generates for you — you don't need to read this
to use the plugin. It's here for when you want to hand-edit the JSON, understand exactly what a
setting does, or troubleshoot why an event isn't showing the color/icon you expected.

If you just want to get set up, use the
**[Configuration Editor](https://trmnl.bettens.dev/advanced-family-calendar/)**
instead — it builds this JSON for you through a form, and lets you test it against your real
calendars before you save anything.

---

## Contents

- [The short version](#the-short-version)
- [Overview](#overview)
- [`hours`](#hours)
- [`calendars[]`](#calendars)
- [`people[]`](#people)
- [`categories[]`](#categories)
- [A quick primer on regex](#a-quick-primer-on-regex)
- [How a color or icon gets decided](#how-a-color-or-icon-gets-decided)
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

Everything else — colors, people, categories, icons, holidays — is optional, and layers on top
of this without changing it.

---

## Overview

The whole configuration is **one JSON object** with up to four top-level keys, all optional
except `calendars`:

| Key | What it's for |
|---|---|
| [`hours`](#hours) | The default time-of-day range the grid shows |
| [`calendars`](#calendars) | Your ICS feeds — the actual event sources |
| [`people`](#people) | Names you can attach to events, each with their own color/badge |
| [`categories`](#categories) | Kinds of events (Birthday, Work, ...) you can attach across every calendar at once, each with their own color/icon |

```json
{
  "hours": { ... },
  "calendars": [ { ... }, { ... } ],
  "people": [ { ... } ],
  "categories": [ { ... } ]
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
| `id` | text | no | — | A short label. Doesn't affect rendering directly, but it's what [`categories[].calendars`/`excludeCalendars`](#categories) reference to scope a category to (or away from) this calendar. |
| `color` | [color name](#colors) | no | auto-assigned | Pins this calendar's color. Without it, calendars are colored in the order they appear, cycling through 10 colors. |
| `icon` | [icon](#icons) | no | none | A default icon shown on every event from this calendar, unless a [category](#categories) claims a more specific one. |
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
  { "name": "Alex", "color": "pink", "badge": "K" },
  { "name": "Jordan", "color": "blue", "image": "https://example.com/jordan.jpg" }
]
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | text | **yes** | — | Also the name `personRules[].person` / `defaultPerson` reference to attach this person. |
| `color` | [color name](#colors) | no | — | If set, overrides the calendar's own color for this person's events. |
| `badge` | short text (1–3 characters) | no | `name`'s first letter | Shown in the header's small per-person badge. |
| `image` | direct `https://` photo/avatar URL | no | — | Replaces that same header badge's letter with an actual picture. `image` wins if both are set. |

A person with no `color` set still gets the header badge — it just doesn't change the event's own
color, which stays whatever the calendar/category alone would produce.

The header's own top-left corner shows one small badge for every person with at least one event
anywhere in the visible range — a glance at the top of the grid answers "does anyone have
something coming up" without reading every chip below it. Automatic: no setting to turn it on, it
just reflects whoever's actually tagged (by `personRules`/`defaultPerson`) somewhere in view. This
is the *only* place a person's badge/photo shows — individual event chips never carry one (see
[`categories[].icon`](#categories) for what an event chip's own icon shows instead).

That header badge is small and TRMNL's panels are grayscale/dithered, so a real photo often turns
muddy at that size — a flat, high-contrast cartoon/illustrated version of the same photo reads
much more clearly. [imagetocartoon.com](https://imagetocartoon.com/) is one free way to make one
before uploading it (the [Configuration Editor](https://trmnl.bettens.dev/advanced-family-calendar/)
can host the result for you — see its Photo field / [Backend](README.md#backend)).

---

## `categories[]`

A category is a **kind of event** — Birthday, Work, Medical, whatever's meaningful to you — that
you can attach by matching the title, **across every calendar at once by default**. This is the
key difference from `people[]`: a person is scoped to one calendar's `personRules`, but a
category isn't scoped to any *particular* calendar unless you ask it to be — the same "Birthday"
category can catch a birthday on your family calendar *and* your work calendar with one rule.

A matched category can recolor the event and/or give its chip an icon — shown bare (no circle, no
background) right in front of the title, tinted to the chip's own text color, not a separate
rail. An event with no matching category, or a category with no `icon` set, just shows its plain
title with no icon at all.

```json
"categories": [
  { "name": "Birthday", "match": "birthday|verjaardag", "icon": "cake", "color": "pink" },
  { "name": "Work From Home", "match": "\\bWFH\\b", "icon": ["work", "home"] },
  { "name": "Work", "match": "\\bwork\\b", "icon": "work", "excludeCalendars": ["Alex"] },
  { "name": "Yoga", "match": "yoga|pilates", "icon": "tabler:yoga", "display": "image" }
]
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | text | no | — | A label purely for your own reference — no effect on rendering. |
| `match` | regex, or list of regex | **yes** | — | Tested against every event's title. Any one matching is enough. |
| `color` | [color name](#colors) | no | — | Recolors the event when this category matches. |
| `icon` | [icon](#icons), or a list of up to two | no | — | Shown on the chip. Two icons (e.g. `["work", "home"]` for "Work From Home") show side by side; one icon just shows the one. |
| `display` | `"image"` | no | normal text chip | Drops the title entirely — the icon(s) fill the whole chip instead, for a recurring event an icon alone already says everything about. Falls back to a normal chip if no icon actually matched. |
| `calendars` | list of calendar ids | no | every calendar | A whitelist — this category only checks events from these calendars. Reference a calendar by its `calendars[].id` (or `.url`, if it has no id). |
| `excludeCalendars` | list of calendar ids | no | — | A blacklist — this category checks every calendar *except* these. |

If more than one category matches the same event, they combine rather than replace each other:
a category that only sets a color and a later one that only sets an icon both apply — it's the
last match *for that specific field* that wins, not the last match overall.

### Keeping a category off someone's own calendar

A global category can accidentally steamroll a more personal signal. Say you have a calendar
that's entirely one person's own (`defaultPerson` set), and *also* a "Work" category that
matches the word "work" anywhere — including on that person's own calendar, where you'd rather
their own name/badge showed instead of the generic Work icon:

```json
{
  "calendars": [
    { "id": "Alex", "url": ".../alex.ics", "defaultPerson": "Alex" }
  ],
  "people": [
    { "name": "Alex", "color": "gray-70" }
  ],
  "categories": [
    { "name": "Work", "match": "\\bwork\\b", "icon": "work", "excludeCalendars": ["Alex"] }
  ]
}
```

With `excludeCalendars` pointed at Alex's own calendar, a "Work" event on *any other* calendar
still gets the category's icon — but a "Work" event on Alex's own calendar falls straight
through to Alex's own color/badge, exactly as if the category didn't exist there.

---

## A quick primer on regex

Several fields (`exclude`, `personRules[].match`, `categories[].match`) use **regular
expressions** — a pattern language for matching text, not just an exact phrase. A few things
that cover almost every real case:

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

## How a color or icon gets decided

This is the part that trips people up most, so here it is spelled out plainly. For **color**,
starting from the least to the most specific:

1. **Base color** — the calendar's own pinned `color`, or if it doesn't have one, colors are
   auto-assigned in the order calendars appear.
2. **Person color** — if the event has a person attached (via `personRules`/`defaultPerson`)
   *and* that person has a `color` set, it overrides the base.
3. **Category color** — if any category matches *and* has a `color` set, it overrides
   everything above.

For the event chip's own **icon**, it's simpler — no slot-sharing with a person, since a
person's badge/photo never shows on the chip itself (only in the header — see
[`people[]`](#people)):

1. A matched category's `icon`(s) win first — one icon shows just the one, `["a", "b"]` shows
   both side by side.
2. Failing that, the calendar's own default `icon` (if it has one) shows instead.
3. With neither, the chip just shows its plain title, no icon at all.

A category scoped `display: "image"` then takes whatever icon(s) resulted from step 1 and blows
them up to fill the whole chip, with no title text — falling back to a normal text chip if
nothing actually matched there.

A category only ever reaches step 1 for an event if it's actually allowed to see that event's
calendar in the first place — see [`calendars`/`excludeCalendars`](#categories) above. A category
scoped away from a calendar behaves, for that calendar, as if it didn't exist — the chain falls
straight through to the calendar's own default icon, or no icon at all.

### Worked example

```json
{
  "calendars": [
    { "url": ".../school.ics", "color": "blue", "personRules": [{ "match": "\\bL6\\b", "person": "Alex" }] }
  ],
  "people": [
    { "name": "Alex", "color": "pink", "badge": "K" }
  ],
  "categories": [
    { "name": "Field Trip", "match": "trip", "icon": "flight" }
  ]
}
```

- An event titled **"L6 Math"** → renamed nothing (no "trip" match), attached to Alex → **pink**,
  badge **"K"**. The calendar's own blue never shows because Alex's color overrides it.
- An event titled **"L6 Field Trip"** → attached to Alex (still pink) → but the *icon* now comes
  from the Field Trip category, so the badge shows a plane icon instead of "K". Color stays pink
  — categories only override color when they set one, and this one didn't.
- An event titled **"Staff Meeting"** (no "L6", no "trip") → matches nothing → plain **blue**
  (the calendar's own color), no badge at all.

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
      "color": "red",
      "icon": "flag"
    }
  ],
  "people": [
    { "name": "Alex", "color": "pink", "badge": "K" }
  ],
  "categories": [
    { "name": "Birthday", "match": "birthday|verjaardag", "icon": "cake" },
    { "name": "Work From Home", "match": "\\bWFH\\b", "icon": ["work", "home"] }
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

### Icons

Any of:

- **A [Material Symbols](https://fonts.google.com/icons) name**, e.g. `"cake"`, `"flight"`,
  `"directions_car"` (underscore for multi-word names — that's the name shown under each icon
  on Google's site). The [Configuration Editor](tools/config-editor.html) has a live search box
  for these, so you don't need to browse Google's site or guess spellings.
- **A [Tabler Icons](https://tabler.io/icons) name, prefixed `tabler:`**, e.g. `"tabler:yoga"`,
  `"tabler:barbell"`. A second icon set for the sport/activity coverage Material Symbols is
  missing entirely — no "pilates", "yoga", or "meditation" there at all. The Configuration
  Editor's search box covers this set too (a bare search checks both sets at once; typing
  `tabler:` narrows it to just this one).
- **A direct image URL** (`https://...`) for any custom/self-hosted icon of your own —
  already works today with no special setup, just paste the link.
- **A list of up to two** of any of the above, shown bare side by side (no circles, no
  background), tinted to the chip's own text color.

---

## Common mistakes

- **A single backslash in a regex.** `\bL6\b` in raw JSON is invalid — it needs to be `\\bL6\\b`.
  If your pattern silently doesn't match anything, this is the first thing to check. (The
  Configuration Editor's form fields avoid this entirely — only matters if hand-editing JSON.)
- **Expecting `id` to rename or match events on its own.** It doesn't — renaming/matching always
  happens through `personRules`/`defaultPerson`/`categories[].match`, never `id` directly. `id`
  *is* used as the reference for `categories[].calendars`/`excludeCalendars` though (see
  [`categories[]`](#categories)) — get the spelling exactly right there, it's a plain string
  match, not a regex.
- **A person with no color pinned still needing to look different.** If you want Alex's events
  to visually stand out, `people[].color` has to actually be set — otherwise their events just
  keep whatever color the calendar itself uses, with only the header's own badge to tell them
  apart (see [`people[]`](#people) — no per-event badge exists to fall back on).
- **A trailing comma, or a stray quote**, breaking the whole JSON. Paste it into the
  [Configuration Editor](tools/config-editor.html) or any JSON validator to check before saving —
  malformed JSON falls back to showing nothing configured at all.
