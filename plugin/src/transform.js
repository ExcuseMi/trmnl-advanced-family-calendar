
const DEFAULT_DAYS = 3;
const DEFAULT_HOURS = { start: 7, end: 21 };
const WD_MAP = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };

const HUES = ["blue", "green", "orange", "purple", "red", "cyan", "pink", "lime", "violet", "yellow"];
const GRAY_SHADES = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75];
const BLACK_WHITE = ["black", "white"];

function isValidColor(v) {
  if (HUES.includes(v) || BLACK_WHITE.includes(v)) return true;
  const m = /^gray-(\d+)$/.exec(v);
  return !!m && GRAY_SHADES.includes(parseInt(m[1], 10));
}

function colorClass(color) {
  return HUES.includes(color) ? color + "-65" : color;
}

function foregroundFor(color) {
  if (color === "black") return "white";
  if (color === "white") return "black";
  const m = /^gray-(\d+)$/.exec(color);
  if (!m) return "black";
  return parseInt(m[1], 10) < 45 ? "white" : "black";
}

async function run(input) {
  const cfg = parseConfig(cf(input, "calendars"));
  const calendars = cfg.calendars;
  const people = cfg.people;
  const calendarColors = calendars.map((c) => c.color);
  const locale = cfg.locale || localeOf(input);
  const tzname = cfg.timeZone || cf(input, "time_zone").trim() || userTz(input) || "UTC";
  const is12h = cf(input, "time_format").trim().toLowerCase() === "12h";
  const location = cf(input, "lat_lon");
  const fahrenheit = cf(input, "temperature_unit").trim().toLowerCase() === "fahrenheit";
  const rssUrl = cf(input, "rss_url").trim();
  const rssLabel = cf(input, "rss_label").trim() || "NEWS";
  const daysN = toInt(cf(input, "view_days"), DEFAULT_DAYS, 1, 3);

  const tz = resolveTz(tzname, input);

  if (!calendars.length) {
    return emptyResult(tzname, tz, locale, daysN, is12h, "No ICS URL configured");
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
      const resp = await fetchWithTimeout(url, 4000, { headers: { "User-Agent": "TRMNL-ICS-Calendar" } });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const text = await resp.text();
      collectIcs(text, tz, winSEpoch, winEEpoch, occ, calIdx);
    } catch (exc) {
      errors.push(String((exc && exc.message) || exc));
    }
  }

  let err = null;
  if (errors.length && !occ.length) err = "Fetch/parse failed: " + errors[0];

  const filtered = occ.filter((e) => {
    const cal = calendars[e.calIdx];
    return !cal.exclude.some((rx) => rx.test(e.title));
  });
  for (const e of filtered) {
    const r = applyCalendarPerson(e.title, calendars[e.calIdx], people);
    e.title = r.title;
    e.hueOverride = r.hue;
    e.personBadges = r.badges;
  }

  const dayBounds = [];
  const rawDays = [];
  for (let i = 0; i < daysN; i++) {
    const d0Civil = addCivilDays({ ...winSCivil, h: 0, mi: 0, s: 0 }, i);
    const d0Epoch = zonedTimeToUtc(d0Civil.y, d0Civil.mo, d0Civil.d, 0, 0, 0, tz);
    const d1Civil = addCivilDays(d0Civil, 1);
    const d1Epoch = zonedTimeToUtc(d1Civil.y, d1Civil.mo, d1Civil.d, 0, 0, 0, tz);
    dayBounds.push({ d0Epoch, d1Epoch });

    const timed = [];
    for (const e of filtered) {
      if (e.allDay || e.endEpoch - e.startEpoch >= 86400000) continue;
      if (!(e.startEpoch < d1Epoch && e.endEpoch > d0Epoch)) continue;
      const vs = Math.max(e.startEpoch, d0Epoch);
      const ve = Math.min(e.endEpoch, d1Epoch);
      timed.push({
        h0: (vs - d0Epoch) / 3600000,
        h1: (ve - d0Epoch) / 3600000,
        title: e.title,
        calIdx: e.calIdx,
        hueOverride: e.hueOverride,
        personBadges: e.personBadges,
        label: fmtTime(vs, tz, is12h) + "–" + fmtTime(ve, tz, is12h),
      });
    }
    timed.sort((a, b) => a.h0 - b.h0);
    rawDays.push({
      label: dayLabel(d0Civil, locale),
      labelShort: dayLabelShort(d0Civil, locale),
      labelShortWeekday: dayLabelShortParts(d0Civil, locale).weekday,
      labelShortRest: dayLabelShortParts(d0Civil, locale).rest,
      isToday: i === 0,
      timed,
    });
  }

  const alldaySpans = [];
  for (const e of filtered) {
    if (!(e.allDay || e.endEpoch - e.startEpoch >= 86400000)) continue;
    let startCol = -1, endCol = -1;
    for (let i = 0; i < daysN; i++) {
      if (e.startEpoch < dayBounds[i].d1Epoch && e.endEpoch > dayBounds[i].d0Epoch) {
        if (startCol === -1) startCol = i;
        endCol = i;
      }
    }
    if (startCol === -1) continue;
    alldaySpans.push({
      e, startCol, span: endCol - startCol + 1,
      continuesBefore: e.startEpoch < dayBounds[startCol].d0Epoch,
      continuesAfter: e.endEpoch > dayBounds[endCol].d1Epoch,
    });
  }
  alldaySpans.sort((a, b) => a.startCol - b.startCol || b.span - a.span);
  const rowEnds = [];
  for (const s of alldaySpans) {
    const endCol = s.startCol + s.span - 1;
    let row = 0;
    while (row < rowEnds.length && rowEnds[row] >= s.startCol) row++;
    if (row >= 3) { s.row = -1; continue; }
    s.row = row;
    rowEnds[row] = endCol;
  }
  const alldayBars = alldaySpans.filter((s) => s.row !== -1).map((s) => ({
    title: s.e.title,
    hue: s.e.hueOverride || hueOf(s.e.calIdx, calendarColors),
    personBadges: s.e.personBadges,
    startCol: s.startCol,
    span: s.span,
    row: s.row,
    continuesBefore: s.continuesBefore,
    continuesAfter: s.continuesAfter,
  }));

  const nowH = (nowEpoch - winSEpoch) / 3600000;
  const [sky, rssHeadline] = await Promise.all([fetchSky(location, daysN, fahrenheit), fetchRssHeadline(rssUrl, rssLabel)]);
  const newsPct = rssHeadline ? NEWS_PCT : 0;
  rawDays.forEach((rd, i) => {
    rd.temp = sky.dailyTemps[i] || null;
    rd.icon = rd.temp ? dayIcon(sky.hourlyWeather[i]) : null;
  });

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
  const defaultHours = parseHours(cf(input, "hours")) || DEFAULT_HOURS;
  // "Core" bounds: the user's configured range plus anything with real content (sunrise/sunset,
  // actual events) — deliberately excludes nowH, so a lone "it's currently 2am" doesn't itself
  // count as content. "now" is added only afterward (outerStartH/outerEndH) purely so the current
  // hour always has a row to land on; hours that exist ONLY because of that get compressed
  // (see EXTENSION_WEIGHT in layoutNative) instead of sharing the core range's full-size rows.
  const coreStartCandidates = [defaultHours.start, sunriseMark ? sunriseMark.hour : null, ...eventStarts].filter((h) => h !== null && h !== undefined);
  const coreEndCandidates = [defaultHours.end, sunsetMark ? sunsetMark.hour : null, ...eventEnds].filter((h) => h !== null && h !== undefined);
  const coreStartH = Math.floor(Math.min(...coreStartCandidates));
  let coreEndH = Math.ceil(Math.max(...coreEndCandidates));
  coreEndH = Math.max(coreEndH, coreStartH + 1);
  const startH = nowH !== null && nowH !== undefined ? Math.min(coreStartH, Math.floor(nowH)) : coreStartH;
  let endH = nowH !== null && nowH !== undefined ? Math.max(coreEndH, Math.ceil(nowH) + 1) : coreEndH;
  endH = Math.max(endH, startH + 1);

  const grid = layoutNative(rawDays, alldayBars, startH, endH, coreStartH, coreEndH, nowH, sky.sunMarks, sky.hourlyWeather, calendarColors, HEADER_PCT, is12h, newsPct);

  const viewPeopleSeen = new Set();
  const viewPeople = [];
  for (const b of [...alldayBars.flatMap((a) => a.personBadges || []), ...rawDays.flatMap((d) => d.timed.flatMap((t) => t.personBadges || []))]) {
    if (!b.person || viewPeopleSeen.has(b.person)) continue;
    viewPeopleSeen.add(b.person);
    viewPeople.push({ text: b.text, person: b.person, hue: b.hue, fg: b.fg });
  }

  const data = Object.assign({}, grid, {
    people: viewPeople,
    generated_at: Math.floor(nowEpoch / 1000),
    tz: tzname,
    error: err,
    unavailable_label: unavailableText(locale),
    all_day_label: allDayText(locale),
    has_events: alldayBars.length > 0 || rawDays.some((d) => d.timed.length),
    weather_error: sky.error,
    temp_unit: fahrenheit ? "F" : "C",
    rss_headline: rssHeadline,
  });
  return { data };
}

