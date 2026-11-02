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
    const res = await fetch('plan.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load plan.json (' + res.status + ')');
    plan = await res.json();
    buildIndex();
    return plan;
  }

  function buildIndex() {
    index = [];
    byDate = new Map();

    for (const week of plan.weeks) {
      for (const day of week.days) {
        for (const session of day.sessions) {
          index.push({
            session,
            weekNumber: week.weekNumber,
            phase: week.phase,
            templateDate: day.date
          });
        }
      }
    }

    for (const extra of Store.state.extras) {
      index.push({
        session: Object.assign({}, extra, {
          id: extra.id,
          athletes: extra.athletes || [extra.athlete || 'eric'],
          isExtra: true
        }),
        weekNumber: weekNumberFor(extra.date),
        phase: phaseForDate(extra.date),
        templateDate: extra.date
      });
    }

    rebuild();
  }

  function rebuild() {
    byDate = new Map();
    for (const entry of index) {
      const date = effectiveDate(entry);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(entry);
    }
  }

  function effectiveDate(entry) {
    const ov = Store.getOverride(entry.session.id);
    return ov.date || entry.templateDate;
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

  /* Every session for one athlete on one date, sorted by discipline order. */
  function sessionsOn(iso, athlete) {
    const order = { swim: 0, 'open-water-swim': 1, bike: 2, brick: 3, run: 4, strength: 5, rest: 6, race: 7 };
    const list = (byDate.get(iso) || [])
      .filter(e => e.session.athletes.includes(athlete))
      .map(e => resolve(e, athlete));
    return list.sort((a, b) => (order[a.discipline] ?? 9) - (order[b.discipline] ?? 9));
  }

  /* Sessions both people do side by side. */
  function togetherOn(iso) {
    return (byDate.get(iso) || [])
      .filter(e => e.session.together)
      .map(e => Object.assign(resolve(e, 'eric'), {
        ellaDone: Store.isDone(e.session.id, 'ella'),
        ericDone: Store.isDone(e.session.id, 'eric')
      }));
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
    return plan.phases.find(p => p.name === name) || { nameLabel: name, focus: '' };
  }

  /* Planned + completed hours for one week / athlete. */
  function weekHours(weekNumber, athlete) {
    const week = weekFor(weekNumber);
    let planned = 0, done = 0, total = 0, complete = 0;

    for (let i = 0; i < 7; i++) {
      const iso = addDays(week.startDate, i);
      for (const s of sessionsOn(iso, athlete)) {
        if (s.race) continue;
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
      target: week.targetHours[athlete]
    };
  }

  function raceCountdown() {
    const days = daysBetween(todayISO(), plan.raceDate);
    return days;
  }

  return {
    load,
    rebuild,
    refresh: buildIndex,
    get data() { return plan; },
    get index() { return index; },

    sessionsOn, togetherOn, resolve, weekFor, weekOf, weekNumberFor,
    phaseForDate, phaseMeta, weekHours, raceCountdown,

    parseISO, toISO, isoOf, addDays, todayISO, dayName, dayShort, prettyDate,
    monthLabel, daysBetween, startOfWeek, MONTHS
  };
})();
