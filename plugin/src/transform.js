// TRMNL Serverless — Daylight ICS Calendar (3-day time-grid + sunrise/sunset)
//
// This is the plugin's serverless code. `serverless_language: node` in settings.yml tells
// TRMNL to run it; `trmnlp push` uploads it like any other src file (no manual paste). Entry
// point is run(input); it computes a native TRMNL-framework layout (hour axis + day columns,
// events positioned by start time and sized by duration using h--[Ncqh] container-query
// heights) — real HTML/Liquid, not an image, so it renders crisply and fills any device
// (including the larger, portrait, 4-bit TRMNL X) via the framework's own responsive system
// instead of a fixed-aspect picture.
//
// No npm packages are guaranteed in the Serverless VM (only global fetch()), so the ICS
// parsing, RRULE expansion, and IANA-timezone math below are hand-rolled — same constraint
// Python had, which is what made this a mechanical, faithful port rather than a redesign.
// This same file also runs unmodified in a plain browser tab (see /tools/config-editor.html)
// since both environments provide global fetch() and Intl — that dual use is the whole
// reason this shipped as transform.js instead of staying transform.py.
// Budget on TRMNL: 128 MB / 5 s — everything is bounded to the render window.

const DEFAULT_DAYS = 3;
const DEFAULT_HOURS = { start: 7, end: 21 }; // Calendar Configuration's optional "hours" field
const WD_MAP = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };

// One color per configured calendar — cycled by position through the 10 chromatic hues (if
// more calendars than hues) unless a calendar pinned an explicit one, or a matching Person
// overrides it for a specific event (see applyCalendarPerson). A pinned color (calendar or
// person) can also be an explicit gray shade ("gray-10".."gray-70") instead of a hue — most
// real TRMNL devices are grayscale panels, not the color ones, so picking a gray directly
// (rather than a hue that just falls back to SOME gray automatically) gives real control over
// exactly how light/dark a calendar reads on those. Auto-cycling only ever picks a hue, never
// a gray, since the whole point of cycling is telling multiple calendars apart at a glance —
// gray shades are for a deliberate, single pinned choice.
//
// Chromatic hues render as real framework classes (bg--{hue}-65, checked against the live CSS
// at trmnl.com/css/latest/plugins.css) — on a grayscale panel they automatically fall back to
// distinct perceptually-appropriate gray shades, and render as actual color on a chromatic
// panel. Step 65 (of the framework's 10=darkest/75=lightest scale, which peaks in SATURATION
// around step 40-45 and only desaturates toward pastel above that) is light enough that solid
// black chip text reads clearly against all 10 at once. Gray shades span near-black to
// near-white though (bg--gray-10 is #111111, bg--gray-70 is #DDDDDD), so unlike the hues they
// DO need a real per-shade foreground decision — see foregroundFor.
const HUES = ["blue", "green", "orange", "purple", "red", "cyan", "pink", "lime", "violet", "yellow"];
// 10..75 in steps of 5 is the framework's full extended-grayscale range (confirmed against the
// live compiled CSS) — this used to stop at 70, one step short of the framework's own lightest
// defined shade. "black"/"white" are a separate pair of real framework classes (bg--black/
// bg--white, already used all over this file for badges/pills) rather than an extreme step of
// this numeric scale — gray-10 is #111111 and gray-75 a light gray, not literal 0/255 — so
// they're handled as their own two-value set below, not folded into GRAY_SHADES.
const GRAY_SHADES = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75];
const BLACK_WHITE = ["black", "white"];

// This plugin has no notion of "which device" at all — it only ever reads/renders whatever
// `color` values are already sitting in the config (pinned, or left blank to auto-cycle the
// 10 named hues by position, same as always). Picking sensible colors for a specific panel
// (e.g. a grayscale TRMNL OG/X, or the 4-ink Black/White/Red/Yellow TRMNL Display Color,
// which can't render the other hues as genuinely distinct colors) is entirely
// /tools/config-editor.html's job at config-BUILD time — it resolves and writes real `color`
// values into the JSON you paste in here, so this file stays simple and hardware-agnostic.

function isValidColor(v) {
  if (HUES.includes(v) || BLACK_WHITE.includes(v)) return true;
  const m = /^gray-(\d+)$/.exec(v);
  return !!m && GRAY_SHADES.includes(parseInt(m[1], 10));
}

// The bg-- class suffix for a validated color string — chromatic hues get the fixed pastel
// step baked on, a gray-N value already names its own exact shade.
function colorClass(color) {
  return HUES.includes(color) ? color + "-65" : color;
}

// Solid black for every chromatic hue (see the step-65 rationale above) and for any badge —
// but a gray shade's own lightness decides its foreground: measured against the real hex
// values (gray-10 #111111 ... gray-70 #DDDDDD), black stops being legible below gray-45
// (#888888, relative luminance ~136 of 255 — the last step light enough for black text; 40's
// #777777 (~119) is not).
function foregroundFor(color) {
  if (color === "black") return "white";
  if (color === "white") return "black";
  const m = /^gray-(\d+)$/.exec(color);
  if (!m) return "black";
  return parseInt(m[1], 10) < 45 ? "white" : "black";
}

// The accent-bar color for an event: a darker/more-saturated step of the SAME color family as
// its fill (colorClass), so every event gets a two-tone card by default (light fill, darker
// bar) even with no Category configured — see the "accent bar" markup in shared.liquid. Step
// 45 for a chromatic hue is the framework's peak-saturation step (colorClass uses 65, a lighter
// pastel step for the fill) — same hue, visibly darker. A pinned gray shade has no separate
// "saturated" step, so this just steps two positions darker within GRAY_SHADES instead (clamped
// at the darkest, gray-10).
function accentColor(color) {
  if (HUES.includes(color)) return color + "-45";
  // "black" has nowhere darker to step to, same as gray-10 below (index already clamped to 0)
  // — the bar and fill end up the same color, which reads as "no separate accent" rather than
  // a bug; that's an acceptable ceiling for the single darkest option. "white" is the opposite
  // problem — gray-N's darker-by-two-steps logic doesn't apply (it isn't in GRAY_SHADES), and
  // returning "white" unchanged would make the bar invisible against its own fill, unlike every
  // other color here. gray-30 gives a genuinely visible dark stripe against a white card.
  if (color === "black") return "black";
  if (color === "white") return "gray-30";
  const m = /^gray-(\d+)$/.exec(color);
  if (m) {
    const idx = GRAY_SHADES.indexOf(parseInt(m[1], 10));
    const steppedIdx = idx === -1 ? 0 : Math.max(0, idx - 2);
    return "gray-" + GRAY_SHADES[steppedIdx];
  }
  return color;
}

// ---------------------------------------------------------------------------- category icons
//
// Category icons reference an icon by plain name, same lookup /tools/config-editor.html's
// search picker uses, from one of two sets:
//   - Google's Material Symbols (Outlined) — https://fonts.google.com/icons — the default,
//     a bare name with no prefix, e.g. "cake", "flight".
//   - Tabler Icons (Outline) — https://tabler.io/icons — prefixed "tabler:", e.g.
//     "tabler:yoga". Added for the sport/activity coverage Material Symbols lacks (no
//     "pilates"/"yoga"/"meditation" there at all, see resolveIcon below) — a second bare-name
//     set (rather than folding it into the same lookup) since both sets reuse short generic
//     words ("home", "run") and a bare name staying Material Symbols keeps every existing
//     config's meaning unchanged.
// resolveIcon() just builds a URL to the set's own hosted static SVG for that name — the exact
// same "just a URL, no local copy" pattern day.icon already uses above for weather icons — so
// an unrecognized/misspelled name just fails to load the image rather than breaking the
// render. A plain http(s) URL works too, for a self-hosted/custom icon — this is how a Tabler
// icon reached this plugin before the "tabler:" prefix existed, and still works identically
// for any OTHER icon source (a custom image, a different icon set entirely). `icon` accepts
// either one name/URL or an array of up to two — e.g. ["work", "home"] for a "Work From Home"
// category — rendered as two small overlapping badge circles instead of one (see
// shared.liquid).
//
// Returns { first, second } (second omitted if there's only one) or null — a plain object with
// named keys, deliberately NOT a JS array. TRMNL's serverless->Liquid bridge is a black box from
// here (trmnlp build/serve never runs this file at all — see topics/testing.md — so a JS array
// surviving that specific bridge intact was never actually verified against the real pipeline,
// only assumed from local mocks shaped to already match). Liquid's own dot-notation property
// access (`event.icon.first`) is unambiguous across Liquid implementations; numeric bracket
// indexing on an array-shaped merge variable (`event.icon[0]`) is exactly the kind of thing that
// can silently come through empty on one bridge and not another. Named keys sidestep the
// question entirely instead of relying on it.
const MATERIAL_ICON_BASE = "https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/";
const MATERIAL_ICON_SUFFIX = "/default/24px.svg";
// Pinned to a specific published version (not @latest): a name that resolves today should keep
// resolving the same way later, even if a future Tabler major renames/drops icons — same
// reasoning as pinning any other third-party dependency. Bump by hand if a newer icon is
// wanted (see /tools/config-editor.html's own copy of this constant, kept in sync by hand).
const TABLER_ICON_BASE = "https://cdn.jsdelivr.net/npm/@tabler/icons@3.46.0/icons/outline/";
const TABLER_ICON_SUFFIX = ".svg";
const MAX_CATEGORY_ICONS = 2;