function cf(input, key) {
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

function parseHours(raw) {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(String(raw || ""));
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  if (!(start >= 0 && start < end && end <= 24)) return null;
  return { start, end };
}

function emptyResult(tzname, tz, locale, daysN, is12h, msg) {
  const nowEpoch = Date.now();
  const nowCivil = fromEpoch(nowEpoch, tz);
  const winSCivil = { y: nowCivil.y, mo: nowCivil.mo, d: nowCivil.d, h: 0, mi: 0, s: 0 };
  const days = [];
  for (let i = 0; i < daysN; i++) {
    const d0Civil = addCivilDays(winSCivil, i);
    days.push({
      label: dayLabel(d0Civil, locale),
      labelShort: dayLabelShort(d0Civil, locale),
      labelShortWeekday: dayLabelShortParts(d0Civil, locale).weekday,
      labelShortRest: dayLabelShortParts(d0Civil, locale).rest,
      isToday: i === 0,
      timed: [],
    });
  }
  const grid = layoutNative(days, [], 8, 22, null, null, null, null, HEADER_PCT, is12h);
  const data = Object.assign({}, grid, {
    people: [],
    generated_at: Math.floor(nowEpoch / 1000),
    tz: tzname,
    error: msg,
    unavailable_label: unavailableText(locale),
    all_day_label: allDayText(locale),
    has_events: false,
    weather_error: null,
    temp_unit: "C",
    rss_headline: null,
  });
  return { data };
}

function parseConfig(raw) {
  const empty = { calendars: [], people: {}, locale: null, timeZone: null };
  if (typeof raw !== "string" || !raw.trim()) return empty;
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    data = { calendars: raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) };
  }
  if (!data || typeof data !== "object") return empty;

  const locale = typeof data.locale === "string" && data.locale.trim() ? data.locale.trim() : null;

  const timeZone = typeof data.timeZone === "string" && data.timeZone.trim() ? data.timeZone.trim() : null;

  const people = {};
  for (const item of Array.isArray(data.people) ? data.people : []) {
    if (!item || typeof item !== "object") continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) continue;
    const color = typeof item.color === "string" && isValidColor(item.color.toLowerCase()) ? item.color.toLowerCase() : "";
    const badge = (typeof item.badge === "string" && item.badge.trim() ? item.badge.trim() : name[0].toUpperCase()).slice(0, 1).toUpperCase();
    people[name.toLowerCase()] = { name, color, badge };
  }

  const calendars = [];
  for (const raw_item of Array.isArray(data.calendars) ? data.calendars : []) {
    const item = typeof raw_item === "string" ? { url: raw_item } : raw_item;
    if (!item || typeof item !== "object" || typeof item.url !== "string" || !item.url.trim()) continue;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : null;
    const color = typeof item.color === "string" && isValidColor(item.color.toLowerCase()) ? item.color.toLowerCase() : null;
    const exclude = compileRegexList(item.exclude);
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

    calendars.push({ id, url: item.url.trim(), color, exclude, defaultPerson, personRules });
  }

  return { calendars, people, locale, timeZone };
}

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
      title = title.replace(new RegExp(rule.rx.source, "gi"), rule.people.join(" & "));
    }
    personNames = rule.people;
  }
  if (personNames === null) personNames = cal.defaultPerson;

  let hue = null;
  const badges = [];
  if (personNames) {
    for (const personName of personNames) {
      const p = people[personName.toLowerCase()];
      if (!p) continue;
      if (hue === null && p.color) hue = p.color;
      const badgeHue = p.color ? colorClass(p.color) : "black";
      const badgeFg = p.color ? foregroundFor(p.color) : "white";
      badges.push({ text: p.badge, person: p.name, hue: badgeHue, fg: badgeFg });
    }
  }
  return { title, hue, badges };
}

