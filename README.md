# TRMNL: Daylight & Weather Calendar

A [TRMNL](https://usetrmnl.com) private plugin that shows 1 day to a week of any ICS calendar
feed as a time-grid, with sunrise/sunset and daily weather on the timeline. The grid auto-scales
so the hours that matter (daylight and your meetings) get more room and quiet hours shrink out
of the way, with no fixed "business hours" window to configure.

Runs entirely on TRMNL **[Serverless](https://help.trmnl.com/en/articles/14130649-serverless)**,
no server to host, no middleman service. `plugin/src/transform.js`'s `run()` fetches the ICS
link(s), expands recurring events for the window, and returns a pre-computed native layout
(percent-of-screen heights) to the Liquid template. The same file, unmodified, also runs in a
plain browser tab — see [Configuration Editor](#configuration-editor) below.

## What it shows

- 1 to 7 day columns (your choice), drawn as a real hour-grid (not an image), with daylight and
  meeting hours automatically given more vertical space than the quiet hours around them.
- All-day events as chips, timed events as blocks sized by duration, overlapping events split
  into side-by-side lanes.
- A red line for the current time, plus night shading around sunrise/sunset when a location is
  configured, and a daily weather icon + high/low.
- One color per configured calendar — auto-assigned in order (cycled if you add more than the
  palette covers) or pinned per calendar — so you can combine as many ICS feeds as you like and
  still tell them apart at a glance.
- **People**: tag specific events (by regex, across every calendar) with a person's own color
  and a small badge circle next to the event — e.g. give a kid their own color and initial,
  independent of which calendar their events land on, optionally renaming a class code to their
  actual name at the same time.
- Recurring events (`DAILY` / `WEEKLY` incl. `BYDAY` / `MONTHLY` / `YEARLY`, with `INTERVAL`,
  `COUNT`, `UNTIL`, `EXDATE`) expanded into the window, IANA-timezone aware.
- Language (day/month names, abbreviated on narrower layouts) auto-detected from your TRMNL
  account locale — any locale `Intl` supports, not a fixed list — with 24h/12h time format as
  a setting.
- Per-calendar **Exclude** regex to hide events matching a pattern (e.g. only show your kid's
  class among a whole school calendar's events).
- Graceful states: an `error` banner if every feed fails to fetch.

## Setup

1. In TRMNL: **Plugins → Private Plugins → New**, name it, **Save**.
2. Push this repo with `trmnlp push` (see below); it uploads `settings.yml`, the `.liquid`
   templates, and `transform.js` in one go.
3. Build your **Calendar Configuration** with the [Configuration Editor](#configuration-editor)
   (or hand-write the JSON — see its shape there) and paste it into that field. Then fill in the
   plugin's remaining custom fields:
   - **Time Zone**: leave blank to use your TRMNL account's own time zone, or set one explicitly.
   - **Time Format**: 24-hour or 12-hour (AM/PM).
   - **Location**: search a place or enter coordinates, for sunrise/sunset and daily weather.
     Leave blank to hide sun times and weather, and emphasize hours by meetings alone.
   - **Temperature Unit**: Celsius or Fahrenheit (requires Location above).
   - **Days to Show**: 1, 2, 3, 5 days, or a full week.
   - **Title Bar**: off by default, shows this plugin instance's name across the top.

## Configuration Editor

**[excusemi.github.io/trmnl-daylight-ics-calendar-plugin/tools/config-editor.html](https://excusemi.github.io/trmnl-daylight-ics-calendar-plugin/tools/config-editor.html)**
— a static page (`tools/config-editor.html`, served via GitHub Pages) for building the Calendar
Configuration field visually instead of hand-writing JSON: add calendars and people through a
form, test against real ICS data (direct fetch when the host allows CORS, or paste the `.ics`
text otherwise — a private calendar URL is never routed through a third-party proxy), and
preview the actual colors/badges using TRMNL's real CSS classes. Copy the generated JSON into
the plugin's Calendar Configuration field when you're happy with it.

The JSON shape it produces:

```json
{
  "calendars": [
    { "url": "https://cloud.example.com/family.ics", "color": "pink" },
    { "url": "https://cloud.example.com/school.ics", "exclude": "\\bL[1345]\\b" }
  ],
  "people": [
    { "name": "Aiko", "match": "\\bL6\\b", "color": "pink", "badge": "A" }
  ]
}
```

- `calendars[].url` — required. Any ICS source works, including Nextcloud, Google Calendar,
  Outlook, and Apple Calendar, all of which have a private/secret ICS link tucked away in their
  calendar settings. `webcal://` links are handled automatically.
- `calendars[].color` — optional, one of `red` `orange` `yellow` `lime` `green` `cyan` `blue`
  `violet` `purple` `pink`. Pins that calendar's color instead of auto-assigning by position.
- `calendars[].exclude` — optional regex (case-insensitive). Matching events from *that*
  calendar are hidden entirely, before `people` ever sees them.
- `people[].name` + `people[].match` — required. Every surviving event from *any* calendar
  whose title matches `match` gets renamed to `name` (set `"rename": false` to tag/color
  without renaming).
- `people[].color` / `people[].badge` — optional. Overrides that event's chip color and/or
  attaches a small badge circle (defaults to `name`'s first letter). Multiple people can match
  the same event; the last match in the array wins for color/badge, same as renaming.

## Local layout development

`run()` doesn't execute inside `trmnlp serve` (it targets `transform.js`, not the mock-data
Liquid preview), but you can iterate on the Liquid with mock data:

```bash
cd plugin
trmnlp serve      # http://127.0.0.1:4567
trmnlp build      # writes static HTML to _build/
trmnlp push       # uploads settings.yml + src/* to the TRMNL plugin
```

Mock data lives in `plugin/.trmnlp.yml` and mirrors the shape `layoutNative()` returns; to
exercise `run()`/`transform.js` itself against real data, use the
[Configuration Editor](#configuration-editor) instead — it loads and runs the exact same file.

## Files

| Path | Purpose |
|------|---------|
| `plugin/src/transform.js` | Serverless code: fetch ICS, expand recurrences, compute layout, fetch sun times. Runs on TRMNL (Node) and in `tools/config-editor.html` (browser) unmodified. |
| `plugin/src/shared.liquid` | The `main` template for all four view sizes (`full`/`half_*`/`quadrant`) |
| `plugin/src/settings.yml` | Custom fields (Calendar Configuration, time zone, time format, location, days to show, title bar) |
| `plugin/.trmnlp.yml` | Local mock data for `trmnlp serve` |
| `tools/config-editor.html` | Standalone config builder + real-data tester — see above |

## Notes & limits

- The Serverless VM allows **128 MB / 5 s**; parsing is pure JS (no npm packages guaranteed in
  TRMNL's sandbox — only global `fetch()`) and bounded to the configured day window. Sunrise/
  sunset and weather lookups (Open-Meteo) are best-effort with short timeouts; a slow/failed
  lookup just omits sun times and weather rather than breaking the calendar.
- Timezone conversion is hand-rolled against `Intl.DateTimeFormat`'s offset data (no IANA
  tzdata package needed, unlike Python) — accurate outside the ambiguous/skipped hour of a DST
  transition itself, an inherent edge case for any zone conversion without full disambiguation
  rules.
- Modified single instances of a recurring series (`RECURRENCE-ID` overrides) and `VTIMEZONE`
  definitions with non-IANA `TZID`s are not fully resolved; standard IANA zone names work.
