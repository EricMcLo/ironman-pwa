/* ==========================================================================
   store.js — everything that persists lives here.

   This is the ONE file to change when you move from localStorage to a shared
   backend (Turso, Supabase, whatever). The rest of the app only ever calls
   Store.* -- it never touches localStorage directly.

   To swap in a server later, rewrite load()/save() and keep the same shape.
   Every record already carries an id + timestamp, which is what a sync
   backend needs.
   ========================================================================== */

const Store = (() => {
  const KEY = 'ironman703.v1';
  const listeners = new Set();

  function defaults() {
    return {
      version: 1,
      me: 'eric',        // who is holding this phone (for "edited by")
      theme: 'auto',     // auto | light | dark
      view: 'week',
      log: {},           // "sessionId|athlete" -> {done, at, actualMin, rpe, note}
      overrides: {},     // sessionId -> {date?, duration?, intensity?, sets?, notes?, eric:{}, ella:{}}
      weekScale: {},     // weekNumber -> factor (0.8 = 80%)
      extras: [],        // added sessions: {id, date, athlete, discipline, duration, ...}
      meta: { by: null, at: null }
    };
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw);
      return Object.assign(defaults(), parsed);
    } catch (err) {
      console.warn('Could not read saved data, starting fresh.', err);
      return defaults();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not save (storage full or blocked).', err);
    }
    listeners.forEach(fn => fn(state));
  }

  /* Stamp every write so a future sync layer can resolve conflicts. */
  function touch() {
    state.meta = { by: state.me, at: new Date().toISOString() };
  }

  /* ---------------------------------------------------------------- api */

  const api = {
    get state() { return state; },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /* Run a mutation, persist, notify. */
    update(fn) {
      fn(state);
      touch();
      save();
    },

    set(key, value) {
      api.update(s => { s[key] = value; });
    },

    /* ---- completions ---------------------------------------------- */
    key(id, athlete) { return id + '|' + athlete; },

    getLog(id, athlete) {
      return state.log[api.key(id, athlete)] || null;
    },

    isDone(id, athlete) {
      const r = state.log[api.key(id, athlete)];
      return !!(r && r.done);
    },

    setDone(id, athlete, done, extra) {
      api.update(s => {
        const k = api.key(id, athlete);
        if (!done) { delete s.log[k]; return; }
        s.log[k] = Object.assign(
          { done: true, at: new Date().toISOString() },
          extra || {}
        );
      });
    },

    toggleDone(id, athlete) {
      api.setDone(id, athlete, !api.isDone(id, athlete));
    },

    /* ---- overrides ------------------------------------------------ */
    getOverride(id) { return state.overrides[id] || {}; },

    /* scope: 'both' | 'eric' | 'ella'
       patch: {date?, duration?, intensity?, sets?, notes?, distanceKm?} */
    setOverride(id, patch, scope) {
      api.update(s => {
        const rec = s.overrides[id] || {};
        if (scope === 'both') {
          Object.assign(rec, patch);
        } else {
          rec[scope] = Object.assign({}, rec[scope], patch);
        }
        s.overrides[id] = rec;
      });
    },

    clearOverride(id, field, scope) {
      api.update(s => {
        const rec = s.overrides[id];
        if (!rec) return;
        if (!field) { delete s.overrides[id]; return; }
        if (scope === 'both') delete rec[field];
        else if (rec[scope]) {
          delete rec[scope][field];
          if (!Object.keys(rec[scope]).length) delete rec[scope];
        }
        if (!Object.keys(rec).length) delete s.overrides[id];
      });
    },

    /* Move a session to another ISO date. */
    move(id, date, scope) {
      api.setOverride(id, { date }, scope);
    },

    /* ---- week scaling --------------------------------------------- */
    getWeekScale(weekNumber) {
      return state.weekScale[weekNumber] || 1;
    },

    setWeekScale(weekNumber, factor) {
      api.update(s => {
        if (factor === 1) delete s.weekScale[weekNumber];
        else s.weekScale[weekNumber] = factor;
      });
    },

    /* ---- extras (sessions you add yourself) ------------------------ */
    addExtra(session) {
      api.update(s => {
        s.extras.push(Object.assign({
          id: 'x' + Date.now().toString(36),
          createdAt: new Date().toISOString()
        }, session));
      });
    },

    removeExtra(id) {
      api.update(s => { s.extras = s.extras.filter(e => e.id !== id); });
    },

    /* ---- bulk ----------------------------------------------------- */
    resetAll() {
      state = defaults();
      save();
    },

    exportJSON() {
      return JSON.stringify(state, null, 2);
    },

    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') throw new Error('Not a data file');
      state = Object.assign(defaults(), parsed);
      save();
    }
  };

  return api;
})();