function localeOf(input) {
  try {
    const loc = input.trmnl.user.locale;
    if (typeof loc === "string" && loc.trim()) return loc.trim();
  } catch (e) {}
  return "en";
}

function unavailableText(locale) {
  const code = String(locale).toLowerCase().split(/[-_]/)[0];
  return (UNAVAILABLE[code] || UNAVAILABLE.en);
}

function allDayText(locale) {
  const code = String(locale).toLowerCase().split(/[-_]/)[0];
  return (ALL_DAY_LABEL[code] || ALL_DAY_LABEL.en);
}

function userTz(input) {
  try {
    const tz = input.trmnl.user.time_zone_iana;
    return typeof tz === "string" && tz.trim() ? tz.trim() : null;
  } catch (e) {
    return null;
  }
}

function userUtcOffsetMinutes(input) {
  try {
    const s = input.trmnl.user.utc_offset;
    const n = Number(s);
    return isFinite(n) ? n / 60 : null;
  } catch (e) {
    return null;
  }
}

function resolveTz(tzname, input) {
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
  if (typeof tz === "number") return tz;
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
  if (h === 24) h = 0;
  return { y, mo, d, h, mi: +parts.minute, s: +parts.second, wd: civilWeekday(y, mo, d) };
}

function zonedTimeToUtc(y, mo, d, h, mi, s, tz) {
  if (typeof tz === "number") return Date.UTC(y, mo - 1, d, h, mi, s) - tz * 60000;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = getOffsetMinutes(guess, tz);
  const t1 = guess - off1 * 60000;
  const off2 = getOffsetMinutes(t1, tz);
  return guess - off2 * 60000;
}

