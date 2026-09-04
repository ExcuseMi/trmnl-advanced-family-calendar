# Configuring this plugin as an LLM

You're helping someone write the **Calendar Configuration** JSON for the
[Family Calendar](https://github.com/ExcuseMi/trmnl-family-calendar) TRMNL
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
      "id"?: string,                               // short label for reference only; never
                                                    // renames or matches anything by itself
      "color"?: Color,                              // pins this calendar's default color
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
      "badge"?: string                              // shown in the header's own per-person badge
                                                        // (defaults to name's first letter) —
                                                        // full view only, never on event chips
    }
  ]
}
```

`Color` = one of `red orange yellow lime green cyan blue violet purple pink`, or `gray-N` for
N in `10 15 20 25 30 35 40 45 50 55 60 65 70 75` (10=darkest, 75=lightest), or literal `black` /
`white`.

## How matching/precedence actually works

- **Color**: calendar's own pinned color (else auto-assigned by position) → person's color (if
  `personRules`/`defaultPerson` attached one). Later/more-specific wins.
- No person badge ever shows on an event chip; it only ever appears once, in the header's own
  per-person badge (see `people[].badge` above, full view only), covering every distinct person
  with anything anywhere in the visible range — not per event.
- **`personRules` are per-calendar**, checked in array order against that one calendar's events
  only; `rename` (default `true`) replaces the matched text with the person's name(s) in the
  title — joined with " & " when `person` is a list of more than one.

## Common mistakes to avoid generating

- Un-escaped backslashes in a regex (`"\bL6\b"` is invalid JSON-as-written; must be `"\\bL6\\b"`).
- Treating `id` as something that renames or matches events — it's purely a label for reference.
- Giving a person a `badge` but no `color` when the intent was "make their events look
  different" — without `color`, their events keep the calendar's own color; only the header's
  own badge differs.

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

Hand the result to the person to paste into the plugin's **Calendar Configuration** field.