function resolveIcon(ref) {
  const list = Array.isArray(ref) ? ref : [ref];
  const urls = [];
  for (const item of list) {
    if (urls.length >= MAX_CATEGORY_ICONS) break;
    if (typeof item !== "string") continue;
    const v = item.trim();
    if (!v) continue;
    if (/^https?:\/\//i.test(v)) { urls.push(v); continue; }
    const tablerMatch = /^tabler:(.+)$/i.exec(v);
    if (tablerMatch) {
      // Tabler names are dash-separated (e.g. "bike-path", "24-hours") — a different
      // sanitize charset than Material Symbols' underscore-separated names below.
      const tname = tablerMatch[1].toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (tname) urls.push(TABLER_ICON_BASE + tname + TABLER_ICON_SUFFIX);
      continue;
    }
    const name = v.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (name) urls.push(MATERIAL_ICON_BASE + name + MATERIAL_ICON_SUFFIX);
  }
  if (!urls.length) return null;
  const result = { first: urls[0] };
  if (urls[1]) result.second = urls[1];
  return result;
}

async function run(input) {
  const cfg = parseConfig(cf(input, "calendars"));
  const calendars = cfg.calendars;
  const people = cfg.people;
  const categories = cfg.categories;
  const calendarColors = calendars.map((c) => c.color);
  const locale = localeOf(input);
  const tzname = cf(input, "time_zone").trim() || userTz(input) || "UTC";
  const is12h = cf(input, "time_format").trim().toLowerCase() === "12h";
  const location = cf(input, "lat_lon");
  const fahrenheit = cf(input, "temperature_unit").trim().toLowerCase() === "fahrenheit";
  const daysN = toInt(cf(input, "view_days"), DEFAULT_DAYS, 1, 7);

  const tz = resolveTz(tzname, input);

  if (!calendars.length) {
    return emptyResult(tzname, tz, locale, daysN, "No ICS URL configured");
  }

  const nowEpoch = Date.now();
  const nowCivil = fromEpoch(nowEpoch, tz);
  const winSCivil = { y: nowCivil.y, mo: nowCivil.mo, d: nowCivil.d };
  const winSEpoch = zonedTimeToUtc(winSCivil.y, winSCivil.mo, winSCivil.d, 0, 0, 0, tz);
  const winEDate = addCivilDays({ ...winSCivil, h: 0, mi: 0, s: 0 }, daysN);
  const winEEpoch = zonedTimeToUtc(winEDate.y, winEDate.mo, winEDate.d, 0, 0, 0, tz);

  const occ = [];
  const errors = [];
  for (let calIdx = 0; calIdx < calendars.length; calIdx++) {
    let url = calendars[calIdx].url;
    if (url.startsWith("webcal://")) url = "https://" + url.slice("webcal://".length);
    try {
      // NOTE: a custom User-Agent is settable in Node (TRMNL's serverless sandbox) but is a
      // forbidden header in browser fetch() — silently dropped there rather than erroring,
      // which is fine, it's just politeness, nothing here depends on it being sent.
      const resp = await fetchWithTimeout(url, 4000, { headers: { "User-Agent": "TRMNL-ICS-Calendar" } });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const text = await resp.text();
      collectIcs(text, tz, winSEpoch, winEEpoch, occ, calIdx);
    } catch (exc) {
      errors.push(String((exc && exc.message) || exc));
    }
  }

  // Only surface an error if every feed failed; partial results still render.
  let err = null;
  if (errors.length && !occ.length) err = "Fetch/parse failed: " + errors[0];

  // Exclude tested against the RAW title (before personRules renaming) so a rename can't
  // accidentally dodge or trigger an exclude rule by rewriting the very text it matches
  // against; personRules then run on whatever survives each calendar's own exclude pass.
  const filtered = occ.filter((e) => {
    const cal = calendars[e.calIdx];
    return !cal.exclude.some((rx) => rx.test(e.title));
  });
  for (const e of filtered) {
    const r = applyCalendarPerson(e.title, calendars[e.calIdx], people);
    e.title = r.title;
    e.hueOverride = r.hue;
    // Categories are matched against the FINAL (post-rename) title, by default across every
    // calendar (unless scoped — see categories[].calendars/excludeCalendars in parseConfig) —
    // a category's own color wins over a person's (more specific signal). Falls back to the
    // calendar's own default icon (calendars[].icon, e.g. a flag for a public holiday calendar
    // the Configuration Editor's country picker added) when no category matched — same "most
    // specific signal wins" precedence used for color throughout this file.
    const c = applyCategory(e.title, categories, e.calIdx);
    if (c.color) e.hueOverride = c.color;
    const catIcon = c.icon || calendars[e.calIdx].icon || null;

    // The badge rail (see shared.liquid) has exactly 2 slots, same budget as before this
    // supported more than one person or a real image mode. A category icon takes the front
    // slot(s) first (the more specific "what kind" signal) — one icon leaves a slot free, two
    // fill the rail outright — and person badges/photos ("whose") fill whatever's left, one
    // per matched+declared person, in personRules/defaultPerson order, silently dropping any
    // that don't fit rather than growing the rail unpredictably.
    const badges = [];
    if (catIcon) {
      badges.push({ kind: "icon", src: catIcon.first });
      if (catIcon.second) badges.push({ kind: "icon", src: catIcon.second });
    }
    for (const pb of r.badges) {
      if (badges.length >= 2) break;
      badges.push(pb);
    }
    e.badges = badges;
    // "image" display mode only actually takes effect once there's a real badge to show as
    // the image — a category set to image mode that matched an event with no icon and no
    // taggable person falls back to the normal text chip instead of rendering an empty rail.
    e.display = c.display === "image" && badges.length > 0 ? "image" : "text";
  }

  // Bucket occurrences into day columns, split into timed vs all-day.
  const rawDays = [];
  for (let i = 0; i < daysN; i++) {
    const d0Civil = addCivilDays({ ...winSCivil, h: 0, mi: 0, s: 0 }, i);
    const d0Epoch = zonedTimeToUtc(d0Civil.y, d0Civil.mo, d0Civil.d, 0, 0, 0, tz);
    const d1Civil = addCivilDays(d0Civil, 1);
    const d1Epoch = zonedTimeToUtc(d1Civil.y, d1Civil.mo, d1Civil.d, 0, 0, 0, tz);

    const timed = [];
    const allday = [];
    for (const e of filtered) {
      if (!(e.startEpoch < d1Epoch && e.endEpoch > d0Epoch)) continue;
      if (e.allDay || e.endEpoch - e.startEpoch >= 86400000) {
        allday.push(e);
      } else {
        const vs = Math.max(e.startEpoch, d0Epoch);
        const ve = Math.min(e.endEpoch, d1Epoch);
        timed.push({
          h0: (vs - d0Epoch) / 3600000,
          h1: (ve - d0Epoch) / 3600000,
          title: e.title,
          calIdx: e.calIdx,
          hueOverride: e.hueOverride,
          badges: e.badges,
          display: e.display,
          label: fmtTime(vs, tz, is12h) + "–" + fmtTime(ve, tz, is12h),
        });
      }
    }
    timed.sort((a, b) => a.h0 - b.h0);
    rawDays.push({
      label: dayLabel(d0Civil, locale),
      labelShort: dayLabelShort(d0Civil, locale),
      isToday: i === 0,
      timed,
      allday: allday.slice(0, 3).map((a) => ({
        title: a.title,
        hue: a.hueOverride || hueOf(a.calIdx, calendarColors),
        badges: a.badges,
        display: a.display,
        // Lets the template draw multi-day all-day events as one continuous banner (square
        // off the edge that's mid-span) instead of a separate fully-rounded pill repeating
        // in every day column it touches.
        continuesBefore: a.startEpoch < d0Epoch,
        continuesAfter: a.endEpoch > d1Epoch,
      })),
    });
  }

  // Fractional hour of "now" within today's column, e.g. 14:30 -> 14.5 — used to draw a
  // current-time marker. winSEpoch (today's midnight) is always "now" with the clock zeroed,
  // so this is just the elapsed time since then.
  const nowH = (nowEpoch - winSEpoch) / 3600000;
  const sky = await fetchSky(location, daysN, fahrenheit);
  rawDays.forEach((rd, i) => {
    rd.temp = sky.dailyTemps[i] || null;
    rd.icon = rd.temp ? dayIcon(sky.hourlyWeather[i]) : null;
  });

  // The shown range is the configured default hours (Calendar Configuration's "hours", see
  // parseConfig — 7-21 unless overridden), automatically widened to also cover sunrise, the
  // first/last meeting of the visible days, sunset, and the current hour, whichever push
  // earlier/later — so daylight hours, every actual event, and "now" are always visible,
  // never hidden along with the rest of an otherwise-empty hour. Floor the start / ceil the
  // end so a meeting, sunrise/sunset, or the current moment falling mid-hour still pulls its
  // whole hour in. Hours left outside this final range are hidden entirely (see
  // layoutNative) rather than shown compressed — by construction they contain neither the
  // default range nor any real event/sun mark nor the current time.
  //
  // nowH specifically: without it, hours are set to their configured default (e.g. 7-21) and
  // the current time simply falls outside that once it's later than the configured end (21:53
  // with hours 7-21, say) — the current hour's row, and the "now" marker that's positioned
  // relative to it, both silently disappear instead of the grid stretching to keep today
  // visible the same way it already does for a late sunset or a late meeting.
  const daySun = sky.sunMarks[0] || [];
  const sunriseMark = daySun.find((m) => m.kind === "sunrise");
  const sunsetMark = daySun.find((m) => m.kind === "sunset");
  const eventStarts = [];
  const eventEnds = [];
  for (const d of rawDays) {
    for (const e of d.timed) {
      eventStarts.push(e.h0);
      eventEnds.push(e.h1);
    }
  }
  const defaultHours = cfg.hours || DEFAULT_HOURS;
  const startCandidates = [defaultHours.start, sunriseMark ? sunriseMark.hour : null, nowH, ...eventStarts].filter((h) => h !== null && h !== undefined);
  const endCandidates = [defaultHours.end, sunsetMark ? sunsetMark.hour : null, nowH, ...eventEnds].filter((h) => h !== null && h !== undefined);
  const startH = Math.floor(Math.min(...startCandidates));
  let endH = Math.ceil(Math.max(...endCandidates));
  endH = Math.max(endH, startH + 1);

  const grid = layoutNative(rawDays, startH, endH, nowH, sky.sunMarks, sky.hourlyWeather, calendarColors);

  return Object.assign({}, grid, {
    generated_at: Math.floor(nowEpoch / 1000),
    tz: tzname,
    error: err,
    unavailable_label: unavailableText(locale),
    all_day_label: allDayText(locale),
    has_events: rawDays.some((d) => d.timed.length || d.allday.length),
    weather_error: sky.error,
  });
}

// ---------------------------------------------------------------- input helpers

function cf(input, key) {
  // Read a custom form field. Serverless exposes them both flat and nested.
  if (!input || typeof input !== "object") return "";
  if (typeof input[key] === "string") return input[key];
  try {
    const v = input.trmnl.plugin_settings.custom_fields_values[key];
    return typeof v === "string" ? v : "";
  } catch (e) {
    return "";
  }
}

function toInt(raw, def, lo, hi) {
  const f = parseFloat(String(raw).trim());
  if (!isFinite(f)) return def;
  return Math.max(lo, Math.min(hi, Math.trunc(f)));
}

function emptyResult(tzname, tz, locale, daysN, msg) {
  const nowEpoch = Date.now();
  const nowCivil = fromEpoch(nowEpoch, tz);
  const winSCivil = { y: nowCivil.y, mo: nowCivil.mo, d: nowCivil.d, h: 0, mi: 0, s: 0 };
  const days = [];
  for (let i = 0; i < daysN; i++) {
    const d0Civil = addCivilDays(winSCivil, i);
    days.push({
      label: dayLabel(d0Civil, locale),
      labelShort: dayLabelShort(d0Civil, locale),
      isToday: i === 0,
      timed: [],
      allday: [],
    });
  }
  const grid = layoutNative(days, 8, 22, null, null, null, null);
  return Object.assign({}, grid, {
    generated_at: Math.floor(nowEpoch / 1000),
    tz: tzname,
    error: msg,
    unavailable_label: unavailableText(locale),
    all_day_label: allDayText(locale),
    has_events: false,
    weather_error: null,
  });
}

// --------------------------------------------------------- calendar configuration (JSON)
//
// The "Calendar Configuration" field is one JSON object:
//   {
//     "hours": { "start": 7, "end": 21 },
//     "calendars": [
//       { "id": "Alex", "url": "https://.../alex.ics", "defaultPerson": "Alex" },
//       { "id": "School", "url": "https://.../school.ics", "exclude": "regex",
//         "personRules": [
//           { "match": "\\bL6\\b", "person": "Alex" },
//           { "match": "\\bL2\\b", "person": "Jordan" }
//         ] }
//     ],
//     "people": [
//       { "name": "Alex", "color": "pink", "badge": "K" },
//       { "name": "Jordan", "color": "blue" }
//     ]
//   }
// `hours` is optional (defaults to DEFAULT_HOURS, 7-21) — the default hour range to show.
// It's always widened to also cover sunrise, every actual event, and sunset, whichever push
// earlier/later, so nothing real ever gets hidden; hours left outside the final range are
// hidden entirely rather than shown compressed (see layoutNative).
// `people[]` holds ONLY formatting — `name` (required, also the lookup key), `color`
// (optional, one of HUES or "gray-10".."gray-70" in steps of 5), `badge` (optional short text
// for the small circle next to an event, defaults to `name`'s first letter), and `image`
// (optional http(s) URL to a photo/avatar — fills that same circle instead of the badge
// letter when set). It carries no matching logic: which events belong to a person is entirely
// a property of the CALENDAR they're on, via two mechanisms that combine per calendar:
//   - `calendars[].personRules`: an array of `{ match, person, rename }`. `match` (regex,
//     case-insensitive) is tested against every surviving event on THAT calendar, in array
//     order — a later rule's rename builds on an earlier one's output, and its color/badges
//     win if it also matches (last match wins, same as color pinning). `person` names who the
//     event belongs to (rename target text too) — either one name or an array of them (e.g.
//     `["Alex", "Jordan"]` for a shared event), joined with " & " when renaming. A name
//     doesn't need to already exist in `people[]`, but only a declared person contributes a
//     badge — an undeclared name still renames, just with no styling. `rename` (default true)
//     controls whether the matched text is actually replaced; set it false to tag/color
//     without renaming.
//   - `calendars[].defaultPerson`: a person name (or array of names, same as personRules[].
//     person above) applied when NO personRule on that calendar matched — for a calendar
//     that's already entirely one person's own (like a personal calendar per family member),
//     this avoids needing a `personRules` entry at all. Never overrides an actual personRules
//     match.
// `calendars[].id` is optional — a short label `personRules[].person`/`defaultPerson` values
// double as (see above); calendars are otherwise unrelated to it. `calendars[].color` is
// optional, one of HUES or "gray-10".."gray-70", pins that calendar's own default color
// instead of auto-cycling through the hues by position (a matched/defaulted person's color,
// when there is one, still wins over this).
// `calendars[].icon` is optional (see resolveIcon) — a default icon for every event on that
// calendar, same shape as categories[].icon (a Material Symbols name, a custom URL, or an
// array of up to two). A matched Category's own icon still wins over this — this is just the
// floor a whole calendar falls back to when nothing more specific claimed the badge slot. This
// plugin has no built-in notion of "holidays" — the Configuration Editor's country picker is
// just a convenience that adds a normal calendar entry pointing at a public Google-hosted
// holiday feed, with color/icon pre-filled; nothing here treats it specially.
// `calendars[].exclude` is optional — a regex, or an array of them (case-insensitive):
// matching ANY of them hides that event entirely, before personRules/defaultPerson ever see
// it, only from THAT calendar.
// Malformed JSON, or an entry missing its required field, is skipped rather than erroring
// the whole render — this is designed to be generated by /tools/config-editor.html, not
// necessarily hand-typed, so being forgiving of partial/in-progress edits matters more than
// strict validation.

function parseConfig(raw) {
  const empty = { calendars: [], people: {}, hours: null, categories: [] };
  if (typeof raw !== "string" || !raw.trim()) return empty;
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return empty;
  }
  if (!data || typeof data !== "object") return empty;

  // Optional top-level "hours": { "start": 7, "end": 21 } — the default hour range to show
  // (see DEFAULT_HOURS/run() for how it's widened to also cover real sun/event data, and
  // layoutNative for how hours left outside it end up hidden entirely). Malformed input
  // falls back to null here so run() applies DEFAULT_HOURS, same as omitting it.
  let hours = null;
  if (data.hours && typeof data.hours === "object") {
    const start = Math.trunc(Number(data.hours.start));
    const end = Math.trunc(Number(data.hours.end));
    if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start < end && end <= 24) {
      hours = { start, end };
    }
  }

  // Keyed by lowercased name so personRules/defaultPerson lookups are case-insensitive, same
  // as the regex matching around them.
  const people = {};
  for (const item of Array.isArray(data.people) ? data.people : []) {
    if (!item || typeof item !== "object") continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) continue;
    const color = typeof item.color === "string" && isValidColor(item.color.toLowerCase()) ? item.color.toLowerCase() : "";
    const badge = typeof item.badge === "string" && item.badge.trim() ? item.badge.trim() : name[0].toUpperCase();
    // A photo/avatar URL fills the same corner slot the plain badge letter would otherwise
    // occupy (see shared.liquid) — shown instead of the letter, not alongside it, since
    // there's only one slot for "whose event" the way there's only two for "what kind" (a
    // category's icon(s)). Same bare-URL validation as resolveIcon's http(s) branch; a
    // name/emoji/anything-else here is silently ignored rather than treated as a broken image.
    const image = typeof item.image === "string" && /^https?:\/\//i.test(item.image.trim()) ? item.image.trim() : null;
    people[name.toLowerCase()] = { name, color, badge, image };
  }

  const calendars = [];
  for (const item of Array.isArray(data.calendars) ? data.calendars : []) {
    if (!item || typeof item !== "object" || typeof item.url !== "string" || !item.url.trim()) continue;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : null;
    const color = typeof item.color === "string" && isValidColor(item.color.toLowerCase()) ? item.color.toLowerCase() : null;
    const icon = resolveIcon(item.icon);
    const exclude = compileRegexList(item.exclude);
    // `defaultPerson` (like `personRules[].person` below) accepts either one name or an array
    // of them — a shared event (a family trip, a joint appointment) can tag more than one
    // person at once instead of forcing a single "whose event is this really" choice.
    // Normalized to an array-or-null here so every consumer downstream (applyCalendarPerson)
    // only has to handle one shape.
    const defaultPerson = normalizeNameList(item.defaultPerson);

    const personRules = [];
    for (const rule of Array.isArray(item.personRules) ? item.personRules : []) {
      if (!rule || typeof rule !== "object") continue;
      const matchSrc = typeof rule.match === "string" ? rule.match : "";
      const people_ = normalizeNameList(rule.person) || [];
      if (!matchSrc || !people_.length) continue;
      let rx;
      try {
        rx = new RegExp(matchSrc, "i");
      } catch (e) {
        continue;
      }
      personRules.push({ rx, people: people_, rename: rule.rename !== false });
    }

    calendars.push({ id, url: item.url.trim(), color, icon, exclude, defaultPerson, personRules });
  }

  // Optional top-level "categories": [{ name, match, icon, color, display }] — unlike people[],
  // which is only ever applied per-calendar (via personRules/defaultPerson), a category is
  // matched against every surviving event's title regardless of which calendar it came from —
  // meant for "kind of event" (Birthday, Work, Medical...) rather than "whose event", so it
  // doesn't need per-calendar wiring by default. See applyCategory. `match` (required) is a
  // regex, or an array of them (case-insensitive, any match applies) — same shape as
  // calendars[].exclude. `icon` is a Material Symbols name, a Tabler Icons name prefixed
  // "tabler:" (see resolveIcon above), or an http(s) URL to a custom image, OR an array of up
  // to two of any of those — e.g. ["work", "home"] for a "Work From Home" category — filling
  // the badge rail's slot(s) (see run()'s badge assembly and shared.liquid). `color` is one of
  // HUES or "gray-10".."gray-75", "black", or "white". `display: "image"` drops the title text
  // entirely and lets whatever ended up in the badge rail (this category's icon, or a person's
  // badge/photo if the icon left a slot free) fill the whole chip instead — meant for the kind
  // of recurring event an icon alone already says everything about; silently falls back to the
  // normal text chip if nothing real ended up in a slot (see run()). icon/color/display are
  // all optional independently — a color-only category just recolors the chip.
  //
  // `calendars` / `excludeCalendars` (both optional) narrow which calendars a category can
  // apply to, by `calendars[].id` (or `.url`, for a calendar with no id) — e.g. a global "Work"
  // category that matches every calendar EXCEPT someone's own personal one, where their own
  // defaultPerson badge should show through instead. `calendars` is a whitelist (present ->
  // ONLY those calendars); `excludeCalendars` is a blacklist (present -> every calendar EXCEPT
  // those). Omit both for the original global behavior (every calendar, unchanged default).
  const categories = [];
  for (const item of Array.isArray(data.categories) ? data.categories : []) {
    if (!item || typeof item !== "object") continue;
    const matchRx = compileRegexList(item.match);
    if (!matchRx.length) continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const color = typeof item.color === "string" && isValidColor(item.color.toLowerCase()) ? item.color.toLowerCase() : null;
    const icon = resolveIcon(item.icon);
    // "image" mode: the event renders as just its badge slot(s) — filling most of the chip —
    // with NO title text at all, for the kind of recurring event an icon alone already says
    // everything about (see the badge-slot assembly in run() for the actual fallback: this
    // only takes effect once something real ends up in a slot to show as the image).
    const display = item.display === "image" ? "image" : null;
    const calIdxWhitelist = calendarIndexesFor(item.calendars, calendars);
    const calIdxBlacklist = calendarIndexesFor(item.excludeCalendars, calendars);
    categories.push({ name, rx: matchRx, color, icon, display, calIdxWhitelist, calIdxBlacklist });
  }

  return { calendars, people, hours, categories };
}