function civilWeekday(y, mo, d) {
  return (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
}

function civilDateOrdinal(y, mo, d) {
  return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
}

function ordinalToYmd(ordinal) {
  const dt = new Date(ordinal * 86400000);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function addCivilDays(civil, n) {
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

function dayLabelShortParts(civil, locale) {
  const code = String(locale).toLowerCase().split(/[-_]/)[0];
  const t = I18N[code];
  const wd = t ? t.wd[civilWeekday(civil.y, civil.mo, civil.d)] : localeDatePart(locale, "short", "weekday", civil.y, civil.mo, civil.d);
  const month = t ? t.months_short[civil.mo - 1] : localeDatePart(locale, "short", "month", civil.y, civil.mo, civil.d);
  return { weekday: wd, rest: civil.d + " " + month };
}

function dayLabelShort(civil, locale) {
  const p = dayLabelShortParts(civil, locale);
  return p.weekday + " " + p.rest;
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

const ICON_BASE = "https://trmnl.com/images/plugins/weather/";
const ICON_PRIORITY = ["storm", "snow", "rain", "fog"];
const ICON_FILE = { storm: "wi-day-thunderstorm.svg", snow: "wi-day-snow.svg", rain: "wi-day-rain.svg", fog: "wi-day-fog.svg" };

function dayIcon(hours) {
  const present = new Set(Object.values(hours || {}));
  const kind = ICON_PRIORITY.find((k) => present.has(k)) || null;
  return ICON_BASE + (kind ? ICON_FILE[kind] : "wi-day-sunny.svg");
}

function splitIsoLocal(iso) {
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
    return { sunMarks: {}, hourlyWeather: {}, dailyTemps: {}, error: (exc && exc.name ? exc.name : "Error") + ": " + (exc && exc.message ? exc.message : exc) };
  }
}

function decodeXmlEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/<[^>]+>/g, "")
    .trim();
}

const RSS_HEADLINE_LIMIT = 3;
const RSS_HEADLINE_SEPARATOR = "   •   ";
const RSS_LABEL_SEPARATOR = "  »  ";

function findElements(xml, localName, limit) {
  const results = [];
  const openRe = new RegExp("<(?:[\\w-]+:)?" + localName + "\\b([^>]*?)(/)?>", "gi");
  let open;
  while (results.length < limit && (open = openRe.exec(xml)) !== null) {
    if (open[2]) { results.push(""); continue; }
    const closeRe = new RegExp("<\\/(?:[\\w-]+:)?" + localName + "\\s*>", "i");
    const rest = xml.slice(openRe.lastIndex);
    const close = closeRe.exec(rest);
    if (close) {
      results.push(rest.slice(0, close.index));
      openRe.lastIndex += close.index + close[0].length;
    } else {
      results.push("");
    }
  }
  return results;
}

function findFirstElement(xml, localName) {
  const all = findElements(xml, localName, 1);
  return all.length ? all[0] : null;
}

async function fetchRssHeadline(url, label) {
  url = (url || "").trim();
  if (!url) return null;
  try {
    const resp = await fetchWithTimeout(url, 4000, { headers: { "User-Agent": "TRMNL-ICS-Calendar" } });
    if (!resp.ok) return null;
    const text = await resp.text();
    let entries = findElements(text, "item", RSS_HEADLINE_LIMIT);
    if (!entries.length) entries = findElements(text, "entry", RSS_HEADLINE_LIMIT);
    const titles = entries
      .map((entryXml) => findFirstElement(entryXml, "title"))
      .filter((t) => t)
      .map((t) => decodeXmlEntities(t))
      .filter((t) => t);
    if (!titles.length) return null;
    const joined = titles.join(RSS_HEADLINE_SEPARATOR);
    return label ? label + RSS_LABEL_SEPARATOR + joined : joined;
  } catch (exc) {
    return null;
  }
}

const HEADER_PCT = 11;
const FOOTER_PCT = 7;
const NEWS_PCT = 2;
const ALLDAY_ROW_PCT = 10;
const MIN_EVENT_PCT = 10;
function hueOf(calIdx, calendarColors) {
  if (calendarColors && calIdx < calendarColors.length && calendarColors[calIdx]) return calendarColors[calIdx];
  return HUES[calIdx % HUES.length];
}

function cluster(events) {
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

// An hour inside the core range (the user's configured hours, sunrise/sunset, or a real event)
// gets a full share of the grid; an hour that only exists because it's outside that range but
// still inside the outer (nowH-widened) window gets EXTENSION_WEIGHT's fraction of a full
// share instead — compressed to a thin sliver rather than either disappearing (outside the
// outer window still gets a real 0) or padding out to match a genuinely relevant hour.
const EXTENSION_WEIGHT = 0.4;

function layoutNative(days, alldayBars, outerStart, outerEnd, coreStart, coreEnd, nowH, sunMarks, hourlyWeather, calendarColors, headerPct, is12h, newsPct) {
  outerStart = Math.max(0, Math.min(23, Math.trunc(outerStart)));
  outerEnd = Math.max(outerStart + 1, Math.min(24, Math.trunc(outerEnd)));
  coreStart = Math.max(outerStart, Math.min(23, Math.trunc(coreStart)));
  coreEnd = Math.max(coreStart + 1, Math.min(outerEnd, Math.trunc(coreEnd)));
  newsPct = newsPct || 0;

  const headerRenderedPct = headerPct + newsPct;
  const maxAdRows = alldayBars.length ? Math.max(...alldayBars.map((b) => b.row)) + 1 : 0;
  const alldayPct = Math.min(3, maxAdRows) * ALLDAY_ROW_PCT;
  const gridBase = headerRenderedPct + alldayPct;
  const gridPct = 100 - gridBase - FOOTER_PCT;

  const weight = new Array(24).fill(0);
  let totalWeight = 0;
  for (let h = outerStart; h < outerEnd; h++) {
    weight[h] = h >= coreStart && h < coreEnd ? 1 : EXTENSION_WEIGHT;
    totalWeight += weight[h];
  }
  const hourPct = new Array(24).fill(0);
  let prevCum = 0;
  let cumW = 0;
  for (let h = outerStart; h < outerEnd; h++) {
    cumW += weight[h];
    const cum = Math.round((cumW * gridPct) / totalWeight);
    hourPct[h] = cum - prevCum;
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
  const hasNowHour = nowH !== null && nowH !== undefined && nowH >= 0 && nowH < 24;
  const nowHour = hasNowHour ? Math.floor(nowH) : null;
  const hourRows = [];
  for (let h = 0; h < 24; h++) {
    const hourDisplay = is12h ? (h % 12 || 12) : h;
    const period = is12h ? (h < 12 ? "AM" : "PM") : null;
    hourRows.push({
      hour: hourDisplay, period, pct: hourPct[h], shade: h % 2, bold: h === nextHour,
      important: coreStart <= h && h < coreEnd, current: h === nowHour,
    });
  }

  const outDays = [];
  days.forEach((d, di) => {
    let clusters = cluster(d.timed).filter((c) => Math.max(c.h0, 0) < Math.min(c.h1, 24));
    for (const c of clusters) {
      c.h0 = Math.max(c.h0, 0);
      c.h1 = Math.min(c.h1, 24);
    }

    const boundsSet = new Set([0, 24]);
    for (let h = 1; h < 24; h++) boundsSet.add(h);

    const daySun = (sunMarks || {})[0] || [];
    const sunriseMark = daySun.find((m) => m.kind === "sunrise");
    const sunsetMark = daySun.find((m) => m.kind === "sunset");
    const sunriseH = sunriseMark ? sunriseMark.hour : null;
    const sunsetH = sunsetMark ? sunsetMark.hour : null;
    for (const h of [sunriseH, sunsetH]) {
      if (h !== null && h >= 0 && h < 24) boundsSet.add(h);
    }
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
      const h = Math.trunc(a);
      const pct = Math.round(hourPct[h] * (b - h)) - Math.round(hourPct[h] * (a - h));
      const shade = Math.trunc(a) % 2;
      const past = hasNow && a < nowH;
      segments.push({ pct, shade, night: isNight(mid), past, weather: dayWeather[Math.trunc(a)] || null });
    }

    let nowMarker = null;
    if (d.isToday && nowH !== null && nowH !== undefined && nowH >= 0 && nowH < 24) {
      const top = pctAt(nowH) - gridBase;
      nowMarker = { top_pct: round4((top / gridPct) * 100), night: isNight(nowH) };
    }

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
        fg: foregroundFor(color),
      });
    });

    outDays.push({
      label: d.label, label_short: d.labelShort,
      label_short_weekday: d.labelShortWeekday, label_short_rest: d.labelShortRest,
      is_today: d.isToday,
      temp: d.temp || null, icon: d.icon || null,
      segments, events, now_marker: nowMarker,
    });
  });

  const alldayBarsOut = alldayBars.map((b) => ({
    title: b.title, hue: colorClass(b.hue), fg: foregroundFor(b.hue),
    start_col: b.startCol, span: b.span, row: b.row,
    continues_before: b.continuesBefore, continues_after: b.continuesAfter,
  }));

  return { header_pct: headerRenderedPct, allday_pct: alldayPct, allday_row_pct: ALLDAY_ROW_PCT, allday_bars: alldayBarsOut, allday_max_rows: maxAdRows, grid_pct: gridPct, footer_pct: FOOTER_PCT, news_pct: newsPct, hour_rows: hourRows, days: outDays };
}
