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
- **Categories**: every event gets a small color "meaning" bar down its left edge — a darker
  shade of its own color by default, or a Category's own color when one matches (by regex,
  across every calendar, independent of People). A category can also swap the badge circle for
  an icon (up to two, e.g. a briefcase + a house for "Work From Home") — reused from
  [Google's Material Symbols](https://fonts.google.com/icons) by plain name, searchable live in
  the [Configuration Editor](#configuration-editor); a custom image URL works too.
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
   - **Title Bar**: off by default, shows this plugin instance's name across the top.

## Configuration Editor

**[excusemi.github.io/trmnl-daylight-ics-calendar-plugin/tools/config-editor.html](https://excusemi.github.io/trmnl-daylight-ics-calendar-plugin/tools/config-editor.html)**
— a static page (`tools/config-editor.html`, served via GitHub Pages) for building the Calendar
Configuration field visually instead of hand-writing JSON: add calendars, people, and categories
through a form (categories' icons are searchable live against
[Google's Material Symbols](https://fonts.google.com/icons), no spelling guesses needed), add a
public holiday calendar for your country in one click, test against real ICS data (direct fetch
when the host allows CORS, or paste the `.ics` text otherwise — a private calendar URL is never
routed through a third-party proxy), and preview the actual colors/badges/icons using TRMNL's
real CSS classes. Copy the generated JSON into the plugin's Calendar Configuration field when
you're happy with it.

The JSON shape it produces:

```json
{
  "calendars": [
    { "url": "https://cloud.example.com/family.ics", "color": "pink" },
    {
      "url": "https://cloud.example.com/school.ics",
      "exclude": "\\bL[1345]\\b",
      "personRules": [{ "match": "\\bL6\\b", "person": "Aiko" }]
    }
  ],
  "people": [
    { "name": "Aiko", "color": "pink", "badge": "A" }
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
  `violet` `purple` `pink`, or an explicit `gray-10`..`gray-70` shade. Pins that calendar's color
  instead of auto-assigning by position.
- `calendars[].icon` — optional, same shape as `categories[].icon` below. A default icon for
  every event on that calendar; a matching Category's own icon still wins over this. What the
  Configuration Editor's "Add public holidays" picker sets, for instance — the plugin has no
  built-in notion of holidays, that button just fills in a normal calendar entry.
- `calendars[].exclude` — optional regex, or array of them (case-insensitive). Matching events
  from *that* calendar are hidden entirely, before `people`/`categories` ever see them.
- `calendars[].personRules` — optional array of `{ match, person, rename }`, checked in order
  against every surviving event on *that* calendar. `person` names who it belongs to (doesn't
  need to already exist in `people[]`, but only a declared one contributes color/badge);
  `rename` (default `true`) controls whether the matched text is replaced with `person`'s name.
- `calendars[].defaultPerson` — optional, applied when no `personRules` matched.
- `people[].name` — required, the lookup key `personRules[].person`/`defaultPerson` reference.
  `people[].color` / `people[].badge` — optional; overrides that event's chip color and/or
  attaches a small badge circle (defaults to `name`'s first letter).
- `categories[].match` — required, a regex or array of them (case-insensitive). Unlike
  `people`/`personRules`, a category isn't scoped to one calendar — it's tested against every
  surviving event's title, from any calendar, in array order (later matches win for color/icon).
- `categories[].color` — optional, overrides the event's calendar/person color (a category wins
  over both — it's the most specific signal). Every event always gets a left-edge color bar; a
  matched category's color applies there too, independent of the chip's own fill color.
- `categories[].icon` — optional, a [Material Symbols](https://fonts.google.com/icons) name
  (e.g. `"cake"`) or a custom image URL, or an array of up to two of either (rendered as two
  small overlapping badge circles, e.g. `["work", "home"]`). Replaces the person-badge letter in
  the same corner slot.

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