// Resolves categories[].calendars / categories[].excludeCalendars — a calendar reference (or
// array of them), each matched against calendars[].id first, falling back to calendars[].url
// for a calendar with no id — into a Set of calendar-array indexes. Returns null (not an empty
// Set) when the raw field is absent/empty, so applyCategory can tell "no restriction" apart
// from "restricted to zero calendars" (a typo'd id matching nothing).
function calendarIndexesFor(raw, calendars) {
  const refs = Array.isArray(raw) ? raw : typeof raw === "string" && raw.trim() ? [raw] : [];
  const cleaned = refs.filter((r) => typeof r === "string" && r.trim()).map((r) => r.trim());
  if (!cleaned.length) return null;
  const idxs = new Set();
  calendars.forEach((cal, idx) => {
    if (cleaned.includes(cal.id) || cleaned.includes(cal.url)) idxs.add(idx);
  });
  return idxs;
}

// Tests `title` (the event's title, already through any personRules rename) against every
// configured category IN ORDER — each category that matches contributes whichever of
// color/icon it defines, later matches overwriting earlier ones field-by-field (not as a whole
// object), so e.g. one category matching for color and a later one matching only for icon both
// still apply, same "last match wins" convention as personRules/calendar color. calIdx (the
// event's own calendar position) is checked against the category's own calendars/
// excludeCalendars scope (see calendarIndexesFor) before the title match even runs.
function applyCategory(title, categories, calIdx) {
  let color = null;
  let icon = null;
  let display = null;
  for (const cat of categories) {
    if (cat.calIdxWhitelist && !cat.calIdxWhitelist.has(calIdx)) continue;
    if (cat.calIdxBlacklist && cat.calIdxBlacklist.has(calIdx)) continue;
    if (!cat.rx.some((rx) => rx.test(title))) continue;
    if (cat.color) color = cat.color;
    if (cat.icon) icon = cat.icon;
    if (cat.display) display = cat.display;
  }
  return { color, icon, display };
}

