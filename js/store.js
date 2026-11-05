/* ==========================================================================
   store.js — everything that persists lives here.

   Architecture: localStorage is the fast, synchronous source of truth for
   reads. Every write goes to localStorage AND is queued to Turso (async,
   fire-and-forget). On boot, we pull from Turso and merge into localStorage.

   If Turso is unavailable, everything works fine with localStorage only.
   To use Turso, set window.TURSO_AUTH_TOKEN in index.html.
   ========================================================================== */

const Store = (() => {
  const KEY = 'ironman703.v1';
  const listeners = new Set();

  let tursoClient = null;
  let tursoReady = false;
  let tursoError = null;
  let tursoPendingWrites = [];   // queue of write operations
  let tursoFlushing = false;

  function defaults() {
    return {
      version: 1,
      me: 'eric',        // who is holding this phone (for "edited by")
      theme: 'auto',     // auto | light | dark | vibrant | pink
      view: 'week',
      log: {},           // "sessionId|athlete" -> {done, at, actualMin, rpe, note}
      overrides: {},     // sessionId -> {date?, duration?, intensity?, sets?, notes?, eric:{}, ella:{}}
      weekScale: {},     // weekNumber -> factor (0.8 = 80%)
      skippedWeeks: [],  // weekNumbers the user has marked as skipped
      weekNotes: {},     // weekNumber (string) -> free-text note
      weeklyTemplates: {}, // weekNumber -> {days:{monday:'swim',...}, scope}
      weekBoards: {},    // weekNumber -> {pool:[sessionId]} — workouts waiting for a day
      extras: [],        // added sessions: {id, date, athlete, discipline, duration, ...}
      customPlan: null,  // imported plan.json, wins over the built-in plan
      meta: { by: null, at: null }
    };
  }

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

  function notify() {
    listeners.forEach(fn => fn(state));
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not save (storage full or blocked).', err);
    }
  }

  /* Stamp every write so a future sync layer can resolve conflicts. */
  function touch(state) {
    state.meta = { by: state.me, at: new Date().toISOString() };
  }

  /* Remove a workout from every week-board waiting room. The board entry
     itself stays (an empty pool means "all on days"), so the week does not
     re-pool the next time the board is opened. */
  function unpool(state, id) {
    for (const [key, board] of Object.entries(state.weekBoards || {})) {
      if (!board || !Array.isArray(board.pool)) continue;
      board.pool = board.pool.filter(x => x !== id);
      state.weekBoards[key] = { pool: board.pool };
    }
  }

  /* ---------------------------------------------------------------- turso */

  async function initTurso() {
    if (tursoReady || tursoError) return;
    try {
      const createClient = window.libsql?.createClient;
      if (!createClient) {
        tursoError = 'libsql client not loaded';
        console.warn(tursoError);
        return;
      }
      const url = window.TURSO_DATABASE_URL || '';
      const token = window.TURSO_AUTH_TOKEN || '';
      if (!url || !token) {
        tursoError = 'Turso not configured (missing URL or token)';
        console.warn(tursoError);
        return;
      }
      tursoClient = createClient({ url, authToken: token });
      // Test connection
      await tursoClient.execute('SELECT 1');
      tursoReady = true;
      console.log('Turso connected');

      // Pull from Turso and merge into localStorage
      await pullFromTurso();

      // If sync_state has no record, this is the first sync — seed Turso from localStorage
      const ss = await tursoClient.execute('SELECT * FROM sync_state WHERE id = 1');
      if (ss.rows.length === 0) {
        await pushFullStateToTurso(load());
        await tursoClient.execute(
          'INSERT INTO sync_state (id, last_synced_at, device_id) VALUES (1, ?, ?)',
          [new Date().toISOString(), load().meta.by || 'unknown']
        );
      }

      // Flush any pending writes that came in during init
      await flushTursoWrites();
    } catch (err) {
      tursoError = err.message;
      console.warn('Turso init failed, using localStorage only:', err.message);
    }
  }

  /* Pull all data from Turso and merge into localStorage. Turso wins conflicts. */
  async function pullFromTurso() {
    if (!tursoClient) return;
    try {
      const current = load();

      // --- completions -> log ---
      const compRes = await tursoClient.execute('SELECT session_id, athlete, done, at, actual_min, rpe, note FROM completions');
      const log = { ...current.log };
      for (const row of compRes.rows) {
        const key = `${row.session_id}|${row.athlete}`;
        log[key] = {
          done: Boolean(row.done),
          at: row.at,
          actualMin: row.actual_min,
          rpe: row.rpe,
          note: row.note
        };
      }

      // --- overrides -> overrides ---
      const ovRes = await tursoClient.execute('SELECT session_id, scope, field, value FROM overrides');
      const overrides = {};
      for (const row of ovRes.rows) {
        if (!overrides[row.session_id]) overrides[row.session_id] = {};
        if (row.scope === 'both') {
          overrides[row.session_id][row.field] = row.value;
        } else {
          if (!overrides[row.session_id][row.scope]) overrides[row.session_id][row.scope] = {};
          overrides[row.session_id][row.scope][row.field] = row.value;
        }
      }

      // --- week_scales ---
      const wsRes = await tursoClient.execute('SELECT week_number, factor FROM week_scales');
      const weekScale = {};
      for (const row of wsRes.rows) {
        weekScale[row.week_number] = row.factor;
      }

      // --- skipped_weeks ---
      const swRes = await tursoClient.execute('SELECT week_number FROM skipped_weeks');
      const skippedWeeks = swRes.rows.map(r => r.week_number);

      // --- week_notes ---
      const wnRes = await tursoClient.execute('SELECT week_number, note FROM week_notes');
      const weekNotes = {};
      for (const row of wnRes.rows) {
        weekNotes[row.week_number] = row.note;
      }

      // --- extras ---
      const exRes = await tursoClient.execute('SELECT id, date, athletes, discipline, duration, intensity, sets, notes, together FROM extras');
      const extras = exRes.rows.map(r => ({
        id: r.id,
        date: r.date,
        athletes: JSON.parse(r.athletes || '[]'),
        discipline: r.discipline,
        duration: r.duration,
        intensity: r.intensity,
        sets: r.sets,
        notes: r.notes,
        together: Boolean(r.together)
      }));

      // --- weekly templates + week boards (stored as JSON values in meta) ---
      let weeklyTemplates = current.weeklyTemplates || {};
      let weekBoards = current.weekBoards || {};
      const metaRes = await tursoClient.execute('SELECT key, value FROM meta');
      for (const row of metaRes.rows) {
        if (row.key === 'weekly_templates') {
          try { weeklyTemplates = JSON.parse(row.value) || {}; } catch (err) { /* ignore */ }
        }
        if (row.key === 'week_boards') {
          try { weekBoards = JSON.parse(row.value) || {}; } catch (err) { /* ignore */ }
        }
      }

      const merged = Object.assign({}, current, {
        log,
        overrides,
        weekScale,
        skippedWeeks,
        weekNotes,
        weeklyTemplates,
        weekBoards,
        extras
      });

      save(merged);
      notify();
    } catch (err) {
      console.warn('Turso pull failed:', err.message);
    }
  }

  /* Push the entire current state to Turso (full reseed, simple and correct). */
  async function pushFullStateToTurso(state) {
    if (!tursoClient) return;
    try {
      // Clear existing data
      await tursoClient.execute('DELETE FROM completions');
      await tursoClient.execute('DELETE FROM overrides');
      await tursoClient.execute('DELETE FROM week_scales');
      await tursoClient.execute('DELETE FROM skipped_weeks');
      await tursoClient.execute('DELETE FROM week_notes');
      await tursoClient.execute('DELETE FROM extras');
      await tursoClient.execute('DELETE FROM meta');

      // Insert completions
      for (const [key, val] of Object.entries(state.log || {})) {
        const [sessionId, athlete] = key.split('|');
        await tursoClient.execute(
          `INSERT INTO completions (id, session_id, athlete, done, at, actual_min, rpe, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [`c-${sessionId}-${athlete}`, sessionId, athlete, val.done ? 1 : 0, val.at || null, val.actualMin || null, val.rpe || null, val.note || null]
        );
      }

      // Insert overrides (flatten nested structure)
      for (const [sessionId, ov] of Object.entries(state.overrides || {})) {
        // Top-level fields (scope = 'both')
        for (const field of ['date', 'duration', 'intensity', 'sets', 'notes']) {
          if (ov[field] !== undefined) {
            await tursoClient.execute(
              `INSERT INTO overrides (id, session_id, scope, field, value) VALUES (?, ?, ?, ?, ?)`,
              [`ov-${sessionId}-both-${field}`, sessionId, 'both', field, String(ov[field])]
            );
          }
        }
        // Per-athlete fields
        for (const athlete of ['eric', 'ella']) {
          if (ov[athlete]) {
            for (const field of ['date', 'duration', 'intensity', 'sets', 'notes']) {
              if (ov[athlete][field] !== undefined) {
                await tursoClient.execute(
                  `INSERT INTO overrides (id, session_id, scope, field, value) VALUES (?, ?, ?, ?, ?)`,
                  [`ov-${sessionId}-${athlete}-${field}`, sessionId, athlete, field, String(ov[athlete][field])]
                );
              }
            }
          }
        }
      }

      // Insert week_scales
      for (const [weekNum, factor] of Object.entries(state.weekScale || {})) {
        await tursoClient.execute(
          'INSERT INTO week_scales (week_number, factor) VALUES (?, ?)',
          [Number(weekNum), factor]
        );
      }

      // Insert skipped_weeks
      for (const w of state.skippedWeeks || []) {
        await tursoClient.execute('INSERT INTO skipped_weeks (week_number) VALUES (?)', [w]);
      }

      // Insert week_notes
      for (const [weekNum, note] of Object.entries(state.weekNotes || {})) {
        await tursoClient.execute(
          'INSERT INTO week_notes (week_number, note) VALUES (?, ?)',
          [Number(weekNum), note]
        );
      }

      // Insert extras
      for (const e of state.extras || []) {
        await tursoClient.execute(
          `INSERT INTO extras (id, date, athletes, discipline, duration, intensity, sets, notes, together) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [e.id, e.date, JSON.stringify(e.athletes), e.discipline, e.duration, e.intensity, e.sets, e.notes, e.together ? 1 : 0]
        );
      }

      // Insert meta. Theme/view/me are deliberately NOT synced — Ella's
      // phone should keep its own pink theme even when Eric changes his.
      await tursoClient.execute(
        'INSERT INTO meta (key, value) VALUES (?, ?)',
        ['weekly_templates', JSON.stringify(state.weeklyTemplates || {})]
      );
      await tursoClient.execute(
        'INSERT INTO meta (key, value) VALUES (?, ?)',
        ['week_boards', JSON.stringify(state.weekBoards || {})]
      );
    } catch (err) {
      console.warn('Turso push failed:', err.message);
    }
  }

  /* Queue a write to Turso (fire-and-forget). */
  function enqueueTursoWrite() {
    tursoPendingWrites.push(load()); // snapshot current state
    if (!tursoFlushing && tursoReady) {
      tursoFlushing = true;
      flushTursoWrites();
    }
  }

  async function flushTursoWrites() {
    if (!tursoReady || !tursoClient) {
      tursoFlushing = false;
      return;
    }
    do {
      while (tursoPendingWrites.length > 0) {
        const stateSnapshot = tursoPendingWrites.shift();
        try {
          await pushFullStateToTurso(stateSnapshot);
        } catch (err) {
          console.warn('Turso write failed:', err.message);
          tursoPendingWrites.push(stateSnapshot);
          break;
        }
      }
    } while (tursoPendingWrites.length > 0);
    tursoFlushing = false;
  }

  /* ---------------------------------------------------------------- api */

  const api = {
    get state() { return state; },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /* Run a mutation, persist to localStorage, queue to Turso. */
    update(fn) {
      fn(state);
      touch(state);
      save(state);
      notify();
      enqueueTursoWrite();
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

    setDoneWithActuals(id, athlete, actualMin, rpe, note) {
      api.update(s => {
        const k = api.key(id, athlete);
        s.log[k] = {
          done: true,
          at: new Date().toISOString(),
          actualMin: actualMin || null,
          rpe: rpe || null,
          note: note || null
        };
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
        if (!rec) {
          if (!field || field === 'date') unpool(s, id);
          return;
        }
        if (!field) { delete s.overrides[id]; unpool(s, id); return; }
        if (scope === 'both') delete rec[field];
        else if (rec[scope]) {
          delete rec[scope][field];
          if (!Object.keys(rec[scope]).length) delete rec[scope];
        }
        if (field === 'date') unpool(s, id);
        if (!Object.keys(rec).length) delete s.overrides[id];
      });
    },

    /* Move a session to another ISO date. Moving also takes it out of any
       week-board pool, so the workout reappears on a day. */
    move(id, date, scope) {
      api.update(s => {
        unpool(s, id);
        const rec = s.overrides[id] || {};
        if (scope === 'both') {
          rec.date = date;
        } else {
          rec[scope] = Object.assign({}, rec[scope], { date });
        }
        s.overrides[id] = rec;
      });
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
      const id = 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      api.update(s => {
        s.extras.push(Object.assign({
          id,
          createdAt: new Date().toISOString()
        }, session));
      });
      return id;
    },

    removeExtra(id) {
      api.update(s => { s.extras = s.extras.filter(e => e.id !== id); });
    },

    /* ---- week skipping -------------------------------------------- */
    isWeekSkipped(weekNumber) {
      return (state.skippedWeeks || []).includes(weekNumber);
    },

    setWeekSkip(weekNumber, skipped) {
      api.update(s => {
        if (skipped) {
          if (!s.skippedWeeks.includes(weekNumber)) s.skippedWeeks.push(weekNumber);
        } else {
          s.skippedWeeks = s.skippedWeeks.filter(w => w !== weekNumber);
        }
      });
    },

    /* ---- weekly templates ----------------------------------------- */
    /* template = { days: { 'monday': 'swim', 'tuesday': 'bike', ... }, scope: 'both' | 'eric' | 'ella' } */
    getWeekTemplate(weekNumber) {
      return (state.weeklyTemplates || {})[String(weekNumber)] || null;
    },

    setWeekTemplate(weekNumber, template) {
      api.update(s => {
        if (!template || !template.days || Object.keys(template.days).length === 0) {
          delete s.weeklyTemplates[String(weekNumber)];
        } else {
          s.weeklyTemplates[String(weekNumber)] = template;
        }
      });
    },

    clearWeekTemplates() {
      api.update(s => { s.weeklyTemplates = {}; });
    },

    /* ---- week board ----------------------------------------------- */
    /* A week board is just a "waiting room" of session IDs. Workouts in the
       pool are hidden from the normal week view until you drop them on a day.
       Day placement itself still uses the normal `date` override, so moving a
       workout later from the session sheet keeps working. */
    getWeekBoard(weekNumber) {
      return (state.weekBoards || {})[String(weekNumber)] || null;
    },

    isPooled(weekNumber, id) {
      const b = api.getWeekBoard(weekNumber);
      return !!(b && Array.isArray(b.pool) && b.pool.includes(id));
    },

    setWeekBoard(weekNumber, ids) {
      api.update(s => {
        const key = String(weekNumber);
        s.weekBoards = s.weekBoards || {};
        const pool = [...new Set(ids || [])];
        // Keep the entry even when the pool is empty: "board exists" is what
        // stops the board from re-pooling every week when you open it again.
        s.weekBoards[key] = { pool };
      });
    },

    poolSession(weekNumber, id) {
      api.update(s => {
        const key = String(weekNumber);
        s.weekBoards = s.weekBoards || {};
        const board = s.weekBoards[key] || { pool: [] };
        board.pool = board.pool || [];
        if (!board.pool.includes(id)) board.pool.push(id);
        s.weekBoards[key] = board;
      });
    },

    /* Drop a pooled workout onto a day. Removing it from the pool and setting
       the date happen in one write, so the UI only redraws once. */
    assignWeekBoardSession(weekNumber, id, date) {
      api.update(s => {
        const key = String(weekNumber);
        s.weekBoards = s.weekBoards || {};
        const board = s.weekBoards[key] || { pool: [] };
        board.pool = Array.isArray(board.pool) ? board.pool.filter(x => x !== id) : [];
        // Never delete the board here: an empty pool means "every workout is
        // on a day", not "this week has no board yet".
        s.weekBoards[key] = board;
        const rec = s.overrides[id] || {};
        rec.date = date;
        s.overrides[id] = rec;
      });
    },

    /* "Use plan days": drop the pool and undo the date moves made for these
       sessions, so every workout goes back to its template day. Duration,
       intensity and note edits are kept. */
    clearWeekBoard(weekNumber, ids) {
      api.update(s => {
        s.weekBoards = s.weekBoards || {};
        s.weekBoards[String(weekNumber)] = { pool: [] };
        for (const id of ids || []) {
          const rec = s.overrides[id];
          if (!rec) continue;
          delete rec.date;
          for (const who of ['eric', 'ella']) {
            if (!rec[who]) continue;
            delete rec[who].date;
            if (!Object.keys(rec[who]).length) delete rec[who];
          }
          if (!Object.keys(rec).length) delete s.overrides[id];
        }
      });
    },

    /* Put every workout in a week back in the pool. */
    poolWholeWeek(weekNumber, ids) {
      api.setWeekBoard(weekNumber, ids);
    },

    /* ---- week notes ----------------------------------------------- */
    getWeekNote(weekNumber) {
      return (state.weekNotes || {})[String(weekNumber)] || '';
    },

    setWeekNote(weekNumber, note) {
      api.update(s => {
        if (note && note.trim()) {
          s.weekNotes[String(weekNumber)] = note.trim();
        } else {
          delete s.weekNotes[String(weekNumber)];
        }
      });
    },

    /* ---- bulk ----------------------------------------------------- */
    resetAll() {
      state = defaults();
      save(state);
      notify();
      enqueueTursoWrite();
    },

    exportJSON() {
      return JSON.stringify(state, null, 2);
    },

    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') throw new Error('Not a data file');
      if (!parsed.version) throw new Error('Missing version field');
      if (parsed.weeks && !Array.isArray(parsed.weeks)) throw new Error('Invalid weeks data');
      state = Object.assign(defaults(), parsed);
      save(state);
      notify();
      enqueueTursoWrite();
    },

    /* ---- custom plan (import your own plan.json) ------------------ */
    setCustomPlan(plan) {
      api.update(s => { s.customPlan = plan; });
    },

    clearCustomPlan() {
      api.update(s => { s.customPlan = null; });
    },

    /* Expose turso status for debugging */
    get tursoStatus() {
      return { ready: tursoReady, error: tursoError };
    }
  };

  let state = load();

  /* Initialize Turso in the background (doesn't block app boot). */
  initTurso();

  return api;
})();