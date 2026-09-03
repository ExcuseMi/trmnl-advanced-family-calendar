# TRMNL: Advanced Family Calendar

A [TRMNL](https://usetrmnl.com) private plugin that shows 1 day to a week of any ICS calendar
feed as a time-grid, with sunrise/sunset and daily weather on the timeline. The grid auto-scales
so the hours that matter (daylight and your meetings) get more room and quiet hours shrink out
of the way, with no fixed "business hours" window to configure.

The plugin itself runs entirely on TRMNL
**[Serverless](https://help.trmnl.com/en/articles/14130649-serverless)** — no server involved in
actually rendering your calendar. `plugin/src/transform.js`'s `run()` fetches the ICS link(s),
expands recurring events for the window, and returns a pre-computed native layout
(percent-of-screen heights) to the Liquid template. The same file, unmodified, also runs in a
plain browser tab — see [Configuration Editor](#configuration-editor) below.

A small self-hosted [`backend/`](#backend) serves that editor itself, proxies CORS-blocked ICS
fetches for it, and hosts person/category photos reliably — see [Backend](#backend) below; it's
optional infrastructure for building your config, not something the plugin depends on at render
time.

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
  actual name at the same time. A photo/avatar URL can replace that badge circle's letter with
  their actual picture instead, and a shared event can tag more than one person at once (e.g. a
  family trip) — every matched, declared person gets their own badge, up to the 2 slots
  available.
- **Categories**: every event gets a small color "meaning" rail down its left edge — a darker
  shade of its own color by default, or a Category's own color when one matches (by regex,
  across every calendar, independent of People). That rail also hosts up to 2 badge circles: a
  Category's own icon (reused from [Google's Material Symbols](https://fonts.google.com/icons)
  or [Tabler Icons](https://tabler.io/icons) — the latter for sport/activity coverage Material
  Symbols lacks, like yoga or pilates — by plain name, searchable live in the
  [Configuration Editor](#configuration-editor); a custom image URL works too) takes the front
  slot(s), and any matched person's badge/photo fills whatever's left. A Category can also be
  set to show as just that badge — icon and/or photo filling the whole chip, no title text — for
  the kind of recurring event an icon alone already says everything about.
- **Public holidays**: the Configuration Editor has a one-click "Add public holidays" picker (50
  countries) that adds a real Google-hosted holiday ICS feed as a normal calendar, with color and
  a flag icon pre-filled — nothing holiday-specific in the plugin itself, it's just a calendar
  with a default icon (`calendars[].icon`, same mechanism as `categories[].icon`) that a matching
  Category still overrides.
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

## Configuration Editor

**[trmnl.bettens.dev/advanced-family-calendar](https://trmnl.bettens.dev/advanced-family-calendar/)**
— `tools/config-editor.html`, served by [the backend](#backend) itself (same origin as
`/ics-proxy` and `/images`, so calls to those never need CORS at all — only the third-party
calendar host being tested does, which is exactly what `/ics-proxy` routes around; also mirrored,
unmodified, on [GitHub Pages](https://excusemi.github.io/trmnl-advanced-family-calendar/tools/config-editor.html))
for building the Calendar
Configuration field visually instead of hand-writing JSON: add calendars, people, and categories
through a form (categories' icons are searchable live against both
[Google's Material Symbols](https://fonts.google.com/icons) and [Tabler Icons](https://tabler.io/icons),
no spelling guesses needed, or upload your own photo — see [Backend](#backend)), add a
public holiday calendar for your country in one click, test against real ICS data (direct fetch
when the host allows CORS, automatically falling back to this plugin's own backend — which fetches
server-side, where CORS doesn't apply, same as TRMNL's own render pipeline already does — and
only then to pasting the `.ics` text by hand; a private calendar URL is never routed through any
*third-party* proxy), and
preview the actual colors/badges/icons using TRMNL's real CSS classes. Copy the generated JSON
into the plugin's Calendar Configuration field when
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
  ],
  "categories": [
    { "name": "Birthday", "match": "birthday|verjaardag", "icon": "cake" },
    { "name": "Work From Home", "match": "\\bWFH\\b", "icon": ["work", "home"] }
  ]
}
```

- `calendars[].url` — required. Any ICS source works, including Nextcloud, Google Calendar,
  Outlook, and Apple Calendar, all of which have a private/secret ICS link tucked away in their
  calendar settings. `webcal://` links are handled automatically.
- `calendars[].color` — optional, one of `red` `orange` `yellow` `lime` `green` `cyan` `blue`
  `violet` `purple` `pink`, an explicit `gray-10`..`gray-75` shade, or literal `black`/`white`.
  Pins that calendar's color instead of auto-assigning by position.
- `calendars[].icon` — optional, same shape as `categories[].icon` below. A default icon for
  every event on that calendar; a matching Category's own icon still wins over this. What the
  Configuration Editor's "Add public holidays" picker sets, for instance — the plugin has no
  built-in notion of holidays, that button just fills in a normal calendar entry.
- `calendars[].exclude` — optional regex, or array of them (case-insensitive). Matching events
  from *that* calendar are hidden entirely, before `people`/`categories` ever see them.
- `calendars[].personRules` — optional array of `{ match, person, rename }`, checked in order
  against every surviving event on *that* calendar. `person` names who it belongs to — one name,
  or an array of them for a shared event (e.g. `["Alex", "Jordan"]` for a family trip); doesn't
  need to already exist in `people[]`, but only a declared name contributes a badge. `rename`
  (default `true`) controls whether the matched text is replaced with the name(s), joined with
  " & " when there's more than one.
- `calendars[].defaultPerson` — optional, applied when no `personRules` matched. Same shape as
  `personRules[].person` above (one name or an array).
- `people[].name` — required, the lookup key `personRules[].person`/`defaultPerson` reference.
  `people[].color` / `people[].badge` — optional; overrides that event's chip color and/or
  attaches a small badge circle (defaults to `name`'s first letter). `people[].image` —
  optional, a direct photo/avatar URL shown in that same circle instead of the badge letter
  (a matched category icon still takes the slot in front of it, same as with a plain badge; a
  photo wins over the letter if both are set).
- `categories[].match` — required, a regex or array of them (case-insensitive). Unlike
  `people`/`personRules`, a category isn't scoped to one calendar — it's tested against every
  surviving event's title, from any calendar, in array order (later matches win for color/icon).
- `categories[].color` — optional, overrides the event's calendar/person color (a category wins
  over both — it's the most specific signal). Every event always gets a left-edge "meaning" rail;
  a matched category's color applies there too, independent of the chip's own fill color.
- `categories[].icon` — optional, a [Material Symbols](https://fonts.google.com/icons) name
  (e.g. `"cake"`), a [Tabler Icons](https://tabler.io/icons) name prefixed `tabler:` (e.g.
  `"tabler:yoga"` — a second set for the sport/activity coverage Material Symbols lacks), or a
  custom image URL, or an array of up to two of any of those (rendered as two small circles
  stacked in that left rail, e.g. `["work", "home"]`). Takes the rail's front slot(s); any
  matched person's badge/photo fills whatever's left, up to 2 slots total.
- `categories[].display` — optional, `"image"` drops the title text entirely and lets whatever's
  in the rail (icon and/or badge/photo) fill the whole chip instead — for the kind of recurring
  event an icon alone already says everything about. Falls back to the normal text chip if
  nothing real ended up in a slot.
- `categories[].calendars` / `categories[].excludeCalendars` — optional, both by
  `calendars[].id` (or `.url` for a calendar with no id). `calendars` is a whitelist (only those
  calendars); `excludeCalendars` is a blacklist (every calendar except those). Omit both for the
  default — every calendar. Handy for a category that should apply broadly but not to one
  calendar that's already "someone's own" — e.g. a global "Work" category kept off your own
  personal calendar so your own name/badge shows through there instead.

## Backend

`backend/` is a small self-hosted Quart service (Postgres + Redis) that exists for the
[Configuration Editor](#configuration-editor) — the plugin itself never talks to it at render
time:

- **`GET /`** and **`GET /tools/config-editor.html`** — serve the editor itself (Docker build
  copies `tools/config-editor.html` and `plugin/src/transform.js` in, at the same relative paths
  they have in the repo, so the page's own `<script src="../plugin/src/transform.js">` resolves
  unchanged). Same-origin means its calls to the two endpoints below never trigger a CORS
  preflight against this backend at all.
- **`GET /ics-proxy?url=...`** — fetches a calendar feed server-side and returns the raw text
  with permissive CORS headers, so the editor can test a real feed that blocks direct browser
  fetches (most calendar hosts do) without you having to paste the `.ics` content by hand. SSRF-
  guarded (only public http(s) hosts, redirects re-validated) since it's an internet-facing
  "fetch this URL for me" endpoint.
- **`POST /images`** / **`GET /images/<id>`** — upload a photo for a person or category icon;
  it's center-cropped to a square and downscaled to at most 512×512, stored in Postgres, and
  served back at a stable URL. This exists because several public image hosts (imgur confirmed)
  block the kind of non-browser, server-side hotlinking TRMNL's own render pipeline does when it
  fetches `people[].image`/`categories[].icon` — self-hosting sidesteps that outright.

Both the upload endpoint and the ICS proxy sit behind the same tiered access control TRMNL
backends in this account use (`ACCESS_MODE=rate_limited` by default — TRMNL's own IPs
unrestricted, everyone else, including your own browser using the editor, rate limited rather
than blocked outright). `GET /images/<id>` itself is deliberately unrestricted — that's the URL
TRMNL's render pipeline fetches on every refresh, so gating it the same way would just recreate
the hotlink-blocking problem this exists to solve.

```bash
cp .env.example .env   # fill in real Postgres/Redis passwords
docker compose up -d --build
```

See `.env.example` for every setting (rate-limit window, upload size caps, etc.).

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
| `tools/config-editor.html` | Standalone config builder + real-data tester — see above; served by both `backend/` and GitHub Pages |
| `backend/` | Serves the Configuration Editor + CORS-free ICS test proxy + photo upload/hosting — see [Backend](#backend) |

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