// Accepts one name (string) or several (array of strings) for defaultPerson/personRules[].
// person — either shape normalizes to an array of trimmed, non-empty names, or null if there's
// nothing usable, so applyCalendarPerson only ever has to iterate one shape.
function normalizeNameList(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const names = list.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim());
  return names.length ? names : null;
}

function compileRegex(pattern) {
  const p = (pattern || "").trim();
  if (!p) return null;
  try {
    return new RegExp(p, "i");
  } catch (e) {
    return null;
  }
}

function compileRegexList(raw) {
  // calendars[].exclude accepts either a single regex string (kept for backward
  // compatibility with configs written before multiple excludes existed) or an array of
  // them — an event is hidden if ANY compiled pattern matches. Invalid/empty entries are
  // dropped rather than erroring the whole render, same forgiving handling as everywhere
  // else in this parser.
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const rxs = [];
  for (const pattern of list) {
    const rx = compileRegex(typeof pattern === "string" ? pattern : "");
    if (rx) rxs.push(rx);
  }
  return rxs;
}

function applyCalendarPerson(title, cal, people) {
  let personNames = null;
  for (const rule of cal.personRules) {
    if (!rule.rx.test(title)) continue;
    if (rule.rename) {
      // Multiple people rename to their names joined with "&" (e.g. "Alex & Jordan") rather
      // than picking just one — the whole point of tagging more than one person on a shared
      // event is that neither name should get silently dropped from the title either.
      title = title.replace(new RegExp(rule.rx.source, "gi"), rule.people.join(" & "));
    }
    personNames = rule.people;
  }
  if (personNames === null) personNames = cal.defaultPerson;

  // hue: the first matched person WITH a color set wins — a single accent color, same as
  // before this supported more than one person; several different colors on one chip would
  // read as noise, not signal, so this is deliberately not "blend" or "last wins" here.
  // badges: one entry per matched, DECLARED person (an undeclared name in personRules/
  // defaultPerson still renames the title above, it just contributes no badge — same
  // "declared person required for styling" rule as always), in the order they were listed.
  // Each entry becomes a badge-rail slot once merged with any category icon (see run()) —
  // that merge, not this function, enforces the real 2-slot cap, so an event tagged with 3
  // people still resolves sensibly instead of this function needing to know the budget.
  let hue = null;
  const badges = [];
  if (personNames) {
    for (const personName of personNames) {
      const p = people[personName.toLowerCase()];
      if (!p) continue;
      if (hue === null && p.color) hue = p.color;
      if (p.image) badges.push({ kind: "photo", src: p.image });
      else badges.push({ kind: "letter", text: p.badge });
    }
  }
  return { title, hue, badges };
}

// --------------------------------------------------------------------- locale / timezone

function localeOf(input) {
  // trmnl.user.locale is a real merge var (e.g. "en") — see usetrmnl/api-docs,
  // plugin-marketplace/plugin-screen-generation-flow.md. Returned as-is (not restricted to
  // a known set): Intl.DateTimeFormat below can render weekday/month names for essentially
  // any real locale natively — unlike Python's strftime, which needs the OS's locale data
  // actually installed, unreliable in a sandboxed serverless VM (why the original Python
  // version hand-rolled a translation table instead). A malformed tag falls back to 'en'.
  try {
    const loc = input.trmnl.user.locale;
    if (typeof loc === "string" && loc.trim()) return loc.trim();
  } catch (e) {}
  return "en";
}

function unavailableText(locale) {
  // Intl has no general string-translation facility (only date/number/list formatting), so
  // this one UI string still needs a small hand-maintained table — unlike weekday/month
  // names below. Falls back to English for any locale outside this short list.
  const code = String(locale).toLowerCase().split(/[-_]/)[0];
  return (UNAVAILABLE[code] || UNAVAILABLE.en);
}

// Label shown in the hour-axis gutter next to the all-day event row. Same small hand-maintained
// table/fallback pattern as unavailableText — this is real, narrow real estate (the same gutter
// column hour numbers share), so the strings above are kept deliberately short.
function allDayText(locale) {
  const code = String(locale).toLowerCase().split(/[-_]/)[0];
  return (ALL_DAY_LABEL[code] || ALL_DAY_LABEL.en);
}

function userTz(input) {
  // Fall back to the device owner's own timezone (trmnl.user.time_zone_iana) when the
  // plugin's own Time Zone field is left blank, instead of defaulting to UTC.
  try {
    const tz = input.trmnl.user.time_zone_iana;
    return typeof tz === "string" && tz.trim() ? tz.trim() : null;
  } catch (e) {
    return null;
  }
}

function userUtcOffsetMinutes(input) {
  // trmnl.user.utc_offset (seconds from UTC) as a last-resort fallback for computing "now"
  // — see resolveTz.
  try {
    const s = input.trmnl.user.utc_offset;
    const n = Number(s);
    return isFinite(n) ? n / 60 : null;
  } catch (e) {
    return null;
  }
}

function resolveTz(tzname, input) {
  // An IANA name (from the Time Zone field or trmnl.user.time_zone_iana) is preferred since
  // it's DST-aware for future recurring events, but safeZone(name) returns null if the
  // runtime's tzdata doesn't recognize it — silently falling back to UTC in that case
  // mispositions everything computed from "now" (event bucketing, day boundaries, the
  // current-time line) by the zone's actual offset. trmnl.user.utc_offset is a raw number
  // that needs no tzdata lookup at all, so it's a strictly more reliable fallback than
  // defaulting straight to UTC. Zones are represented as either an IANA string or a plain
  // number of UTC-offset minutes (the fixed-offset fallback) throughout this file.
  const tz = tzname ? safeZone(tzname) : null;
  if (tz) return tz;
  const offsetMin = userUtcOffsetMinutes(input);
  if (offsetMin !== null) return offsetMin;
  return 0;
}

