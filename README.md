# TRMNL: Family Calendar

A [TRMNL](https://usetrmnl.com) private plugin that shows 1 to 3 days of any ICS calendar
feed as a time-grid, with sunrise/sunset and daily weather on the timeline. The grid auto-scales
so the hours that matter (daylight and your meetings) get more room and quiet hours shrink out
of the way, with no fixed "business hours" window to configure.

The plugin itself runs entirely on TRMNL
**[Serverless](https://help.trmnl.com/en/articles/14130649-serverless)** — no server involved in
actually rendering your calendar. `plugin/src/transform.js`'s `run()` fetches the ICS link(s),
expands recurring events for the window, and returns a pre-computed native layout
(percent-of-screen heights) to the Liquid template. The same file, unmodified, also runs in a
plain browser tab — see [Configuration Editor](#configuration-editor) below.

The [Configuration Editor](#configuration-editor) itself is a plain static page hosted on
[GitHub Pages](https://excusemi.github.io/trmnl-family-calendar/tools/config-editor.html) — no
backend involved just to load it. A small self-hosted [`backend/`](#backend) exists only to
proxy CORS-blocked ICS fetches the editor makes while you're testing a feed — see
[Backend](#backend) below; it's optional infrastructure for building your config, not something
the plugin depends on at render time.

## What it shows

- 1 to 3 day columns (your choice), drawn as a real hour-grid (not an image), with daylight and
  meeting hours automatically given more vertical space than the quiet hours around them.
- All-day events as chips, timed events as blocks sized by duration, overlapping events split
  into side-by-side lanes.
- A red line for the current time, plus night shading around sunrise/sunset when a location is
  configured, and a daily weather icon + high/low.
- One color per configured calendar — auto-assigned in order (cycled if you add more than the
  palette covers) or pinned per calendar — so you can combine as many ICS feeds as you like and
  still tell them apart at a glance.
- **People**: tag specific events (by regex, across every calendar) with a person's own color —
  e.g. give a kid their own color, independent of which calendar their events land on — optionally
  renaming a class code to their actual name at the same time. Every distinct person with anything
  anywhere in the visible range also gets one small badge in the header's own corner (full view
  only) — a shared "who has something going on" strip, not repeated on every one of their events —
  showing their initial. A shared event can tag more than one person at once (e.g. a family trip).
- **Public holidays**: the Configuration Editor has a one-click "Add public holidays" picker (50
  countries) that adds a real Google-hosted holiday ICS feed as a normal calendar, with a color
  pre-filled — nothing holiday-specific in the plugin itself, it's just a calendar entry.
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
   - **Days to Show**: 1, 2, or 3 days. Only the full 800x480 ("OG") layout actually honors
     this — the quadrant/half-horizontal/half-vertical layouts are narrow or short enough that
     more than one day column stops being legible, so those three always show just today,
     regardless of what's set here.

## Try it with the demo calendar

No calendar of your own handy, or just want to see a genuinely busy grid (overlapping events,
multi-day banners, recurring classes, a couple of kids each with their own color) before wiring
up your real one? Paste [`demo-config.json`](demo-config.json) straight into the plugin's
Calendar Configuration field as-is — it's a complete, working config, not a fragment to edit
first. It points at a small fictional family (parents Alex/Jordan, kids Mia/Leo — nobody real)
spread across a few ICS feeds this repo hosts directly at
[`demo/*.ics`](demo/) (via raw.githubusercontent.com — plain static files, no backend
involved), every event `RRULE`-recurring (weekly or yearly) so it stays "today, busy"
regardless of when you actually load it, plus the same public-Google-holiday calendar the
Configuration Editor's own "Add public holidays" picker would add. It's also how this project's
own layout work gets tested end to end — Mia's and Leo's Thursday "Gymnastics" deliberately land
at the exact same time, so the grid always has at least one genuinely overlapping pair of events
to check, and the School feed carries the same class-code style
(`exclude`/`personRules`/renaming) the placeholder example below demonstrates, with real matching
and non-matching classes side by side.

## Configuration Editor

**[excusemi.github.io/trmnl-family-calendar/tools/config-editor.html](https://excusemi.github.io/trmnl-family-calendar/tools/config-editor.html)**
— `tools/config-editor.html`, a plain static page served straight from GitHub Pages (its
`<script src="../plugin/src/transform.js">` resolves against the same repo Pages is already
serving — nothing to build or copy) for building the Calendar Configuration field visually
instead of hand-writing JSON: add calendars and people through a
form, add a public holiday calendar for your country in one click, test against real ICS data
(direct fetch when the host allows CORS, automatically falling back to [the backend](#backend)'s
`/ics-proxy` — which fetches server-side, where CORS doesn't apply, same as TRMNL's own render
pipeline already does — and only then to pasting the `.ics` text by hand; a private calendar URL
is never routed through any *third-party* proxy), and preview the actual colors using TRMNL's
real CSS classes. Copy the generated JSON into the plugin's Calendar Configuration field when
you're happy with it.

For the full field-by-field reference see [CONFIG.md](CONFIG.md); having an LLM write the JSON
for you instead works too — point it at [LLM.md](LLM.md), a compact version of the same schema
sized for that.

The JSON shape it produces:

```json
{
  "calendars": [
    { "url": "https://cloud.example.com/family.ics", "color": "pink" },
    {
      "url": "https://cloud.example.com/school.ics",
      "exclude": "\\bL[1345]\\b",
      "personRules": [{ "match": "\\bL6\\b", "person": "Alex" }]
    }
  ],
  "people": [
    { "name": "Alex", "color": "pink", "badge": "A" }
  ]
}
```

- `calendars[].url` — required. Any ICS source works, including Nextcloud, Google Calendar,
  Outlook, and Apple Calendar, all of which have a private/secret ICS link tucked away in their
  calendar settings. `webcal://` links are handled automatically.
- `calendars[].color` — optional, one of `red` `orange` `yellow` `lime` `green` `cyan` `blue`
  `violet` `purple` `pink`, an explicit `gray-10`..`gray-75` shade, or literal `black`/`white`.
  Pins that calendar's color instead of auto-assigning by position. What the Configuration
  Editor's "Add public holidays" picker sets, for instance — the plugin has no built-in notion
  of holidays, that button just fills in a normal calendar entry.
- `calendars[].exclude` — optional regex, or array of them (case-insensitive). Matching events
  from *that* calendar are hidden entirely, before `people` ever sees them.
- `calendars[].personRules` — optional array of `{ match, person, rename }`, checked in order
  against every surviving event on *that* calendar. `person` names who it belongs to — one name,
  or an array of them for a shared event (e.g. `["Alex", "Jordan"]` for a family trip); doesn't
  need to already exist in `people[]`, but only a declared name contributes a badge. `rename`
  (default `true`) controls whether the matched text is replaced with the name(s), joined with
  " & " when there's more than one.
- `calendars[].defaultPerson` — optional, applied when no `personRules` matched. Same shape as
  `personRules[].person` above (one name or an array).
- `people[].name` — required, the lookup key `personRules[].person`/`defaultPerson` reference.
  `people[].color` — optional; overrides that event's chip color. `people[].badge` — optional, a
  short label (defaults to the name's first letter) shown in the header's own small per-person
  badge (full view only — see People above — never repeated per event).

## Backend

`backend/` is a small self-hosted Quart service (Redis) with exactly one real job — the
[Configuration Editor](#configuration-editor) itself and the demo calendars are both plain
static files served directly from GitHub (Pages and raw.githubusercontent.com respectively, see
above), not through this backend, and the plugin itself never talks to it at render time either:

- **`GET /ics-proxy?url=...`** — fetches a calendar feed server-side and returns the raw text
  with permissive CORS headers, so the editor can test a real feed that blocks direct browser
  fetches (most calendar hosts do) without you having to paste the `.ics` content by hand. SSRF-
  guarded (only public http(s) hosts, redirects re-validated) since it's an internet-facing
  "fetch this URL for me" endpoint.

The ICS proxy sits behind the same tiered access control TRMNL backends in this account use
(`ACCESS_MODE=rate_limited` by default — TRMNL's own IPs unrestricted, everyone else, including
your own browser using the editor, rate limited rather than blocked outright).

```bash
cp .env.example .env   # fill in a real Redis password
docker compose up -d --build
```

See `.env.example` for every setting (rate-limit window, etc.).

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
| `plugin/src/settings.yml` | Custom fields (Calendar Configuration, time zone, time format, location, days to show) |
| `plugin/.trmnlp.yml` | Local mock data for `trmnlp serve` |
| `tools/config-editor.html` | Standalone config builder + real-data tester — see above; served as a static page by GitHub Pages |
| `demo/*.ics` | Demo calendars — see "Try it with the demo calendar" above; served as static files via raw.githubusercontent.com |
| `backend/` | CORS-free ICS test proxy only — see [Backend](#backend) |

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
