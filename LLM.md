# Configuring this plugin as an LLM

You're helping someone write the **Calendar Configuration** JSON for the
[Advanced Family Calendar](https://github.com/ExcuseMi/trmnl-advanced-family-calendar) TRMNL
plugin. This file is a compact reference for that one job. For prose explanations and worked
examples, see [CONFIG.md](CONFIG.md) in this repo — this file is the terse/structured version of
the same schema.

Output ONE JSON object, no comments, no trailing commas, matching the shape below. Regexes in JSON
need every backslash doubled (`\bL6\b` → `"\\bL6\\b"`). If you can't verify field names against
this file from memory, re-read it rather than guessing — a misspelled key is silently ignored, not
an error.

## Schema

```
{
  "hours"?: { "start": int, "end": int },        // default 7-21; auto-widens for sunrise/events/
                                                    // sunset/now, never shrinks below what's given
  "calendars": [                                  // required, at least one
    {
      "url": string,                              // required — ICS link (webcal:// ok)
      "id"?: string,                               // short label; ONLY used as a lookup key for
                                                    // personRules/defaultPerson/categories[].
                                                    // calendars/excludeCalendars — never renames
                                                    // or matches anything by itself
      "color"?: Color,                              // pins this calendar's default color
      "icon"?: Icon,                                 // default icon for every event here
      "exclude"?: string | string[],                // regex(es); matches hidden entirely
      "personRules"?: [
        { "match": string, "person": string | string[], "rename"?: bool }  // rename defaults
                                                        // true; person: one name or several for
                                                        // a shared event, e.g. ["Alex","Jordan"]
      ],
      "defaultPerson"?: string | string[]             // applied when no personRule matched;
                                                        // same one-or-several shape as above
    }
  ],
  "people"?: [
    {
      "name": string, "color"?: Color,
      "badge"?: string,                             // defaults to name's first letter
      "image"?: string                               // https:// photo URL; replaces badge in
                                                        // the same circle if both are set
    }
  ],
  "categories"?: [
    {
      "name"?: string,                              // label only, not matched against anything
      "match": string | string[],                    // required — regex(es), checked across
                                                        // EVERY calendar regardless of scope below
      "color"?: Color,
      "icon"?: Icon,
      "display"?: "image",                            // drop the title text entirely, badge(s)
                                                        // fill the whole chip instead (falls back
                                                        // to normal if nothing resolved to show)
      "calendars"?: string[],                         // whitelist by calendars[].id (or .url)
      "excludeCalendars"?: string[]                   // blacklist by calendars[].id (or .url)
                                                        // — calendars/excludeCalendars are
                                                        // mutually exclusive in practice; omit
                                                        // both for "applies everywhere"
    }
  ]
}
```

`Color` = one of `red orange yellow lime green cyan blue violet purple pink`, or `gray-N` for
N in `10 15 20 25 30 35 40 45 50 55 60 65 70 75` (10=darkest, 75=lightest), or literal `black` /
`white`.

`Icon` = a Material Symbols name (bare, e.g. `"cake"`, underscores for multi-word:
`"directions_car"` — browse [fonts.google.com/icons](https://fonts.google.com/icons)), OR a
Tabler Icons name prefixed `tabler:` (e.g. `"tabler:yoga"`, `"tabler:barbell"` — browse
[tabler.io/icons](https://tabler.io/icons); use this set for sport/activity icons Material
Symbols doesn't have — no "pilates"/"yoga"/"meditation" there at all), OR a direct `https://`
image URL, OR an array of up to two of any of those (rendered as two small overlapping badge
circles, e.g. `["work", "home"]`).

## How matching/precedence actually works

- **Color**: calendar's own pinned color (else auto-assigned by position) → person's color (if
  `personRules`/`defaultPerson` attached one) → matched category's color. Later/more-specific
  wins; a category's color is checked last and wins if set.
- **Badge rail** (the left-edge strip every event shows) has exactly 2 slots: each attached,
  DECLARED person fills the front slot(s) first, one per person, in the order
  `personRules`/`defaultPerson` listed them — their `image` photo if set, else their `badge`
  letter — then a matched category's `icon`(s) fill whatever slot(s) are left (one icon = 1
  slot, `["a","b"]` = both, falling back to the calendar's own default `icon` if no category
  matched). Nothing in any slot = a plain color accent, no circle. This is why a person's own
  badge and a category icon routinely show together (badge = whose, icon = what kind) as long
  as only one person was declared on that event.
- **`display: "image"`** on a category takes whatever ended up in the rail and blows it up to
  fill the whole chip, dropping the title — only takes effect if something real is actually in
  a slot (an icon matched, or a person got attached); otherwise it's a normal text chip.
- **Categories are NOT calendar-scoped by default** — a bare category with no `calendars`/
  `excludeCalendars` is checked against every event on every calendar. Use `excludeCalendars` to
  keep a broad category (e.g. `"match": "work|werk"`) off one calendar that's already "someone's
  own" — that calendar's own defaultPerson/color shows through there instead.
- **`personRules` are per-calendar**, checked in array order against that one calendar's events
  only; `rename` (default `true`) replaces the matched text with the person's name(s) in the
  title — joined with " & " when `person` is a list of more than one.

## Common mistakes to avoid generating

- Un-escaped backslashes in a regex (`"\bL6\b"` is invalid JSON-as-written; must be `"\\bL6\\b"`).
- Treating `id` as something that renames or matches events — it's purely a lookup key for
  `categories[].calendars`/`excludeCalendars` and `personRules`/`defaultPerson`.
- Giving a person a `badge` but no `color` when the intent was "make their events look
  different" — without `color`, their events keep the calendar's own color; only the badge
  circle differs.
- Writing a category with no `match` — it's required; a color/icon-only category still needs a
  regex, even a broad one like `".*"` if truly "everything on this calendar."
- Guessing an icon name instead of noting the set — a Material Symbols name and a Tabler name
  are never interchangeable; get the prefix right (`tabler:` or nothing) for the one you mean.

## Minimal worked example

```json
{
  "calendars": [
    { "id": "Family", "url": "https://cloud.example.com/family.ics", "color": "blue" },
    {
      "id": "Alex", "url": "https://cloud.example.com/alex.ics",
      "defaultPerson": "Alex"
    }
  ],
  "people": [
    { "name": "Alex", "color": "pink", "badge": "A" }
  ],
  "categories": [
    { "name": "Birthday", "match": "birthday|verjaardag", "icon": "cake" },
    { "name": "Sport", "match": "yoga|pilates|gym", "icon": "tabler:yoga", "display": "image" },
    { "name": "Work", "match": "work|werk", "icon": "work", "excludeCalendars": ["Alex"] }
  ]
}
```

A shared-event variant of `personRules` (e.g. a family calendar where one event belongs to more
than one kid):

```json
"personRules": [
  { "match": "family trip", "person": ["Alex", "Jordan"] }
]
```

Hand the result to the person to paste into the plugin's **Calendar Configuration** field, or
build it interactively at
[the Configuration Editor](https://trmnl.bettens.dev/advanced-family-calendar/)
instead — it validates JSON and previews real colors/icons directly; testing against a real ICS
feed there works via direct fetch when the calendar host allows it (CORS), falling back to the
same backend serving the editor itself (which fetches server-side, where CORS doesn't apply),
and only then to pasting the raw `.ics` text by hand.