function safeZone(name) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return name;
  } catch (e) {
    return null;
  }
}

// ------------------------------------------------------------- zone-aware date primitives
//
// No IANA tzdata ships with plain JS the way Python's zoneinfo does, but Intl.DateTimeFormat
// DOES carry the runtime's own tzdata — this reads a zone's UTC offset at a specific instant
// via its "longOffset" formatting (e.g. "GMT+02:00"), which is enough to hand-roll the two
// primitives everything else here is built from: an instant -> civil wall-clock fields in a
// zone (fromEpoch), and civil wall-clock fields in a zone -> an instant (zonedTimeToUtc).

const _offsetFmtCache = new Map();
function offsetFormatter(tz) {
  let f = _offsetFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit", timeZoneName: "longOffset" });
    _offsetFmtCache.set(tz, f);
  }
  return f;
}

function getOffsetMinutes(epochMs, tz) {
  if (typeof tz === "number") return tz; // fixed-offset-minutes fallback (see resolveTz)
  const parts = offsetFormatter(tz).formatToParts(new Date(epochMs));
  const part = parts.find((p) => p.type === "timeZoneName");
  const v = part ? part.value : "GMT";
  if (v === "GMT" || v === "UTC") return 0;
  let m = /GMT([+-])(\d{1,2}):(\d{2})/.exec(v);
  if (m) return (m[1] === "-" ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
  m = /GMT([+-])(\d{1,2})$/.exec(v);
  if (m) return (m[1] === "-" ? -1 : 1) * parseInt(m[2], 10) * 60;
  return 0;
}

const _civilFmtCache = new Map();
function civilFormatter(tz) {
  let f = _civilFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    _civilFmtCache.set(tz, f);
  }
  return f;
}

function fromEpoch(epochMs, tz) {
  // Instant -> civil {y, mo, d, h, mi, s, wd} (wd: Mon=0..Sun=6) in the given zone.
  if (typeof tz === "number") {
    const d = new Date(epochMs + tz * 60000);
    return {
      y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
      h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
      wd: (d.getUTCDay() + 6) % 7,
    };
  }
  const parts = {};
  for (const p of civilFormatter(tz).formatToParts(new Date(epochMs))) parts[p.type] = p.value;
  const y = +parts.year, mo = +parts.month, d = +parts.day;
  let h = +parts.hour;
  if (h === 24) h = 0; // some engines report midnight as "24" under hourCycle h23
  return { y, mo, d, h, mi: +parts.minute, s: +parts.second, wd: civilWeekday(y, mo, d) };
}

function zonedTimeToUtc(y, mo, d, h, mi, s, tz) {
  // Civil wall-clock fields in a zone -> the instant (epoch ms) they represent. Standard
  // double-conversion trick: guess the offset by treating the fields as UTC, correct once,
  // then correct again from the corrected instant — accurate outside the ambiguous/skipped
  // hour of a DST transition, which is an inherent edge case no amount of iteration resolves
  // cleanly (Python's zoneinfo has its own analogous ambiguous-time behavior there too).
  if (typeof tz === "number") return Date.UTC(y, mo - 1, d, h, mi, s) - tz * 60000;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = getOffsetMinutes(guess, tz);
  const t1 = guess - off1 * 60000;
  const off2 = getOffsetMinutes(t1, tz);
  return guess - off2 * 60000;
}

function civilWeekday(y, mo, d) {
  return (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7; // Mon=0..Sun=6
}

function civilDateOrdinal(y, mo, d) {
  return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
}

function ordinalToYmd(ordinal) {
  const dt = new Date(ordinal * 86400000);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function addCivilDays(civil, n) {
  // Pure calendar-field arithmetic (Date.UTC normalizes month/year rollover for free) — NOT
  // zone-aware, deliberately: this mirrors how Python's `aware_datetime + timedelta(days=n)`
  // behaves with a ZoneInfo tzinfo attached (shifts the calendar date, keeps the same
  // wall-clock time-of-day, re-derives the UTC offset for the new date only when needed).
  const dt = new Date(Date.UTC(civil.y, civil.mo - 1, civil.d + n, civil.h, civil.mi, civil.s));
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours(), mi: dt.getUTCMinutes(), s: dt.getUTCSeconds() };
}

function isLeap(y) {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function addMonths(civil, n) {
  const mTotal = civil.mo - 1 + n;
  const y = civil.y + Math.floor(mTotal / 12);
  const m = ((mTotal % 12) + 12) % 12;
  const maxDay = m === 1 ? (isLeap(y) ? 29 : 28) : MONTH_DAYS[m];
  return { y, mo: m + 1, d: Math.min(civil.d, maxDay), h: civil.h, mi: civil.mi, s: civil.s };
}

// -------------------------------------------------------------------------- i18n / labels
//
// A hardcoded table for the languages we've actually verified, checked FIRST — Intl.
// DateTimeFormat only steps in for locales outside it. Intl alone isn't reliable enough to
// be the only source: whether it actually has non-English weekday/month data depends on
// whether the runtime was built with full ICU or a slimmed-down "small-icu" build (common in
// serverless sandboxes for faster cold starts) — small-icu doesn't error for an unsupported
// locale, it just silently formats in English, which is exactly what happened here (real
// TRMNL input with locale "nl" rendered English day/month names). Same class of problem
// Python's strftime has with the OS's locale data not being installed in a sandboxed VM —
// this hits it at the JS/ICU layer instead. The table covers what shipped before Intl was
// introduced; Intl is still tried for anything outside it, on the chance the runtime's ICU
// happens to cover it — better than a guaranteed-English default for those, even if not
// guaranteed to work.
const I18N = {
  en: {
    wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    months_short: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    unavailable: "Calendar unavailable",
    all_day: "All day",
  },
  nl: {
    wd: ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"],
    months: ["Januari", "Februari", "Maart", "April", "Mei", "Juni", "Juli", "Augustus", "September", "Oktober", "November", "December"],
    months_short: ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"],
    unavailable: "Kalender niet beschikbaar",
    all_day: "Hele dag",
  },
  fr: {
    wd: ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"],
    months: ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"],
    months_short: ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"],
    unavailable: "Agenda indisponible",
    all_day: "Journée",
  },
  de: {
    wd: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
    months: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
    months_short: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
    unavailable: "Kalender nicht verfügbar",
    all_day: "Ganztägig",
  },
  es: {
    wd: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"],
    months: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
    months_short: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
    unavailable: "Calendario no disponible",
    all_day: "Todo el día",
  },
};

const UNAVAILABLE = Object.fromEntries(Object.entries(I18N).map(([code, t]) => [code, t.unavailable]));
const ALL_DAY_LABEL = Object.fromEntries(Object.entries(I18N).map(([code, t]) => [code, t.all_day]));

const _weekdayFmtCache = new Map();
const _monthFmtCache = new Map();

function localeDatePart(locale, width, kind, y, mo, d) {
  // width: 'short' | 'long'; kind: 'weekday' | 'month'. Formatted against a UTC-anchored
  // Date built straight from civil fields (see addCivilDays) — timeZone: 'UTC' keeps that
  // reading stable regardless of the runtime's own local zone, which would otherwise risk
  // shifting the displayed weekday/month by a day right around midnight.
  const cacheKey = locale + "|" + width;
  const cache = kind === "weekday" ? _weekdayFmtCache : _monthFmtCache;
  let fmt = cache.get(cacheKey);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat(locale, { [kind]: width, timeZone: "UTC" });
    } catch (e) {
      fmt = new Intl.DateTimeFormat("en", { [kind]: width, timeZone: "UTC" });
    }
    cache.set(cacheKey, fmt);
  }
  const raw = fmt.format(new Date(Date.UTC(y, mo - 1, d))).replace(/\.$/, "");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function dayLabel(civil, locale) {
  const code = String(locale).toLowerCase().split(/[-_]/)[0];
  const t = I18N[code];
  const wd = t ? t.wd[civilWeekday(civil.y, civil.mo, civil.d)] : localeDatePart(locale, "short", "weekday", civil.y, civil.mo, civil.d);
  const month = t ? t.months[civil.mo - 1] : localeDatePart(locale, "long", "month", civil.y, civil.mo, civil.d);
  return wd + " " + civil.d + " " + month;
}

function dayLabelShort(civil, locale) {
  // Abbreviated-month variant for narrow layouts (quadrant, half_vertical, or a wide Days-to-
  // Show setting) — the full month name is what wraps/gets clipped there, e.g. "Zo 5 Juli"
  // losing "Juli" off the header at 7 columns; the weekday/day are already short enough not
  // to need shrinking.
  const code = String(locale).toLowerCase().split(/[-_]/)[0];
  const t = I18N[code];
  const wd = t ? t.wd[civilWeekday(civil.y, civil.mo, civil.d)] : localeDatePart(locale, "short", "weekday", civil.y, civil.mo, civil.d);
  const month = t ? t.months_short[civil.mo - 1] : localeDatePart(locale, "short", "month", civil.y, civil.mo, civil.d);
  return wd + " " + civil.d + " " + month;
}

function fmtTime(epoch, tz, is12h) {
  const c = fromEpoch(epoch, tz);
  const mi = String(c.mi).padStart(2, "0");
  if (is12h) {
    const h = c.h % 12 || 12;
    return h + ":" + mi + " " + (c.h < 12 ? "AM" : "PM");
  }
  return c.h + ":" + mi;
}

// ------------------------------------------------------------------------- ICS parsing

function unfold(text) {
  const lines = [];
  for (const raw of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if ((raw[0] === " " || raw[0] === "\t") && lines.length) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw);
    }
  }
  return lines;
}

