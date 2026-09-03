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
const GRAY_SHADES = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70];

function isValidColor(v) {
  if (HUES.includes(v)) return true;
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
  const m = /^gray-(\d+)$/.exec(color);
  if (!m) return "black";
  return parseInt(m[1], 10) < 45 ? "white" : "black";
}

async function run(input) {
  const cfg = parseConfig(cf(input, "calendars"));
  const calendars = cfg.calendars;
  const people = cfg.people;
  const calendarColors = calendars.map((c) => c.color);
  const locale = localeOf(input);
  const tzname = cf(input, "time_zone").trim() || userTz(input) || "UTC";
  const is12h = cf(input, "time_format").trim().toLowerCase() === "12h";
  const location = cf(input, "lat_lon");
  const fahrenheit = cf(input, "temperature_unit").trim().toLowerCase() === "fahrenheit";
  const daysN = toInt(cf(input, "view_days"), DEFAULT_DAYS, 1, 7);
  const showTitleBar = ["true", "yes", "1"].includes(cf(input, "show_title_bar").trim().toLowerCase());
  const titleBarPct = showTitleBar ? TITLE_BAR_PCT : 0;
  const titleTextVal = titleText(input);

  const tz = resolveTz(tzname, input);

  if (!calendars.length) {
    return emptyResult(tzname, tz, locale, daysN, "No ICS URL configured", showTitleBar, titleBarPct, titleTextVal);
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
    e.badge = r.badge;
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
          badge: e.badge,
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
        badge: a.badge || null,
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

  // The emphasized ("important") range is automatic, not a manual setting: it starts at
  // sunrise or the first meeting of the visible days, whichever is earlier, and ends at
  // sunset or the last meeting, whichever is later — so daylight hours and every actual event
  // are always in the expanded part of the grid, never stuck in the compressed margin. Floor
  // the start / ceil the end so a meeting or sunrise/sunset falling mid-hour still pulls its
  // whole hour into the emphasized range. Falls back to 8-22 if there's neither sun data (no
  // Location configured) nor any timed events to go on.
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
  const startCandidates = [sunriseMark ? sunriseMark.hour : null, ...eventStarts].filter((h) => h !== null && h !== undefined);
  const endCandidates = [sunsetMark ? sunsetMark.hour : null, ...eventEnds].filter((h) => h !== null && h !== undefined);
  const startH = startCandidates.length ? Math.floor(Math.min(...startCandidates)) : 8;
  let endH = endCandidates.length ? Math.ceil(Math.max(...endCandidates)) : 22;
  endH = Math.max(endH, startH + 1);

  const grid = layoutNative(rawDays, startH, endH, nowH, sky.sunMarks, sky.hourlyWeather, titleBarPct, calendarColors);

  return Object.assign({}, grid, {
    generated_at: Math.floor(nowEpoch / 1000),
    tz: tzname,
    error: err,
    unavailable_label: unavailableText(locale),
    has_events: rawDays.some((d) => d.timed.length || d.allday.length),
    show_title_bar: showTitleBar,
    title_text: titleTextVal,
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

function titleText(input) {
  // The instance name the user gave this plugin in TRMNL, shown in the optional title bar.
  try {
    const name = input.trmnl.plugin_settings.instance_name;
    return typeof name === "string" && name.trim() ? name : "Calendar";
  } catch (e) {
    return "Calendar";
  }
}

function emptyResult(tzname, tz, locale, daysN, msg, showTitleBar, titleBarPct, titleTextVal) {
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
  const grid = layoutNative(days, 8, 22, null, null, null, titleBarPct, null);
  return Object.assign({}, grid, {
    generated_at: Math.floor(nowEpoch / 1000),
    tz: tzname,
    error: msg,
    unavailable_label: unavailableText(locale),
    has_events: false,
    show_title_bar: showTitleBar,
    title_text: titleTextVal,
    weather_error: null,
  });
}

// --------------------------------------------------------- calendar configuration (JSON)
//
// The "Calendar Configuration" field is one JSON object:
//   {
//     "calendars": [
//       { "id": "Kato", "url": "https://.../kato.ics", "defaultPerson": "Kato" },
//       { "id": "School", "url": "https://.../school.ics", "exclude": "regex",
//         "personRules": [
//           { "match": "\\bL6\\b", "person": "Kato" },
//           { "match": "\\bL2\\b", "person": "Nala" }
//         ] }
//     ],
//     "people": [
//       { "name": "Kato", "color": "pink", "badge": "K" },
//       { "name": "Nala", "color": "blue" }
//     ]
//   }
// `people[]` holds ONLY formatting — `name` (required, also the lookup key), `color`
// (optional, one of HUES or "gray-10".."gray-70" in steps of 5) and `badge` (optional short
// text for the small circle next to an event, defaults to `name`'s first letter). It carries
// no matching logic: which events
// belong to a person is entirely a property of the CALENDAR they're on, via two mechanisms
// that combine per calendar:
//   - `calendars[].personRules`: an array of `{ match, person, rename }`. `match` (regex,
//     case-insensitive) is tested against every surviving event on THAT calendar, in array
//     order — a later rule's rename builds on an earlier one's output, and its color/badge
//     wins if it also matches (last match wins, same as color pinning). `person` names who
//     the event belongs to (rename target text too) — it doesn't need to already exist in
//     `people[]`, but only a declared person contributes color/badge. `rename` (default
//     true) controls whether the matched text is actually replaced with `person`; set it
//     false to tag/color without renaming.
//   - `calendars[].defaultPerson`: a person name applied when NO personRule on that
//     calendar matched — for a calendar that's already entirely one person's own (like a
//     personal calendar per family member), this avoids needing a `personRules` entry at
//     all. Never overrides an actual personRules match.
// `calendars[].id` is optional — a short label `personRules[].person`/`defaultPerson` values
// double as (see above); calendars are otherwise unrelated to it. `calendars[].color` is
// optional, one of HUES or "gray-10".."gray-70", pins that calendar's own default color
// instead of auto-cycling through the hues by position (a matched/defaulted person's color,
// when there is one, still wins over this).
// `calendars[].exclude` is optional — a regex, or an array of them (case-insensitive):
// matching ANY of them hides that event entirely, before personRules/defaultPerson ever see
// it, only from THAT calendar.
// Malformed JSON, or an entry missing its required field, is skipped rather than erroring
// the whole render — this is designed to be generated by /tools/config-editor.html, not
// necessarily hand-typed, so being forgiving of partial/in-progress edits matters more than
// strict validation.

function parseConfig(raw) {
  const empty = { calendars: [], people: {} };
  if (typeof raw !== "string" || !raw.trim()) return empty;
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return empty;
  }
  if (!data || typeof data !== "object") return empty;

  // Keyed by lowercased name so personRules/defaultPerson lookups are case-insensitive, same
  // as the regex matching around them.
  const people = {};
  for (const item of Array.isArray(data.people) ? data.people : []) {
    if (!item || typeof item !== "object") continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) continue;
    const color = typeof item.color === "string" && isValidColor(item.color.toLowerCase()) ? item.color.toLowerCase() : "";
    const badge = typeof item.badge === "string" && item.badge.trim() ? item.badge.trim() : name[0].toUpperCase();
    people[name.toLowerCase()] = { name, color, badge };
  }

  const calendars = [];
  for (const item of Array.isArray(data.calendars) ? data.calendars : []) {
    if (!item || typeof item !== "object" || typeof item.url !== "string" || !item.url.trim()) continue;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : null;
    const color = typeof item.color === "string" && isValidColor(item.color.toLowerCase()) ? item.color.toLowerCase() : null;
    const exclude = compileRegexList(item.exclude);
    const defaultPerson = typeof item.defaultPerson === "string" && item.defaultPerson.trim() ? item.defaultPerson.trim() : null;

    const personRules = [];
    for (const rule of Array.isArray(item.personRules) ? item.personRules : []) {
      if (!rule || typeof rule !== "object") continue;
      const matchSrc = typeof rule.match === "string" ? rule.match : "";
      const person = typeof rule.person === "string" ? rule.person.trim() : "";
      if (!matchSrc || !person) continue;
      let rx;
      try {
        rx = new RegExp(matchSrc, "i");
      } catch (e) {
        continue;
      }
      personRules.push({ rx, person, rename: rule.rename !== false });
    }

    calendars.push({ id, url: item.url.trim(), color, exclude, defaultPerson, personRules });
  }

  return { calendars, people };
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
  let personName = null;
  for (const rule of cal.personRules) {
    if (!rule.rx.test(title)) continue;
    if (rule.rename) {
      title = title.replace(new RegExp(rule.rx.source, "gi"), rule.person);
    }
    personName = rule.person;
  }
  if (personName === null) personName = cal.defaultPerson;

  let hue = null;
  let badge = null;
  if (personName) {
    const p = people[personName.toLowerCase()];
    if (p) {
      if (p.color) hue = p.color;
      badge = p.badge;
    }
  }
  return { title, hue, badge };
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
// Weekday/month names come straight from Intl.DateTimeFormat instead of a hand-rolled
// table — the engine's own ICU data covers essentially any real locale, which is both a
// broader net than the 5 languages a hand-picked table would cover and one less thing to
// maintain. Only "unavailable" (a UI string Intl has no way to translate) still needs one.

const UNAVAILABLE = {
  en: "Calendar unavailable",
  nl: "Kalender niet beschikbaar",
  fr: "Agenda indisponible",
  de: "Kalender nicht verfügbar",
  es: "Calendario no disponible",
};

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
  const wd = localeDatePart(locale, "short", "weekday", civil.y, civil.mo, civil.d);
  const month = localeDatePart(locale, "long", "month", civil.y, civil.mo, civil.d);
  return wd + " " + civil.d + " " + month;
}

function dayLabelShort(civil, locale) {
  // Abbreviated-month variant for narrow layouts (quadrant, half_vertical, or a wide Days-to-
  // Show setting) — the full month name is what wraps/gets clipped there, e.g. "Zo 5 Juli"
  // losing "Juli" off the header at 7 columns; the weekday/day are already short enough not
  // to need shrinking.
  const wd = localeDatePart(locale, "short", "weekday", civil.y, civil.mo, civil.d);
  const month = localeDatePart(locale, "short", "month", civil.y, civil.mo, civil.d);
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

const HEADER_PCT = 15; // bumped from 11 to fit a second line (daily high/low) under the day label
const ALLDAY_ROW_PCT = 6;
const TITLE_BAR_PCT = 6; // optional plugin-name bar at the very top, off by default (see run())
const MIN_EVENT_PCT = 10; // floor so a block is never a literally invisible sliver — actual font
                           // sizing is handled client-side by the fit-text script (see shared.liquid),
                           // which measures the real rendered box and grows/shrinks text to match.
                           // Unlike every other *_pct value on this page, an event's own top_pct/
                           // height_pct (see layoutNative) are a share of grid_pct specifically (the
                           // day column's own height), not the whole screen — events are an
                           // absolutely-positioned overlay sized relative to their direct container.
const IMPORTANT_HOUR_WEIGHT = 4; // every hour in the configured day_start-day_end range gets this
                                  // many times the vertical space of an hour outside it

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

function layoutNative(days, importantStart, importantEnd, nowH, sunMarks, hourlyWeather, titleBarPct, calendarColors) {
  importantStart = Math.max(0, Math.min(23, Math.trunc(importantStart)));
  importantEnd = Math.max(importantStart + 1, Math.min(24, Math.trunc(importantEnd)));

  const maxAdRows = days.length ? Math.max(...days.map((d) => d.allday.length)) : 0;
  const alldayPct = Math.min(3, maxAdRows) * ALLDAY_ROW_PCT;
  const gridBase = HEADER_PCT + alldayPct + titleBarPct;
  const gridPct = 100 - gridBase;

  // The full day (0-24) is always shown — day_start/day_end mark an "important" range that
  // gets more vertical weight per hour, while hours outside still show, just compressed.
  //
  // h--[Ncqh] is a bracket "arbitrary value" utility class that only works for INTEGERS: a
  // decimal value silently no-ops (the element falls back to its unstyled content-box
  // height). So every hour in the important zone must share one INTEGER percent, and every
  // hour outside it another — but scaling an integer weight ratio essentially never divides
  // gridPct evenly, so the leftover remainder has to land somewhere. Putting it on the
  // important hours would break the exact uniformity that's the whole point here; instead
  // spread it one-per-hour across the LEAST prominent (compressed, outside-range) hours,
  // where a handful being 1% taller than the rest is essentially invisible.
  const importantN = importantEnd - importantStart;
  const outsideN = 24 - importantN;
  const totalUnits = IMPORTANT_HOUR_WEIGHT * importantN + outsideN;

  // Floor (not round) each zone's ideal share — floors always sum to at most gridPct, never
  // over, so the leftover ("deficit") is always >= 0 and only ever needs handing OUT as +1s,
  // never clawed back.
  const importantBase = Math.trunc((IMPORTANT_HOUR_WEIGHT / totalUnits) * gridPct);
  const outsideBase = outsideN ? Math.trunc((1 / totalUnits) * gridPct) : 0;
  const deficit = gridPct - (importantBase * importantN + outsideBase * outsideN);

  const bumpOutside = Math.min(deficit, outsideN);
  const bumpImportant = deficit - bumpOutside;

  const hourPct = [];
  let outsideBumped = 0, importantBumped = 0;
  for (let h = 0; h < 24; h++) {
    if (importantStart <= h && h < importantEnd) {
      const extra = importantBumped < bumpImportant ? 1 : 0;
      importantBumped += extra;
      hourPct.push(importantBase + extra);
    } else {
      const extra = outsideBumped < bumpOutside ? 1 : 0;
      outsideBumped += extra;
      hourPct.push(outsideBase + extra);
    }
  }

  const cumPct = [0];
  for (const p of hourPct) cumPct.push(cumPct[cumPct.length - 1] + p);

  function pctAt(tt) {
    const whole = Math.trunc(tt);
    const frac = tt - whole;
    const cum = cumPct[whole] + (whole < 24 ? hourPct[whole] * frac : 0);
    return gridBase + cum;
  }

  // Bold the hour label wherever a timed event starts TODAY specifically, so the axis
  // doubles as a quick glance of "something happens around here" for the day that matters
  // most — bolding for every visible day made the axis mostly-bold on a busy week and lost
  // that at-a-glance signal. Deliberately independent of "now": this marks where today's
  // events are anchored on the axis, not what's still upcoming.
  const startHoursToday = new Set();
  for (const d of days) {
    if (!d.isToday) continue;
    for (const e of d.timed) {
      if (e.h0 >= 0 && e.h0 < 24) startHoursToday.add(Math.trunc(e.h0));
    }
  }
  const hourRows = [];
  for (let h = 0; h < 24; h++) {
    hourRows.push({ hour: h, pct: hourPct[h], shade: h % 2, bold: startHoursToday.has(h), important: importantStart <= h && h < importantEnd });
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
      segments.push({ pct, shade, night: isNight(mid), weather: dayWeather[Math.trunc(a)] || null });
    }

    // "Now" is an absolutely-positioned overlay too, for the same reason events are: its
    // position is derived straight from pctAt(nowH), independent of the segment list, so
    // nothing about today's own background sizing ever has to change to show it.
    let nowMarker = null;
    if (d.isToday && nowH !== null && nowH !== undefined && nowH >= 0 && nowH < 24) {
      const top = pctAt(nowH) - gridBase;
      nowMarker = { top_pct: round4((top / gridPct) * 100), night: isNight(nowH) };
    }

    // Events are absolutely-positioned overlays, sized straight from pctAt() on each
    // cluster's own h0/h1 as a fraction of the GRID area's own height — independent of the
    // background's own segmentation, so an event's minimum-size enforcement can never borrow
    // space from a spacer and drag its rendered start time away from its real hour.
    const events = [];
    const sortedClusters = [...clusters].sort((a, b) => a.h0 - b.h0);
    sortedClusters.forEach((c, idx) => {
      const top = pctAt(c.h0) - gridBase;
      let height = pctAt(c.h1) - gridBase - top;
      if (height < MIN_EVENT_PCT) {
        const nextTop = idx + 1 < sortedClusters.length ? pctAt(sortedClusters[idx + 1].h0) - gridBase : gridPct;
        height = Math.min(MIN_EVENT_PCT, Math.max(0, nextTop - top));
      }
      const lanes = [...c.lanes].sort((p, q) => p[1] - q[1]).map((p) => {
        const ev = p[0];
        const color = ev.hueOverride || hueOf(ev.calIdx, calendarColors);
        return { title: ev.title, hue: colorClass(color), fg: foregroundFor(color), badge: ev.badge || null };
      });
      events.push({ top_pct: round4((top / gridPct) * 100), height_pct: round4((height / gridPct) * 100), lanes });
    });

    outDays.push({
      label: d.label, label_short: d.labelShort, is_today: d.isToday,
      temp: d.temp || null, icon: d.icon || null,
      allday: d.allday.map((a) => ({
        title: a.title, hue: colorClass(a.hue), fg: foregroundFor(a.hue), badge: a.badge,
        continues_before: a.continuesBefore, continues_after: a.continuesAfter,
      })),
      segments, events, now_marker: nowMarker,
    });
  });

  return { header_pct: HEADER_PCT, allday_pct: alldayPct, grid_pct: gridPct, title_bar_pct: titleBarPct, hour_rows: hourRows, days: outDays };
}
