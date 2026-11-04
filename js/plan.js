/* ==========================================================================
   plan.js — loads plan.json and resolves "what should I actually do today".

   Two ideas:

   1. The TEMPLATE (plan.json) never changes while you use the app.
   2. Your EDITS live in Store.overrides, and are layered on top.

   So "reset this session" is always possible, and you can see what the
   original plan said. Nothing is destructive.
   ========================================================================== */

const Plan = (() => {
  let plan = null;
  let index = [];        // every session, flat, with its template date
  let byDate = new Map(); // ISO date -> [entry]

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  /* ---------- date helpers (local time, never UTC) ---------- */
  function parseISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function isoOf(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  function addDays(iso, n) {
    const d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }
  function todayISO() { return toISO(new Date()); }
  function dayName(iso) { return DAY_NAMES[parseISO(iso).getDay()]; }
  function dayShort(iso) { return DAY_SHORT[parseISO(iso).getDay()]; }
  function prettyDate(iso, withYear) {
    const d = parseISO(iso);
    const s = `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
    return withYear ? `${s}, ${d.getFullYear()}` : s;
  }
  function monthLabel(year, month) { return `${MONTHS[month]} ${year}`; }
  function daysBetween(a, b) {
    return Math.round((parseISO(b) - parseISO(a)) / 86400000);
  }
  function startOfWeek(iso) {
    // weeks run Monday -> Sunday
    const d = parseISO(iso);
    const shift = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - shift);
    return toISO(d);
  }

  /* ---------- loading ---------- */
  async function load() {
    // A plan you imported yourself lives in localStorage and wins over the
    // built-in plan.json. "Use built-in plan" in Settings clears it.
    const custom = Store.state.customPlan;
    if (custom && Array.isArray(custom.weeks) && custom.weeks.length &&
        custom.weeks.every(w => w && Array.isArray(w.days))) {
      plan = custom;
    } else {
      const res = await fetch('plan.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('Could not load plan.json (' + res.status + ')');
      plan = await res.json();
    }
    buildIndex();
    return plan;
  }

  /* Some very old workouts used long labels as disciplines. Treat them as
     their real sport so colors, icons and totals all work. */
  function normalizeDiscipline(d) {
    if (d === 'sat_run') return 'run';
    if (d === 'sun_bike') return 'bike';
    return d;
  }

  function buildIndex() {
    index = [];
    byDate = new Map();

    for (const week of plan.weeks) {
      for (const day of week.days) {
        (day.sessions || []).forEach((session, si) => {
          if (!session.id) {
            session.id = `w${week.weekNumber}-${day.dayOfWeek || day.date || 'day'}-${session.discipline || 's'}${si + 1}`;
          }
          if (!session.athletes) session.athletes = ['eric', 'ella'];
          session.discipline = normalizeDiscipline(session.discipline || 'rest');
          index.push({
            session,
            weekNumber: week.weekNumber,
            phase: week.phase,
            templateDate: day.date
          });
        });
      }
    }

    for (const extra of Store.state.extras) {
      index.push({
        session: Object.assign({}, extra, {
          id: extra.id,
          athletes: extra.athletes || [extra.athlete || 'eric'],
          discipline: normalizeDiscipline(extra.discipline),
          isExtra: true
        }),
        weekNumber: weekNumberFor(extra.date),
        phase: phaseForDate(extra.date),
        templateDate: extra.date
      });
    }

    rebuild();
  }

  /* Index an entry under every date it could appear on. Per-athlete moves
     (Eric moves it, Ella leaves it) need more than one bucket. */
  function rebuild() {
    byDate = new Map();
    for (const entry of index) {
      const ov = Store.getOverride(entry.session.id) || {};
      const dates = new Set([entry.templateDate]);
      if (ov.date) dates.add(ov.date);
      if (ov.eric && ov.eric.date) dates.add(ov.eric.date);
      if (ov.ella && ov.ella.date) dates.add(ov.ella.date);
      for (const d of dates) {
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d).push(entry);
      }
    }
  }

  /* ---------- resolution ---------- */
  /* Merge template session + variant + overrides into one flat object
     for a specific athlete. */
  function resolve(entry, athlete) {
    const s = entry.session;
    const base = Object.assign({}, s, (s.variants && s.variants[athlete]) || {});
    const ov = Store.getOverride(s.id);
    const scoped = ov[athlete] || {};

    const out = Object.assign({}, base, {
      id: s.id,
      athletes: s.athletes,
      weekNumber: entry.weekNumber,
      phase: entry.phase,
      templateDate: entry.templateDate,
      date: scoped.date || ov.date || entry.templateDate,
      pooled: Store.isPooledAnywhere(s.id),
      isExtra: !!s.isExtra,
      overridden: Object.keys(ov).length > 0
    });

    for (const field of ['duration', 'intensity', 'sets', 'notes', 'distanceKm', 'fueling', 'title']) {
      if (ov[field] !== undefined) out[field] = ov[field];
      if (scoped[field] !== undefined) out[field] = scoped[field];
    }

    // week scaling only applies where you haven't set an explicit duration
    const scale = Store.getWeekScale(entry.weekNumber);
    if (scale !== 1 && ov.duration === undefined && scoped.duration === undefined) {
      out.duration = Math.round((out.duration * scale) / 5) * 5;
    }

    out.done = Store.isDone(s.id, athlete);
    out.log = Store.getLog(s.id, athlete);
    return out;
  }

  /* Get the day-of-week name (monday, tuesday, ...) for an ISO date. */
  function dayOfWeekName(iso) {
    const d = parseISO(iso);
    const idx = (d.getDay() + 6) % 7; // 0=Monday
    return ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'][idx];
  }

  /* Get template discipline for a date, or null if no override.
     A template can apply to both people or to just one of them. */
  function templateDisciplineFor(iso, athlete) {
    const template = Store.getWeekTemplate(weekNumberFor(iso));
    if (!template || !template.days) return null;
    const scope = template.scope || 'both';
    if (scope !== 'both' && athlete && scope !== athlete) return null;
    return template.days[dayOfWeekName(iso)] || null;
  }

  function isRaceSession(s) {
    return s.discipline === 'race' || !!s.race;
  }

  /* A session is "explicit" when you put it there on purpose: an extra you
     added, a race, or a template workout you moved to a different day.
     Explicit sessions ignore the weekly template — that's what makes moving
     workouts around feel flexible instead of fighting the filter. */
  function isExplicit(entry, s) {
    return !!s.isExtra || isRaceSession(s) || s.date !== entry.templateDate;
  }

  function passesTemplate(entry, s, td) {
    if (!td) return true;
    if (isExplicit(entry, s)) return true;
    if (td === 'rest') return false;
    return s.discipline === td;
  }

  /* If a day has a real workout, don't also show its placeholder "Rest". */
  function dropRestIfReal(list) {
    return list.some(s => s.discipline !== 'rest')
      ? list.filter(s => s.discipline !== 'rest')
      : list;
  }

  /* Every session for one athlete on one date, sorted by discipline order.
     If a weekly template exists for this date's week, sessions are filtered
     to match the template's discipline for that day (rest = no sessions). */
  function sessionsOn(iso, athlete) {
    const order = { swim: 0, 'open-water-swim': 1, bike: 2, brick: 3, run: 4, strength: 5, cross: 6, rest: 7, race: 8 };
    const td = templateDisciplineFor(iso, athlete);
    const list = (byDate.get(iso) || [])
      .filter(e => e.session.athletes.includes(athlete))
      .map(e => ({ entry: e, s: resolve(e, athlete) }))
      .filter(x => !x.s.pooled && x.s.date === iso)
      .filter(x => passesTemplate(x.entry, x.s, td))
      .map(x => x.s);

    return dropRestIfReal(list)
      .sort((a, b) => (order[a.discipline] ?? 9) - (order[b.discipline] ?? 9));
  }

  /* Sessions both people do side by side. Returns both Eric's and Ella's
     resolved variants so "Both" view can show per-person details. */
  function togetherOn(iso) {
    const tdE = templateDisciplineFor(iso, 'eric');
    const tdL = templateDisciplineFor(iso, 'ella');
    return (byDate.get(iso) || [])
      .filter(e => e.session.together)
      .map(e => ({ entry: e, eric: resolve(e, 'eric'), ella: resolve(e, 'ella') }))
      .filter(x => !x.eric.pooled && x.eric.date === iso && x.ella.date === iso)
      .filter(x => passesTemplate(x.entry, x.eric, tdE) && passesTemplate(x.entry, x.ella, tdL))
      .map(x => Object.assign({}, x.eric, {
        ella: x.ella,
        ellaDone: Store.isDone(x.entry.session.id, 'ella'),
        ericDone: Store.isDone(x.entry.session.id, 'eric')
      }));
  }

  /* All sessions for a whole week (used by the week planner + calendar). */
  function sessionsForWeek(weekNumber, athlete) {
    const week = weekFor(weekNumber);
    const out = [];
    for (let i = 0; i < 7; i++) {
      const iso = addDays(week.startDate, i);
      for (const s of sessionsOn(iso, athlete)) out.push(s);
    }
    return out;
  }

  /* Every workout that belongs on this week's board:
     - its template week is this week (even if it was moved away), or
     - it was moved into this week from another week.
     Pooled sessions come back with s.pooled = true. */
  function boardSessionsForWeek(weekNumber, athlete) {
    const week = weekFor(weekNumber);
    const map = new Map();

    for (const entry of index) {
      let s;
      if (athlete === 'both') {
        if (entry.session.athletes.includes('eric')) s = resolve(entry, 'eric');
        else if (entry.session.athletes.includes('ella')) s = resolve(entry, 'ella');
        else continue;
      } else {
        if (!entry.session.athletes.includes(athlete)) continue;
        s = resolve(entry, athlete);
      }

      const onThisWeek = s.date >= week.startDate && s.date <= week.endDate;
      const inThisPool = Store.isPooled(weekNumber, s.id);

      if (!inThisPool && !onThisWeek) continue;

      map.set(s.id, Object.assign({}, s, { pooled: inThisPool }));
    }
    return [...map.values()];
  }

  function pooledCount(weekNumber, athlete) {
    return boardSessionsForWeek(weekNumber, athlete).filter(s => s.pooled).length;
  }

  function weekNumberFor(iso) {
    if (!plan) return 1;
    const n = Math.floor(daysBetween(plan.startDate, startOfWeek(iso)) / 7) + 1;
    return Math.min(Math.max(n, 1), plan.weeks.length);
  }

  function phaseForDate(iso) {
    if (!plan) return 'base';
    const wk = plan.weeks[weekNumberFor(iso) - 1];
    return wk ? wk.phase : 'race_week';
  }

  function weekFor(n) {
    return plan.weeks.find(w => w.weekNumber === n) || plan.weeks[0];
  }

  function weekOf(iso) {
    return weekFor(weekNumberFor(iso));
  }

  function phaseMeta(name) {
    return (plan.phases || []).find(p => p.name === name) || { nameLabel: name, focus: '' };
  }

  /* Planned + completed hours for one week / athlete. */
  function weekHours(weekNumber, athlete) {
    const week = weekFor(weekNumber);
    let planned = 0, done = 0, total = 0, complete = 0;

    for (let i = 0; i < 7; i++) {
      const iso = addDays(week.startDate, i);
      for (const s of sessionsOn(iso, athlete)) {
        if (s.discipline === 'rest' || isRaceSession(s)) continue;
        planned += s.duration || 0;
        total += 1;
        if (s.done) { done += s.duration || 0; complete += 1; }
      }
    }
    return {
      plannedHours: planned / 60,
      doneHours: done / 60,
      total,
      complete,
      pooled: pooledCount(weekNumber, athlete),
      target: (week.targetHours && week.targetHours[athlete] != null)
        ? week.targetHours[athlete]
        : Math.round((planned / 60) * 10) / 10
    };
  }

  function raceCountdown() {
    const today = todayISO();
    const races = (plan.events || [])
      .filter(e => e.type === 'race' && e.date >= today);
    if (races.length === 0) return { days: -1, name: '' };
    const next = races.sort((a, b) => a.date.localeCompare(b.date))[0];
    return { days: daysBetween(today, next.date), name: next.name };
  }

  /* How many *finished* weeks hit at least `threshold` of their sessions.
     With no time goal, this is a more honest headline than hours. */
  function weeksAsPlanned(athlete, threshold) {
    const t = threshold == null ? 0.8 : threshold;
    const today = todayISO();
    const skipped = Store.state.skippedWeeks || [];
    let done = 0, elapsed = 0;

    for (const w of plan.weeks) {
      if (w.endDate >= today) break;
      if (skipped.includes(w.weekNumber)) continue;
      elapsed += 1;
      const h = weekHours(w.weekNumber, athlete);
      if (h.total && h.complete / h.total >= t) done += 1;
    }
    return { done, elapsed };
  }

  return {
    load,
    rebuild,
    refresh: buildIndex,
    get data() { return plan; },
    get index() { return index; },

    sessionsOn, togetherOn, sessionsForWeek, isRaceSession, resolve,
    boardSessionsForWeek, pooledCount,
    weekFor, weekOf, weekNumberFor,
    phaseForDate, phaseMeta, weekHours, weeksAsPlanned, raceCountdown,

    parseISO, toISO, isoOf, addDays, todayISO, dayName, dayShort, prettyDate,
    monthLabel, daysBetween, startOfWeek, MONTHS, dayOfWeekName
  };
})();