function prop(line) {
  const idx = line.indexOf(":");
  if (idx === -1) return null;
  const head = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const parts = head.split(";");
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq !== -1) {
      params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"+|"+$/g, "");
    }
  }
  return [parts[0].toUpperCase(), params, value];
}

function untext(v) {
  return v.replace(/\\n/g, "\n").replace(/\\N/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function parseDt(value, params, tz) {
  // Returns {epoch, allDay, civil:{y,mo,d,h,mi,s}, zone} — zone is what RRULE expansion
  // advances civil fields in (see expandEvent), an IANA string or a fixed-offset-minutes
  // number, matching the DTSTART's own TZID when present (falling back to the calendar's
  // display zone otherwise), same as _parse_dt did in the Python version.
  const v = value.trim();
  if (params.VALUE === "DATE" || (v.length === 8 && !v.includes("T"))) {
    const y = +v.slice(0, 4), mo = +v.slice(4, 6), d = +v.slice(6, 8);
    return { epoch: zonedTimeToUtc(y, mo, d, 0, 0, 0, tz), allDay: true, civil: { y, mo, d, h: 0, mi: 0, s: 0 }, zone: tz };
  }
  if (v.endsWith("Z")) {
    const y = +v.slice(0, 4), mo = +v.slice(4, 6), d = +v.slice(6, 8),
          h = +v.slice(9, 11), mi = +v.slice(11, 13), s = +v.slice(13, 15);
    return { epoch: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false, civil: { y, mo, d, h, mi, s }, zone: 0 };
  }
  const v15 = v.slice(0, 15);
  const y = +v15.slice(0, 4), mo = +v15.slice(4, 6), d = +v15.slice(6, 8),
        h = +v15.slice(9, 11), mi = +v15.slice(11, 13), s = +v15.slice(13, 15);
  const z = safeZone(params.TZID || "") || tz;
  return { epoch: zonedTimeToUtc(y, mo, d, h, mi, s, z), allDay: false, civil: { y, mo, d, h, mi, s }, zone: z };
}

function collectIcs(text, tz, winS, winE, out, calIdx) {
  let inEv = false;
  let ev = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      inEv = true;
      ev = {};
      continue;
    }
    if (line === "END:VEVENT") {
      inEv = false;
      if (ev) {
        ev.calIdx = calIdx;
        expandEvent(ev, tz, winS, winE, out);
      }
      continue;
    }
    if (!inEv) continue;
    const parsed = prop(line);
    if (!parsed) continue;
    const [name, params, value] = parsed;
    if (name === "DTSTART") {
      ev.start = parseDt(value, params, tz);
    } else if (name === "DTEND") {
      ev.end = parseDt(value, params, tz);
    } else if (name === "SUMMARY") {
      ev.title = untext(value);
    } else if (name === "DESCRIPTION") {
      ev.desc = untext(value);
    } else if (name === "RRULE") {
      ev.rrule = parseRrule(value, tz);
    } else if (name === "EXDATE") {
      ev.exdate = ev.exdate || new Set();
      for (const part of value.split(",")) {
        try {
          const p = parseDt(part, params, tz);
          ev.exdate.add(Math.floor(p.epoch / 1000));
        } catch (e) {}
      }
    }
  }
}

function parseRrule(value, tz) {
  const rr = {};
  for (const token of value.split(";")) {
    const eq = token.indexOf("=");
    if (eq !== -1) rr[token.slice(0, eq).toUpperCase()] = token.slice(eq + 1);
  }
  if (rr.UNTIL) {
    const u = rr.UNTIL;
    try {
      if (u.endsWith("Z")) {
        const y = +u.slice(0, 4), mo = +u.slice(4, 6), d = +u.slice(6, 8),
              h = +u.slice(9, 11), mi = +u.slice(11, 13), s = +u.slice(13, 15);
        rr._until = Date.UTC(y, mo - 1, d, h, mi, s);
      } else if (u.includes("T")) {
        const u15 = u.slice(0, 15);
        const y = +u15.slice(0, 4), mo = +u15.slice(4, 6), d = +u15.slice(6, 8),
              h = +u15.slice(9, 11), mi = +u15.slice(11, 13), s = +u15.slice(13, 15);
        rr._until = zonedTimeToUtc(y, mo, d, h, mi, s, tz);
      } else {
        const y = +u.slice(0, 4), mo = +u.slice(4, 6), d = +u.slice(6, 8);
        rr._until = zonedTimeToUtc(y, mo, d, 0, 0, 0, tz);
      }
    } catch (e) {
      rr._until = null;
    }
  }
  return rr;
}

// ------------------------------------------------------------------ recurrence expansion

function expandEvent(ev, tz, winS, winE, out) {
  const start = ev.start;
  if (!start) return;
  const allDay = !!start.allDay;
  const end = ev.end || { epoch: start.epoch + (allDay ? 86400000 : 3600000) };
  const dur = end.epoch - start.epoch;
  const title = ev.title !== undefined ? ev.title : "(no title)";
  const desc = ev.desc || "";
  const exdate = ev.exdate || new Set();
  const rr = ev.rrule;
  const calIdx = ev.calIdx || 0;

  function emit(curEpoch) {
    if (exdate.has(Math.floor(curEpoch / 1000))) return;
    const e = curEpoch + dur;
    if (curEpoch < winE && e > winS) {
      out.push({ startEpoch: curEpoch, endEpoch: e, allDay, title, desc, calIdx });
    }
  }

  if (!rr || !rr.FREQ) {
    emit(start.epoch);
    return;
  }

  const freq = rr.FREQ;
  const interval = Math.max(1, parseInt(rr.INTERVAL || "1", 10) || 1);
  const count = rr.COUNT ? parseInt(rr.COUNT, 10) : null;
  const until = rr._until != null ? rr._until : null;
  let byday = null;
  if (rr.BYDAY) {
    byday = rr.BYDAY.split(",").map((tok) => tok.slice(-2)).filter((code) => code in WD_MAP).map((code) => WD_MAP[code]).sort((a, b) => a - b);
  }

  let emitted = 0;
  let cur = { y: start.civil.y, mo: start.civil.mo, d: start.civil.d, h: start.civil.h, mi: start.civil.mi, s: start.civil.s };
  const zone = start.zone;
  let curEpoch = start.epoch;
  const startOrdinal = civilDateOrdinal(start.civil.y, start.civil.mo, start.civil.d);

  // Fast-forward so ancient DTSTARTs don't blow the iteration budget.
  if ((freq === "DAILY" || freq === "WEEKLY") && !(freq === "WEEKLY" && byday)) {
    const unit = freq === "DAILY" ? 1 : 7;
    const winSCivil = fromEpoch(winS, tz);
    const winSOrdinal = civilDateOrdinal(winSCivil.y, winSCivil.mo, winSCivil.d);
    const gap = Math.floor((winSOrdinal - startOrdinal) / unit);
    if (gap > 0) {
      const k = Math.floor(gap / interval);
      if (count !== null && k >= count) return;
      emitted = k;
      cur = addCivilDays(cur, k * interval * unit);
      curEpoch = zonedTimeToUtc(cur.y, cur.mo, cur.d, cur.h, cur.mi, cur.s, zone);
    }
  }

  let guard = 0;
  while (guard < 6000) {
    guard++;
    if (count !== null && emitted >= count) return;
    if (until !== null && curEpoch > until) return;

    if (freq === "WEEKLY" && byday) {
      const baseWd = civilWeekday(cur.y, cur.mo, cur.d);
      const mondayOrdinal = civilDateOrdinal(cur.y, cur.mo, cur.d) - baseWd;
      for (const wd of byday) {
        const dayOrdinal = mondayOrdinal + wd;
        if (dayOrdinal < startOrdinal) continue;
        const ymd = ordinalToYmd(dayOrdinal);
        const occEpoch = zonedTimeToUtc(ymd.y, ymd.mo, ymd.d, cur.h, cur.mi, cur.s, zone);
        if (count !== null && emitted >= count) return;
        if (until !== null && occEpoch > until) return;
        emitted++;
        emit(occEpoch);
      }
    } else {
      emitted++;
      emit(curEpoch);
    }

    // Advance one cycle.
    if (freq === "DAILY") {
      cur = addCivilDays(cur, interval);
    } else if (freq === "WEEKLY") {
      cur = addCivilDays(cur, interval * 7);
    } else if (freq === "MONTHLY") {
      cur = addMonths(cur, interval);
    } else if (freq === "YEARLY") {
      cur = addMonths(cur, 12 * interval);
    } else {
      return;
    }
    curEpoch = zonedTimeToUtc(cur.y, cur.mo, cur.d, cur.h, cur.mi, cur.s, zone);

    if (curEpoch > winE && !(freq === "WEEKLY" && byday)) return;
    if (freq === "WEEKLY" && byday) {
      const wd = civilWeekday(cur.y, cur.mo, cur.d);
      const mondayYmd = ordinalToYmd(civilDateOrdinal(cur.y, cur.mo, cur.d) - wd);
      const mondayEpoch = zonedTimeToUtc(mondayYmd.y, mondayYmd.mo, mondayYmd.d, cur.h, cur.mi, cur.s, zone);
      if (mondayEpoch > winE) return;
    }
  }
}

// --------------------------------------------------------------------------- sun times
//
// Open-Meteo is free and needs no API key: the Location field is TRMNL's built-in lat_lon
// picker (search a place, pick from autocomplete), which always hands back "lat,lon" — so no
// geocoding step is needed here, just parse the pair and ask Open-Meteo's forecast endpoint
// for sunrise/sunset. Best-effort only — the calendar itself is the primary feature, so any
// failure here (malformed value, network hiccup, timeout) just omits the sun marks instead
// of surfacing as a page-level error.

function parseLatLon(raw) {
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0].trim()), lon = parseFloat(parts[1].trim());
  return isFinite(lat) && isFinite(lon) ? [lat, lon] : null;
}

const WEATHER_CODES = {
  fog: new Set([45, 48]),
  rain: new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]),
  snow: new Set([71, 73, 75, 77, 85, 86]),
  storm: new Set([95, 96, 99]),
};

function weatherKind(code) {
  for (const kind of Object.keys(WEATHER_CODES)) {
    if (WEATHER_CODES[kind].has(code)) return kind;
  }
  return null;
}

// TRMNL hosts a full weather-icon set — reused here from the same set the daily-weather
// plugin (elsewhere in this workspace) already uses. Priority order for picking ONE icon to
// represent a whole day: worst condition wins, defaulting to sunny when nothing's flagged.
const ICON_BASE = "https://trmnl.com/images/plugins/weather/";
const ICON_PRIORITY = ["storm", "snow", "rain", "fog"];
const ICON_FILE = { storm: "wi-day-thunderstorm.svg", snow: "wi-day-snow.svg", rain: "wi-day-rain.svg", fog: "wi-day-fog.svg" };

function dayIcon(hours) {
  const present = new Set(Object.values(hours || {}));
  const kind = ICON_PRIORITY.find((k) => present.has(k)) || null;
  return ICON_BASE + (kind ? ICON_FILE[kind] : "wi-day-sunny.svg");
}

function splitIsoLocal(iso) {
  // Open-Meteo returns naive local timestamps like "2026-07-04T05:47" when timezone=auto —
  // parsed by hand (not via `new Date(...)`) because a timezone-less date-time string handed
  // to the Date constructor is interpreted in the RUNTIME's own zone (server or browser),
  // not the calendar location's zone Open-Meteo actually resolved.
  const [datePart, timePart] = iso.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = (timePart || "00:00").split(":").map(Number);
  return { y, mo, d, h, mi };
}

async function fetchWithTimeout(url, ms, opts) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(id);
  }
}

async function fetchSky(location, daysN, fahrenheit) {
  location = (location || "").trim();
  if (!location) return { sunMarks: {}, hourlyWeather: {}, dailyTemps: {}, error: null };
  try {
    const latlon = parseLatLon(location);
    if (!latlon) return { sunMarks: {}, hourlyWeather: {}, dailyTemps: {}, error: "invalid coordinates " + JSON.stringify(location) };
    const [lat, lon] = latlon;
    const params = new URLSearchParams({
      latitude: String(lat), longitude: String(lon),
      daily: "sunrise,sunset,temperature_2m_max,temperature_2m_min",
      hourly: "weathercode", timezone: "auto", forecast_days: String(daysN),
    });
    if (fahrenheit) params.set("temperature_unit", "fahrenheit");
    const resp = await fetchWithTimeout("https://api.open-meteo.com/v1/forecast?" + params.toString(), 3000, {
      headers: { "User-Agent": "TRMNL-ICS-Calendar" },
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const body = await resp.json();
    const daily = body.daily || {};
    const sunrises = daily.sunrise || [], sunsets = daily.sunset || [];
    const highs = daily.temperature_2m_max || [], lows = daily.temperature_2m_min || [];

    const sunMarks = {};
    for (let i = 0; i < Math.min(daysN, sunrises.length, sunsets.length); i++) {
      const marks = [];
      for (const [arr, kind] of [[sunrises, "sunrise"], [sunsets, "sunset"]]) {
        const parsed = splitIsoLocal(arr[i]);
        marks.push({ hour: parsed.h + parsed.mi / 60.0, kind });
      }
      sunMarks[i] = marks;
    }
    const dailyTemps = {};
    for (let i = 0; i < Math.min(daysN, highs.length, lows.length); i++) {
      dailyTemps[i] = { high: Math.round(highs[i]), low: Math.round(lows[i]) };
    }

    // Walk hourly entries in order, incrementing the day index whenever the date actually
    // changes — robust to a DST day being 23 or 25 hours instead of assuming a fixed stride
    // of 24, while still needing no locally-computed reference date.
    const hourly = body.hourly || {};
    const hTimes = hourly.time || [], codes = hourly.weathercode || [];
    const hourlyWeather = {};
    let dayI = -1, prevKey = null;
    for (let j = 0; j < hTimes.length; j++) {
      const parsed = splitIsoLocal(hTimes[j]);
      const key = parsed.y + "-" + parsed.mo + "-" + parsed.d;
      if (key !== prevKey) {
        dayI++;
        prevKey = key;
      }
      if (dayI >= daysN) break;
      if (j < codes.length) {
        const kind = weatherKind(codes[j]);
        if (kind !== null) {
          hourlyWeather[dayI] = hourlyWeather[dayI] || {};
          hourlyWeather[dayI][parsed.h] = kind;
        }
      }
    }

    return { sunMarks, hourlyWeather, dailyTemps, error: null };
  } catch (exc) {
    // Best-effort: never break the calendar over a weather hiccup. But silently swallowing
    // the reason made a real failure indistinguishable from "no location configured" —
    // return it so run() can surface it as a debug-only field (never a page-level error)
    // instead of leaving a future occurrence to guesswork.
    return { sunMarks: {}, hourlyWeather: {}, dailyTemps: {}, error: (exc && exc.name ? exc.name : "Error") + ": " + (exc && exc.message ? exc.message : exc) };
  }
}

// -------------------------------------------------------------------- native grid layout
//
// Builds percent-of-screen heights (h--[Ncqh]) for a real HTML/Liquid grid instead of drawing
// an image. cqh is a percentage of the outer .layout element (see shared.liquid), so every
// number here is a 0-100 integer share of the WHOLE screen — not pixels — which is what lets
// the same numbers render correctly on any device, including the larger TRMNL X. Liquid does
// no layout math itself; it just loops over this pre-baked structure.

const HEADER_PCT = 15; // day label only, one line. Tried dropping this back toward 11 once
                       // the daily high/low moved out to its own footer zone (see FOOTER_PCT)
                       // and stopped sharing this bar as a second line, on the assumption
                       // that a single line needs less room — measured wrong: half_horizontal
                       // alone uses a title--large tier whose real rendered line-height (36px
                       // at that view's own 240px-tall screen) already needs the full 15% on
                       // its own, pill padding or not. Kept at 15; the footer's own cost comes
                       // entirely out of gridPct instead (see below).
const FOOTER_PCT = 9; // weather icon + daily high/low, its own zone at the bottom of the
                      // screen (see shared.liquid) rather than a second header line — kept
                      // out of gridBase (the hourly grid's own top-offset math) since it sits
                      // AFTER the grid, not before it; only gridPct's own size shrinks for it.
const ALLDAY_ROW_PCT = 12; // bumped from 6, then 9 for visual weight (see the all-day chip's
                           // own h--[Ncqh] comment in shared.liquid for a real, since-fixed bug
                           // this value alone couldn't have masked: allday_row_pct wasn't wired
                           // through the view files' {% render %} calls, so the row had no real
                           // height at all in some views regardless of what this constant said).
const MIN_EVENT_PCT = 10; // floor so a block is never a literally invisible sliver — actual font
                           // sizing is handled client-side by the fit-text script (see shared.liquid),
                           // which measures the real rendered box and grows/shrinks text to match.
                           // Unlike every other *_pct value on this page, an event's own top_pct/
                           // height_pct (see layoutNative) are a share of grid_pct specifically (the
                           // day column's own height), not the whole screen — events are an
                           // absolutely-positioned overlay sized relative to their direct container.
function hueOf(calIdx, calendarColors) {
  if (calendarColors && calIdx < calendarColors.length && calendarColors[calIdx]) return calendarColors[calIdx];
  return HUES[calIdx % HUES.length];
}

function cluster(events) {
  // Group overlapping/touching timed events; assign side-by-side lanes within each. Returns
  // a list of clusters: {h0, h1, lanes: [[event, laneIndex], ...], nlanes}.
  const clusters = [];
  let active = [];
  let cur = null;

  function close() {
    if (cur !== null) {
      cur.nlanes = Math.max(...cur.lanes.map((p) => p[1])) + 1;
      clusters.push(cur);
    }
  }

  for (const ev of [...events].sort((a, b) => a.h0 - b.h0)) {
    if (cur !== null && ev.h0 >= cur.h1) {
      close();
      cur = null;
      active = [];
    }
    if (cur === null) cur = { h0: ev.h0, h1: ev.h1, lanes: [] };
    active = active.filter((p) => p[0] > ev.h0);
    const used = new Set(active.map((p) => p[1]));
    let lane = 0;
    while (used.has(lane)) lane++;
    active.push([ev.h1, lane]);
    cur.lanes.push([ev, lane]);
    cur.h1 = Math.max(cur.h1, ev.h1);
  }
  close();
  return clusters;
}

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

function layoutNative(days, importantStart, importantEnd, nowH, sunMarks, hourlyWeather, calendarColors) {
  importantStart = Math.max(0, Math.min(23, Math.trunc(importantStart)));
  importantEnd = Math.max(importantStart + 1, Math.min(24, Math.trunc(importantEnd)));

  const maxAdRows = days.length ? Math.max(...days.map((d) => d.allday.length)) : 0;
  const alldayPct = Math.min(3, maxAdRows) * ALLDAY_ROW_PCT;
  const gridBase = HEADER_PCT + alldayPct;
  const gridPct = 100 - gridBase - FOOTER_PCT;

  // Hours outside [importantStart, importantEnd) are hidden entirely (0% height) — that
  // range is always at least the configured default hours (see DEFAULT_HOURS/run()),
  // widened to also cover any real sunrise/event/sunset outside them, so anything left
  // outside it by construction has nothing worth keeping on screen. With hidden hours
  // contributing zero, there's no separate "important vs compressed" ratio to weigh
  // anymore — every visible hour just splits gridPct evenly.
  //
  // h--[Ncqh] is a bracket "arbitrary value" utility class that only works for INTEGERS: a
  // decimal value silently no-ops (the element falls back to its unstyled content-box
  // height). So gridPct has to divide across importantN hours as whole percents, and the
  // leftover from that division has to land somewhere.
  //
  // NOT "give the first `deficit` hours a whole extra percent each, in order" — that piled
  // every bumped hour at the START of the visible range (hour 7 gets +1, so does 8, 9, ...
  // however many the deficit needed), which read as "the rows aren't all the same size, even
  // in the middle of the day" once the deficit was more than 1 or 2 (confirmed: with a 16-
  // hour range you can have a 5-hour deficit — 5 back-to-back morning rows visibly taller
  // than the rest of the day, not just a rounding fringe). Cumulative rounding spreads that
  // same total leftover evenly across the whole range instead — round(i*gridPct/importantN)
  // for each position i, taking each hour's share as the difference from the previous
  // position's rounded cumulative total. Consecutive differences of a linear sequence
  // rounded this way can only ever be base or base+1, and the +1s fall roughly one every
  // importantN/deficit hours rather than all bunched at the front — everywhere still sums
  // exactly to gridPct (the last cumulative value is round(importantN*gridPct/importantN),
  // and gridPct is already an integer, so that's just gridPct itself).
  const importantN = importantEnd - importantStart;
  const hourPct = new Array(24).fill(0);
  let prevCum = 0;
  for (let i = 1; i <= importantN; i++) {
    const cum = Math.round((i * gridPct) / importantN);
    hourPct[importantStart + i - 1] = cum - prevCum;
    prevCum = cum;
  }

  const cumPct = [0];
  for (const p of hourPct) cumPct.push(cumPct[cumPct.length - 1] + p);

  function pctAt(tt) {
    const whole = Math.trunc(tt);
    const frac = tt - whole;
    const cum = cumPct[whole] + (whole < 24 ? hourPct[whole] * frac : 0);
    return gridBase + cum;
  }

  // Bold the hour label at the NEXT upcoming timed event today, so the axis doubles as an
  // at-a-glance "what's coming up" — only ever one hour bold, not every hour anything starts
  // today (that read as mostly-bold on a busy day and lost the signal), and nothing at all
  // once today's last event has already started (there's nothing left to point at).
  let nextEventH0 = null;
  if (nowH !== null && nowH !== undefined) {
    for (const d of days) {
      if (!d.isToday) continue;
      for (const e of d.timed) {
        if (e.h0 >= nowH && e.h0 < 24 && (nextEventH0 === null || e.h0 < nextEventH0)) nextEventH0 = e.h0;
      }
    }
  }
  const nextHour = nextEventH0 !== null ? Math.trunc(nextEventH0) : null;
  const hourRows = [];
  for (let h = 0; h < 24; h++) {
    hourRows.push({ hour: h, pct: hourPct[h], shade: h % 2, bold: h === nextHour, important: importantStart <= h && h < importantEnd });
  }

  const outDays = [];
  days.forEach((d, di) => {
    let clusters = cluster(d.timed).filter((c) => Math.max(c.h0, 0) < Math.min(c.h1, 24));
    for (const c of clusters) {
      c.h0 = Math.max(c.h0, 0);
      c.h1 = Math.min(c.h1, 24);
    }

    // Background bounds: window edges + every whole hour, ALWAYS — regardless of whether an
    // event happens to be running — so the zebra/night/weather background keeps its normal
    // per-hour texture underneath an event exactly like it would without one. Events are a
    // separate absolutely-positioned overlay (below) painted on top.
    const boundsSet = new Set([0, 24]);
    for (let h = 1; h < 24; h++) boundsSet.add(h);

    // Sunrise/sunset: shading the whole night portion of the column solid dark is a
    // large-area signal that survives e-ink rendering (a thin colored line measured
    // unreadable on the real grayscale device). Still split bounds at the sunrise/sunset
    // hour so the transition lands at the right minute, not just the right hour band.
    //
    // Deliberately uses day 0's (today's) sunrise/sunset for EVERY column, not each day's
    // own — sunrise/sunset drifts by about a minute a day, and that real difference, rounded
    // to whole percentage points, made the night/day boundary zigzag between adjacent
    // columns; a single shared reference keeps it a straight, aligned line.
    const daySun = (sunMarks || {})[0] || [];
    const sunriseMark = daySun.find((m) => m.kind === "sunrise");
    const sunsetMark = daySun.find((m) => m.kind === "sunset");
    const sunriseH = sunriseMark ? sunriseMark.hour : null;
    const sunsetH = sunsetMark ? sunsetMark.hour : null;
    for (const h of [sunriseH, sunsetH]) {
      if (h !== null && h >= 0 && h < 24) boundsSet.add(h);
    }
    // Also split at "now" (today only) so segments cleanly separate into wholly-past or
    // wholly-upcoming — see `past` below — instead of one segment straddling the boundary.
    const hasNow = d.isToday && nowH !== null && nowH !== undefined && nowH >= 0 && nowH < 24;
    if (hasNow) boundsSet.add(nowH);
    const bounds = [...boundsSet].sort((a, b) => a - b);

    function isNight(mid) {
      if (sunriseH === null || sunsetH === null) return false;
      return mid < sunriseH || mid >= sunsetH;
    }

    const dayWeather = (hourlyWeather || {})[di] || {};

    const segments = [];
    for (let bi = 0; bi < bounds.length - 1; bi++) {
      const a = bounds[bi], b = bounds[bi + 1];
      const mid = (a + b) / 2.0;
      // A segment never spans more than one hour (bounds already split at every whole hour),
      // so Math.trunc(a) identifies which hour's budget it draws from. Telescope WITHIN that
      // hour — round(hourPct[h]*localB) - round(hourPct[h]*localA) — rather than rounding
      // pctAt(b)-pctAt(a) independently: rounding each fragment of a split hour on its own
      // doesn't guarantee the fragments sum back to that hour's already-fixed integer total.
      const h = Math.trunc(a);
      const pct = Math.round(hourPct[h] * (b - h)) - Math.round(hourPct[h] * (a - h));
      const shade = Math.trunc(a) % 2;
      const past = hasNow && a < nowH;
      segments.push({ pct, shade, night: isNight(mid), past, weather: dayWeather[Math.trunc(a)] || null });
    }

    // "Now" is an absolutely-positioned overlay too, for the same reason events are: its
    // position is derived straight from pctAt(nowH), independent of the segment list, so
    // nothing about today's own background sizing ever has to change to show it.
    let nowMarker = null;
    if (d.isToday && nowH !== null && nowH !== undefined && nowH >= 0 && nowH < 24) {
      const top = pctAt(nowH) - gridBase;
      nowMarker = { top_pct: round4((top / gridPct) * 100), night: isNight(nowH) };
    }

    // Events are absolutely-positioned overlays, sized straight from pctAt() on each EVENT's
    // OWN h0/h1 (not the whole cluster's) — clustering only decides which lane (horizontal
    // slot) an event sits in among whatever else overlaps it; each lane still gets its own
    // independent vertical position/size. A cluster's h0/h1 is the UNION of everything in
    // it, so sizing every lane to that shared span used to stretch a short event to match a
    // much longer one it merely overlapped (e.g. a 45-minute class inside an 8-hour block) —
    // confirmed against real data, not a hypothetical. Flattened across all clusters and
    // sorted by start time so the MIN_EVENT_PCT growth-cap below (an event too short to read
    // grows down, but never past whatever's next) has one consistent, chronological list to
    // check against — capping against the immediately-following event overall is a
    // conservative, always-safe bound: two events sharing a lane can never be adjacent
    // without something between them (in any lane) starting first.
    const flatEvents = [];
    for (const c of clusters) {
      for (const [ev, laneIdx] of c.lanes) flatEvents.push({ ev, laneIdx, nlanes: c.nlanes });
    }
    flatEvents.sort((a, b) => a.ev.h0 - b.ev.h0);

    const events = [];
    flatEvents.forEach((item, idx) => {
      const ev = item.ev;
      const top = pctAt(ev.h0) - gridBase;
      let height = pctAt(ev.h1) - gridBase - top;
      if (height < MIN_EVENT_PCT) {
        const nextTop = idx + 1 < flatEvents.length ? pctAt(flatEvents[idx + 1].ev.h0) - gridBase : gridPct;
        height = Math.min(MIN_EVENT_PCT, Math.max(0, nextTop - top));
      }
      const color = ev.hueOverride || hueOf(ev.calIdx, calendarColors);
      events.push({
        top_pct: round4((top / gridPct) * 100),
        height_pct: round4((height / gridPct) * 100),
        lane_index: item.laneIdx,
        nlanes: item.nlanes,
        title: ev.title,
        hue: colorClass(color),
        // Left accent bar (see shared.liquid) — every event gets one, a darker/more-saturated
        // step of its own fill color by default, or a Category's own color when one matched
        // (see applyCategory) so the bar can carry a second, independent signal from the fill.
        bar: accentColor(color),
        fg: foregroundFor(color),
        badges: ev.badges || [],
        display: ev.display || "text",
      });
    });

    outDays.push({
      label: d.label, label_short: d.labelShort, is_today: d.isToday,
      temp: d.temp || null, icon: d.icon || null,
      allday: d.allday.map((a) => ({
        title: a.title, hue: colorClass(a.hue), fg: foregroundFor(a.hue),
        badges: a.badges || [], display: a.display || "text",
        continues_before: a.continuesBefore, continues_after: a.continuesAfter,
      })),
      segments, events, now_marker: nowMarker,
    });
  });

  return { header_pct: HEADER_PCT, allday_pct: alldayPct, allday_row_pct: ALLDAY_ROW_PCT, grid_pct: gridPct, footer_pct: FOOTER_PCT, hour_rows: hourRows, days: outDays };
}
