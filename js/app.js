/* ==========================================================================
   app.js — state, routing, sheets. The glue.
   ========================================================================== */

(() => {
  const $ = (sel) => document.querySelector(sel);

  /* Element.append(null) writes the string "null" into the page. This
     filters optional sections out instead. */
  function appendAll(parent, ...nodes) {
    for (const n of nodes.flat()) {
      if (n !== null && n !== undefined && n !== false) parent.append(n);
    }
  }

  const state = {
    athlete: 'eric',
    view: 'week',
    weekNumber: 1,
    monthYear: 0,
    monthMonth: 0,
    expanded: new Set(),
    sheets: []   // stack of render functions
  };

  let booted = false;

  /* ------------------------------------------------------------- boot */
  async function boot() {
    applyTheme();
    state.athlete = Store.state.me === 'ella' ? 'ella' : 'eric';
    state.view = Store.state.view || 'week';

    try {
      await Plan.load();
    } catch (err) {
      renderError(err);
      return;
    }

    const today = Plan.todayISO();
    state.weekNumber = Plan.weekNumberFor(today);
    const d = Plan.parseISO(today);
    state.monthYear = d.getFullYear();
    state.monthMonth = d.getMonth();

    // optional deep link: ?view=month&week=12&athlete=ella
    const params = new URLSearchParams(location.search);
    if (['week', 'month', 'progress'].includes(params.get('view'))) {
      state.view = params.get('view');
    }
    if (params.get('week')) {
      const n = Number(params.get('week'));
      if (n >= 1 && n <= Plan.data.weeks.length) state.weekNumber = n;
    }
    if (['eric', 'ella', 'both'].includes(params.get('athlete'))) {
      state.athlete = params.get('athlete');
    }

    wireChrome();
    Store.subscribe(() => {
      Plan.refresh();
      render();
    });

    render();
    booted = true;
    registerServiceWorker();
  }

  function renderError(err) {
    $('#main').innerHTML =
      '<div class="empty"><h3>Could not load the plan</h3>' +
      '<p>' + String(err.message || err) + '</p>' +
      '<p style="margin-top:12px">Open this page over HTTP, not directly as a file:<br>' +
      '<code>python3 -m http.server 8080</code><br>' +
      'then visit <code>http://localhost:8080</code> (or your Mac’s LAN address).</p>' +
      '<p style="margin-top:14px"><button class="btn" id="retryBtn">Try again</button></p>' +
      '</div>';
    $('#retryBtn').addEventListener('click', () => boot());
  }

  /* ------------------------------------------------------------ theme */
  function applyTheme() {
    const t = Store.state.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const darkSystem = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      let color = '#faf9f6';
      if (t === 'dark') color = '#131512';
      else if (t === 'vibrant') color = '#0a0a0c';
      else if (t === 'pink') color = darkSystem ? '#1d1218' : '#fdf2f6';
      else if (t === 'auto' && darkSystem) color = '#131512';
      meta.setAttribute('content', color);
    }
  }

  /* --------------------------------------------------------- chrome */
  function wireChrome() {
    document.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.athlete = btn.dataset.athlete;
        render();
      });
    });

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => setView(tab.dataset.view));
    });

    $('#settingsBtn').addEventListener('click', openSettings);

    $('#prevMonth').addEventListener('click', () => shiftMonth(-1));
    $('#nextMonth').addEventListener('click', () => shiftMonth(1));

    $('#scrim').addEventListener('click', closeSheet);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSheet();
    });

    wireSessionDrag();
  }

  /* ------------------------------------------------- drag & drop */
  /* Hold a workout on the week view, then drag it to another day. Touch and
     mouse both use Pointer Events, so one code path covers phones + laptops. */
  function wireSessionDrag() {
    const weekList = $('#weekList');
    let pressTimer = null;
    let drag = null;
    let suppressClick = false;

    const moveGhost = (x, y) => {
      if (!drag || !drag.ghost) return;
      drag.ghost.style.left = (x + 10) + 'px';
      drag.ghost.style.top = Math.max(8, y - 26) + 'px';
    };

    weekList.addEventListener('pointerdown', (e) => {
      if (drag) return;
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest('.check, .mini, .day-add, .rest-add, a, input, select, textarea')) return;
      // On touch, drag from the grip so normal scrolling on the card still works.
      if (e.pointerType !== 'mouse' && !e.target.closest('.s-grip')) return;

      const sessionEl = e.target.closest('.session');
      const dayEl = sessionEl && sessionEl.closest('.day');
      if (!sessionEl || !dayEl) return;

      const id = sessionEl.dataset.id;
      const sourceDate = dayEl.dataset.date;
      const startX = e.clientX;
      const startY = e.clientY;
      const delay = e.pointerType === 'mouse' ? 140 : 340;

      const cleanup = () => {
        if (drag) {
          if (drag.ghost) drag.ghost.remove();
          if (drag.lastTarget) drag.lastTarget.classList.remove('drop-target');
          document.querySelectorAll('.session.dragging').forEach(el => el.classList.remove('dragging'));
        }
        document.body.classList.remove('is-dragging');
        drag = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      const onMove = (ev) => {
        if (pressTimer) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 12) {
            clearTimeout(pressTimer);
            pressTimer = null;
          }
          return;
        }
        if (!drag) return;
        ev.preventDefault();
        moveGhost(ev.clientX, ev.clientY);

        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const day = hit && hit.closest('.day');
        if (drag.lastTarget && drag.lastTarget !== day) {
          drag.lastTarget.classList.remove('drop-target');
        }
        if (day && day.dataset.date !== sourceDate) {
          day.classList.add('drop-target');
          drag.lastTarget = day;
        } else {
          drag.lastTarget = null;
        }
      };

      const onUp = (ev) => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        if (!drag) { cleanup(); return; }

        ev.preventDefault();
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const day = hit && hit.closest('.day');
        const targetDate = day && day.dataset.date;
        cleanup();

        if (targetDate && targetDate !== sourceDate) {
          const moved = plannerSessions(sourceDate).find(x => x.id === id);
          if (moved && moveSessionTo(moved, targetDate)) {
            Plan.refresh();
            render();
            toast('Moved to ' + Plan.prettyDate(targetDate), null);
          }
        }
        setTimeout(() => { suppressClick = false; }, 60);
      };

      pressTimer = setTimeout(() => {
        pressTimer = null;
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        const line = sessionEl.querySelector('.s-line1');
        ghost.textContent = line ? line.textContent : 'Workout';
        document.body.append(ghost);
        drag = { id, sourceDate, ghost, lastTarget: null };
        sessionEl.classList.add('dragging');
        document.body.classList.add('is-dragging');
        moveGhost(startX, startY);
        suppressClick = true;
        if (navigator.vibrate) navigator.vibrate(8);
      }, delay);

      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    // Don't let the release after a drag also count as a tap.
    weekList.addEventListener('click', (e) => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick = false;
      }
    }, true);
  }

  function setView(view) {
    state.view = view;
    Store.update(s => { s.view = view; });
    render();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  function shiftMonth(delta) {
    let m = state.monthMonth + delta;
    let y = state.monthYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    state.monthMonth = m;
    state.monthYear = y;
    render();
  }

  /* ---------------------------------------------------------- render */
  function render() {
    if (!Plan.data) return;

    document.querySelectorAll('.seg-btn').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.athlete === state.athlete));
    });
    document.querySelectorAll('.tab').forEach(t => {
      t.setAttribute('aria-selected', String(t.dataset.view === state.view));
    });

    ['week', 'month', 'progress'].forEach(v => {
      $('#view-' + v).hidden = v !== state.view;
    });

    if (state.view === 'week') renderWeek();
    if (state.view === 'month') renderMonth();
    if (state.view === 'progress') renderProgress();
  }

  function renderWeek() {
    const athlete = state.athlete;
    const week = Plan.weekFor(state.weekNumber);
    const today = Plan.todayISO();

    $('#banner').replaceChildren(UI.banner(athlete, state.weekNumber));

    const isCurrent = week.weekNumber === Plan.weekNumberFor(today);

    $('#weekHead').replaceChildren(
      UI.el('div', null, [
        UI.el('h2', { text: `Week ${week.weekNumber}` }),
        UI.el('div', {
          class: 'wh-sub',
          text: `${Plan.prettyDate(week.startDate)} – ${Plan.prettyDate(week.endDate)}` +
            (week.recoveryWeek ? ' · recovery' : '')
        })
      ]),
      UI.el('div', { class: 'weekhead-actions' }, [
        isCurrent ? null : UI.el('button', {
          class: 'linkbtn', type: 'button',
          onclick: () => { state.weekNumber = Plan.weekNumberFor(today); render(); }
        }, ['Today']),
        UI.el('button', {
          class: 'linkbtn', type: 'button', 'aria-label': 'Plan this week',
          onclick: () => openWeekBoard()
        }, ['Plan week']),
        UI.el('button', {
          class: 'icon-btn small', type: 'button', 'aria-label': 'Week options',
          onclick: openWeekOptionsSheet
        }, ['···']),
        UI.el('button', {
          class: 'icon-btn small', type: 'button', 'aria-label': 'Previous week',
          onclick: () => { state.weekNumber = Math.max(1, state.weekNumber - 1); render(); }
        }, ['‹']),
        UI.el('button', {
          class: 'icon-btn small', type: 'button', 'aria-label': 'Next week',
          onclick: () => {
            state.weekNumber = Math.min(Plan.data.weeks.length, state.weekNumber + 1);
            render();
          }
        }, ['›'])
      ])
    );

    document.querySelectorAll('.tstrip').forEach(el => el.remove());
    $('#weekHead').after(UI.todayStrip((iso) => {
      state.weekNumber = Plan.weekNumberFor(iso);
      render();
    }));

    const list = document.createDocumentFragment();
    const pooled = Plan.pooledCount(week.weekNumber, athlete === 'both' ? 'both' : athlete);
    if (pooled) {
      list.append(UI.el('button', {
        class: 'unscheduled-banner', type: 'button',
        'aria-label': pooled + ' workouts waiting to be scheduled',
        onclick: () => openWeekBoard()
      }, [
        UI.el('span', { class: 'ub-count', text: String(pooled) }),
        UI.el('span', {
          text: pooled === 1
            ? 'workout waiting for a day'
            : 'workouts waiting for a day'
        }),
        UI.el('span', { class: 'ub-arrow', text: '→' })
      ]));
    }
    for (let i = 0; i < 7; i++) {
      const iso = Plan.addDays(week.startDate, i);
      list.append(UI.dayBlock(iso, athlete, handlers()));
    }
    $('#weekList').replaceChildren(list);
  }

  function renderMonth() {
    const athlete = state.athlete;
    $('#monthTitle').textContent = Plan.monthLabel(state.monthYear, state.monthMonth);
    $('#monthGrid').replaceChildren(
      UI.monthGrid(state.monthYear, state.monthMonth, athlete, (iso) => {
        state.weekNumber = Plan.weekNumberFor(iso);
        openDaySheet(iso);
      })
    );
    $('#legend').replaceChildren(...UI.legend());
  }

  function renderProgress() {
    const athlete = state.athlete;
    $('#statGrid').replaceChildren(...UI.stats(athlete));

    const svg = UI.chart(athlete);
    $('#chartWrap').replaceChildren(svg);
    $('#chartHint').textContent =
      athlete === 'both' ? 'Eric' : ((Plan.data.athletes || {})[athlete] || {}).name || athlete;

    // bring the current week into view inside the scrolling chart
    const wrap = $('#chartWrap');
    const cw = Number(svg.dataset.currentWeek) || 1;
    const barX = 26 + (cw - 1) * 15;
    wrap.scrollLeft = Math.max(0, barX - wrap.clientWidth / 2);

    // "What did this week consist of?" card
    const weekNumber = Plan.weekNumberFor(Plan.todayISO());
    const bd = UI.breakdown(athlete, weekNumber);
    $('#breakdownTitle').textContent = 'Week ' + weekNumber + ' breakdown';
    $('#breakdownWrap').replaceChildren(bd.node);

    $('#phaseList').replaceChildren(...UI.phaseList().childNodes);
  }

  /* -------------------------------------------------------- handlers */
  function handlers() {
    return {
      expandedIds: state.expanded,
      onToggleExpand: (s) => {
        if (state.expanded.has(s.id)) state.expanded.delete(s.id);
        else state.expanded.add(s.id);
        render();
      },
      onCheck: (s, athlete) => toggleDone(s, athlete),
      onOpen: openSessionSheet,
      onOpenDay: (iso) => openDaySheet(iso),
      onGrip: (s) => openWeekBoard(s.id),
      onMove: (s) => openMoveSheet(s),
      onEdit: (s) => openEditSheet(s),
      onEditLog: (s) => openLogActualsSheet(s, state.athlete === 'both' ? 'eric' : state.athlete),
      onDelete: (s) => deleteExtraSession(s),
      onQuickAdd: (iso, discipline) => quickAdd(iso, discipline),
      onAdd: (iso) => openAddSheet(iso),
      onReset: (s) => resetSession(s)
    };
  }

  function toggleDone(s, athleteOverride) {
    const athlete = athleteOverride || (state.athlete === 'both' ? 'eric' : state.athlete);
    if (!Store.isDone(s.id, athlete)) {
      // Marking as done → open log actuals sheet
      openLogActualsSheet(s, athlete);
    } else {
      // Already done → let them fix the minutes instead of forcing an
      // uncheck/recheck dance. The sheet has a "Remove completion" button.
      openLogActualsSheet(s, athlete);
    }
  }

  function quickAdd(iso, discipline) {
    const athletes = state.athlete === 'both' ? ['eric', 'ella'] : [state.athlete];
    const presets = {
      run: { title: 'Easy run', duration: 40, intensity: 'Z2', sets: 'Easy conversational pace' },
      bike: { title: 'Easy spin', duration: 60, intensity: 'Z2', sets: 'Steady aerobic spin' },
      swim: { title: 'Swim', duration: 40, intensity: 'Z1', sets: 'Technique + easy aerobic laps' },
      strength: { title: 'Gym / lift', duration: 45, intensity: 'RPE3', sets: 'Whatever you feel like doing' },
      cross: { title: 'Ski / climb / other', duration: 90, intensity: 'RPE3', sets: 'Time outside counts.' }
    };
    const p = presets[discipline] || presets.cross;
    const id = Store.addExtra({
      date: iso,
      athletes,
      discipline,
      title: p.title,
      duration: p.duration,
      intensity: p.intensity,
      sets: p.sets,
      notes: '',
      together: athletes.length > 1
    });
    // Avoid a rest placeholder showing next to the new workout.
    Plan.refresh();
    render();
    paintSheet(); // keep an open day sheet in sync
    toast('Added ' + p.title, 'Undo', () => {
      Store.removeExtra(id);
      Plan.refresh();
      render();
      paintSheet();
    });
  }

  function deleteExtraSession(s) {
    if (!confirm('Delete this added workout?')) return;
    Store.removeExtra(s.id);
    closeSheet();
    toast('Workout deleted', null);
  }

  function resetSession(s) {
    Store.clearOverride(s.id);
    closeSheet();
    toast('Reset to the original plan', null);
  }

  /* One place to move a workout. If its week has a board, the board is the
     authority; otherwise a normal date override is enough. */
  function moveSessionTo(s, iso, scope) {
    if (!s || !iso || s.date === iso) return false;
    const week = Plan.weekFor(s.weekNumber || Plan.weekNumberFor(iso));
    const shared = !scope || scope === 'both';
    if (shared && Store.getWeekBoard(week.weekNumber)) {
      Store.assignWeekBoardSession(week.weekNumber, s.id, iso);
    } else {
      Store.move(s.id, iso, scope || 'both');
    }
    return true;
  }

  /* ---------------------------------------------------------- sheets */
  function openSheet(renderFn) {
    state.sheets.push(renderFn);
    paintSheet();
  }

  function pushSheet(renderFn) {
    state.sheets.push(renderFn);
    paintSheet();
  }

  function backSheet() {
    state.sheets.pop();
    if (!state.sheets.length) { closeSheet(); return; }
    paintSheet();
  }

  function paintSheet() {
    const fn = state.sheets[state.sheets.length - 1];
    if (!fn) return;
    const body = $('#sheetBody');
    body.replaceChildren(fn());
    body.scrollTop = 0;
    $('#sheet').hidden = false;
    $('#scrim').hidden = false;
  }

  function closeSheet() {
    state.sheets = [];
    $('#sheet').hidden = true;
    $('#scrim').hidden = true;
    $('#sheetBody').replaceChildren();
  }

  function sheetHead(eyebrow, title, back) {
    return UI.el('div', { class: 'sh-head' }, [
      back ? UI.el('button', {
        class: 'sh-back', type: 'button', onclick: backSheet, 'aria-label': 'Back'
      }, ['‹ Back']) : null,
      UI.el('p', { class: 'sh-eyebrow', text: eyebrow }),
      UI.el('h2', { class: 'sh-title', id: 'sheetTitle', text: title })
    ]);
  }

  /* ---- day ---- */
  function openDaySheet(iso) {
    openSheet(() => UI.daySheetBody(iso, state.athlete, handlers()));
  }

  /* ---- session ---- */
  function openSessionSheet(s) {
    openSheet(() => UI.sessionSheetBody(s, state.athlete, {
      onCheck: (sess) => toggleDone(sess),
      onMove: (sess) => openMoveSheet(sess),
      onEdit: (sess) => openEditSheet(sess),
      onEditLog: (sess) => openLogActualsSheet(sess, state.athlete === 'both' ? 'eric' : state.athlete),
      onDelete: (sess) => deleteExtraSession(sess),
      onReset: (sess) => resetSession(sess)
    }));
  }

  /* ---- move ---- */
  function openMoveSheet(s) {
    const isShared = s.athletes && s.athletes.length > 1;
    let scope = 'both';
    let picked = s.date;

    pushSheet(() => {
      const wrap = document.createDocumentFragment();

      const strip = UI.el('div', { class: 'datestrip' });
      const start = Plan.addDays(s.date, -1);

      for (let i = 0; i < 21; i++) {
        const iso = Plan.addDays(start, i);
        const has = Plan.sessionsOn(iso, 'eric').length > 0 ||
                    Plan.sessionsOn(iso, 'ella').length > 0;
        const btn = UI.el('button', {
          class: 'datebtn' + (iso === picked ? ' sel' : '') + (has ? ' has-session' : ''),
          type: 'button',
          onclick: () => {
            picked = iso;
            strip.querySelectorAll('.datebtn').forEach(b =>
              b.classList.toggle('sel', b.dataset.date === iso));
            other.value = iso;
          },
          dataset: { date: iso }
        }, [
          UI.el('span', { class: 'dw', text: Plan.dayShort(iso) }),
          UI.el('span', { class: 'dn', text: String(Plan.parseISO(iso).getDate()) }),
          UI.el('span', { class: 'dm', text: Plan.MONTHS[Plan.parseISO(iso).getMonth()].slice(0, 3) })
        ]);
        strip.append(btn);
      }

      const other = UI.el('input', {
        type: 'date', value: s.date,
        onchange: (e) => {
          picked = e.target.value;
          strip.querySelectorAll('.datebtn').forEach(b =>
            b.classList.toggle('sel', b.dataset.date === picked));
        }
      });

      const scopePicker = isShared ? scopeSeg(scope, (v) => { scope = v; }) : null;

      appendAll(wrap,
        sheetHead(Plan.prettyDate(s.date, true), 'Move session', true),
        UI.el('p', { class: 'sh-text', text: 'Pick the day this should happen instead. The plan itself is not changed — you can always reset it.' }),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Move to' }),
          strip
        ]),
        isShared ? UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Move for' }),
          scopePicker
        ]) : null,
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Or pick a date' }),
          UI.el('div', { class: 'field' }, [other])
        ]),
        UI.el('div', { class: 'btnrow' }, [
          UI.el('button', {
            class: 'btn primary block', type: 'button',
            onclick: () => {
              moveSessionTo(s, picked, scope);
              closeSheet();
              toast('Moved to ' + Plan.prettyDate(picked), null);
            }
          }, ['Move it'])
        ])
      );

      return wrap;
    });

    // bring the session's current day into view inside the strip
    requestAnimationFrame(() => {
      const sel = document.querySelector('.datebtn.sel');
      if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
  }

  function scopeSeg(initial, onChange) {
    const wrap = UI.el('div', { class: 'segmented' });
    const options = [['both', 'Both'], ['eric', 'Eric'], ['ella', 'Ella']];
    for (const [val, label] of options) {
      appendAll(wrap,UI.el('button', {
        type: 'button',
        'aria-pressed': String(val === initial),
        onclick: () => {
          onChange(val);
          wrap.querySelectorAll('button').forEach(b =>
            b.setAttribute('aria-pressed', String(b.textContent === label)));
        }
      }, [label]));
    }
    return wrap;
  }

  /* ---- edit ---- */
  function openEditSheet(s) {
    const isShared = s.athletes && s.athletes.length > 1;
    let scope = isShared ? 'both' : (s.athletes && s.athletes[0]) || state.athlete;
    if (scope === 'both' && state.athlete !== 'both') scope = 'both';

    pushSheet(() => {
      let duration = s.duration || 0;
      const wrap = document.createDocumentFragment();

      const durInput = UI.el('input', {
        type: 'number', min: '0', max: '600', step: '5', value: String(duration),
        oninput: (e) => { duration = Number(e.target.value) || 0; }
      });

      const stepper = UI.el('div', { class: 'stepper' }, [
        UI.el('button', {
          type: 'button', 'aria-label': 'Less',
          onclick: () => {
            duration = Math.max(0, duration - 5);
            durInput.value = String(duration);
          }
        }, ['−']),
        durInput,
        UI.el('button', {
          type: 'button', 'aria-label': 'More',
          onclick: () => {
            duration = Math.min(600, duration + 5);
            durInput.value = String(duration);
          }
        }, ['+'])
      ]);

      const intensity = UI.el('select', null, ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'RPE1', 'RPE2', 'RPE3']
        .map(z => UI.el('option', { value: z, selected: z === s.intensity }, [z])));

      const sets = UI.el('textarea', { rows: '4' });
      sets.value = s.sets || '';

      const notes = UI.el('textarea', { rows: '3' });
      notes.value = s.notes || '';

      const scopePicker = isShared ? scopeSeg(scope, (v) => { scope = v; }) : null;

      appendAll(wrap,
        sheetHead('Edit', 'Adjust this session', true),
        UI.el('p', { class: 'sh-text', text: 'This changes the plan for real. Use Move if you only want to shift the day.' }),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Duration (minutes)' }),
          stepper
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Intensity' }),
          UI.el('div', { class: 'field' }, [intensity])
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Sets / structure' }),
          UI.el('div', { class: 'field' }, [sets])
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Notes' }),
          UI.el('div', { class: 'field' }, [notes])
        ]),
        isShared ? UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Apply to' }),
          scopePicker
        ]) : null,

        UI.el('div', { class: 'btnrow' }, [
          UI.el('button', {
            class: 'btn primary block', type: 'button',
            onclick: () => {
              Store.setOverride(s.id, {
                duration: Number(duration) || 0,
                intensity: intensity.value,
                sets: sets.value,
                notes: notes.value
              }, scope);
              closeSheet();
              toast('Session updated', null);
            }
          }, ['Save changes'])
        ]),
        UI.el('div', { class: 'btnrow' }, [
          UI.el('button', {
            class: 'btn ghost block', type: 'button',
            onclick: () => {
              Store.clearOverride(s.id);
              closeSheet();
              toast('Back to the original plan', null);
            }
          }, ['Reset to original'])
        ])
      );

      return wrap;
    });
  }

  /* ---- add ---- */
  function openAddSheet(iso, presetDiscipline) {
    pushSheet(() => {
      let discipline = presetDiscipline || 'run';
      let athlete = state.athlete === 'both' ? 'both' : state.athlete;

      const wrap = document.createDocumentFragment();

      const discRow = UI.el('div', { class: 'segmented' });
      const discs = [['run', 'Run'], ['bike', 'Bike'], ['swim', 'Swim'], ['strength', 'Gym'], ['cross', 'Other'], ['rest', 'Rest']];
      for (const [val, label] of discs) {
        discRow.append(UI.el('button', {
          type: 'button', 'aria-pressed': String(val === discipline),
          onclick: () => {
            discipline = val;
            discRow.querySelectorAll('button').forEach(b =>
              b.setAttribute('aria-pressed', String(b.textContent === label)));
          }
        }, [label]));
      }

      const whoRow = UI.el('div', { class: 'segmented' });
      const whos = [['both', 'Both'], ['eric', 'Eric'], ['ella', 'Ella']];
      for (const [val, label] of whos) {
        whoRow.append(UI.el('button', {
          type: 'button', 'aria-pressed': String(val === athlete),
          onclick: () => {
            athlete = val;
            whoRow.querySelectorAll('button').forEach(b =>
              b.setAttribute('aria-pressed', String(b.textContent === label)));
          }
        }, [label]));
      }

      const title = UI.el('input', { type: 'text', placeholder: 'e.g. Easy trail run' });
      const duration = UI.el('input', { type: 'number', min: '5', max: '600', step: '5', value: '45' });
      const sets = UI.el('textarea', { rows: '3', placeholder: 'What exactly are you doing?' });
      const notes = UI.el('textarea', { rows: '2', placeholder: 'Anything worth remembering' });

      appendAll(wrap,
        sheetHead(Plan.prettyDate(iso, true), 'Add a session', true),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Discipline' }), discRow
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Who' }), whoRow
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Title' }),
          UI.el('div', { class: 'field' }, [title])
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Minutes' }),
          UI.el('div', { class: 'field' }, [duration])
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Details' }),
          UI.el('div', { class: 'field' }, [sets])
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Notes' }),
          UI.el('div', { class: 'field' }, [notes])
        ]),
        UI.el('div', { class: 'btnrow' }, [
          UI.el('button', {
            class: 'btn primary block', type: 'button',
            onclick: () => {
              const athletes = athlete === 'both' ? ['eric', 'ella'] : [athlete];
              Store.addExtra({
                date: iso,
                athletes,
                discipline,
                title: title.value || UI.LABELS[discipline],
                duration: Number(duration.value) || 0,
                intensity: 'Z2',
                sets: sets.value,
                notes: notes.value,
                together: athletes.length > 1
              });
              closeSheet();
              toast('Session added', null);
            }
          }, ['Add it'])
        ])
      );

      return wrap;
    });
  }

  /* ---- week scale ---- */
  function openScaleSheet() {
    const week = Plan.weekFor(state.weekNumber);
    const current = Store.getWeekScale(week.weekNumber);

    openSheet(() => {
      const wrap = document.createDocumentFragment();
      const row = UI.el('div', { class: 'segmented' });
      const opts = [0.7, 0.8, 0.9, 1, 1.1];

      for (const f of opts) {
        row.append(UI.el('button', {
          type: 'button',
          'aria-pressed': String(Math.abs(f - current) < 0.001),
          onclick: () => {
            Store.setWeekScale(week.weekNumber, f);
            closeSheet();
            toast(f === 1 ? 'Week back to 100%' : `Week scaled to ${Math.round(f * 100)}%`, null);
          }
        }, [f === 1 ? '100%' : `${Math.round(f * 100)}%`]));
      }

      appendAll(wrap,
        sheetHead(`Week ${week.weekNumber}`, 'Adjust the whole week', null),
        UI.el('p', {
          class: 'sh-text',
          text: 'Life happens. Scaling a week changes every session in it, without touching the original plan. Sessions you have already edited by hand are left alone.'
        }),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Scale to' }), row
        ]),
        UI.el('div', { class: 'btnrow' }, [
          UI.el('button', {
            class: 'btn ghost block', type: 'button',
            onclick: () => {
              Store.setWeekScale(week.weekNumber, 1);
              closeSheet();
              toast('Week back to 100%', null);
            }
          }, ['Reset this week'])
        ])
      );
      return wrap;
    });
  }

  /* ---- bulk add ---- */
  function openBulkAddSheet() {
    let discipline = 'run';
    let duration = 60;
    let weeks = 4;
    const daySelection = { monday: false, tuesday: false, wednesday: false, thursday: false, friday: false, saturday: true, sunday: false };
    const startDate = Plan.todayISO();

    openSheet(() => {
      const wrap = document.createDocumentFragment();

      const discRow = UI.el('div', { class: 'segmented' });
      const discs = [['run', 'Run'], ['bike', 'Bike'], ['swim', 'Swim'], ['strength', 'Gym'], ['cross', 'Other'], ['rest', 'Rest']];
      for (const [val, label] of discs) {
        discRow.append(UI.el('button', {
          type: 'button',
          'aria-pressed': String(val === discipline),
          onclick: () => {
            discipline = val;
            discRow.querySelectorAll('button').forEach(b =>
              b.setAttribute('aria-pressed', String(b.textContent === label)));
          }
        }, [label]));
      }

      const durInput = UI.el('input', {
        type: 'number', min: '5', max: '600', step: '5', value: String(duration),
        oninput: (e) => { duration = Number(e.target.value) || 0; }
      });

      const weeksInput = UI.el('input', {
        type: 'number', min: '1', max: '52', step: '1', value: String(weeks),
        oninput: (e) => { weeks = Number(e.target.value) || 1; }
      });

      const dayRow = UI.el('div', { class: 'day-picker' });
      const dayLabels = [['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'], ['thursday', 'Thu'], ['friday', 'Fri'], ['saturday', 'Sat'], ['sunday', 'Sun']];
      for (const [key, label] of dayLabels) {
        const btn = UI.el('button', {
          type: 'button',
          'aria-pressed': String(daySelection[key]),
          class: 'daybtn' + (daySelection[key] ? ' sel' : ''),
          onclick: () => {
            daySelection[key] = !daySelection[key];
            btn.setAttribute('aria-pressed', String(daySelection[key]));
            btn.classList.toggle('sel', daySelection[key]);
          }
        }, [label]);
        dayRow.append(btn);
      }

      const selectedDays = Object.keys(daySelection).filter(k => daySelection[k]);
      const info = el('p', { class: 'sh-text', text: `Will add ${selectedDays.length} session(s) per week for ${weeks} week(s). Starting ${Plan.prettyDate(startDate)}.` });

      appendAll(wrap,
        sheetHead('Bulk Add', 'Add multiple sessions', true),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Discipline' }), discRow
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Minutes per session' }),
          UI.el('div', { class: 'field' }, [durInput])
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Number of weeks' }),
          UI.el('div', { class: 'field' }, [weeksInput])
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Days of week' }),
          dayRow
        ]),
        info,
        UI.el('div', { class: 'btnrow' }, [
          UI.el('button', {
            class: 'btn primary block', type: 'button',
            onclick: () => {
              if (selectedDays.length === 0) {
                toast('Pick at least one day', null);
                return;
              }
              let added = 0;
              let current = Plan.parseISO(startDate);
              for (let w = 0; w < weeks; w++) {
                const weekStart = new Date(current.getFullYear(), current.getMonth(), current.getDate() - ((current.getDay() + 6) % 7));
                for (const dayKey of selectedDays) {
                  const dayOffset = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].indexOf(dayKey);
                  const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + dayOffset);
                  const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                  Store.addExtra({
                    date: iso,
                    athletes: ['eric', 'ella'],
                    discipline,
                    title: UI.LABELS[discipline],
                    duration,
                    intensity: 'Z2',
                    sets: '',
                    notes: '',
                    together: true
                  });
                  added++;
                }
                current = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
              }
              closeSheet();
              toast(`Added ${added} session(s)`, null);
            }
          }, ['Add them all'])
        ])
      );

      return wrap;
    });
  }

  /* ---- week note ---- */
  function openEditNoteSheet() {
    const week = Plan.weekFor(state.weekNumber);
    const current = Store.getWeekNote(week.weekNumber);

    openSheet(() => {
      const wrap = document.createDocumentFragment();
      const textarea = UI.el('textarea', {
        rows: '4',
        placeholder: 'How did this week go? e.g. felt great, had a cold, work travel',
        value: current
      });

      appendAll(wrap,
        sheetHead(`Week ${week.weekNumber}`, 'Week note', true),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Note' }),
          UI.el('div', { class: 'field' }, [textarea])
        ]),
        UI.el('div', { class: 'btnrow' }, [
          UI.el('button', {
            class: 'btn primary block', type: 'button',
            onclick: () => {
              Store.setWeekNote(week.weekNumber, textarea.value);
              closeSheet();
              toast('Week note saved', null);
            }
          }, ['Save']),
          UI.el('button', {
            class: 'btn ghost block', type: 'button',
            onclick: () => {
              Store.setWeekNote(week.weekNumber, '');
              closeSheet();
              toast('Week note cleared', null);
            }
          }, ['Clear'])
        ])
      );

      return wrap;
    });
  }

  /* ---- log actuals ---- */
  function openLogActualsSheet(s, athlete) {
    const current = Store.getLog(s.id, athlete) || {};
    const alreadyDone = Store.isDone(s.id, athlete);

    openSheet(() => {
      const wrap = document.createDocumentFragment();
      const actualMin = UI.el('input', {
        type: 'number', min: '1', max: '600', step: '5',
        placeholder: 'e.g. 45',
        value: current.actualMin || ''
      });
      const rpe = UI.el('input', {
        type: 'number', min: '1', max: '10', step: '1',
        placeholder: '1-10',
        value: current.rpe || ''
      });
      const note = UI.el('textarea', {
        rows: '3',
        placeholder: 'How did it feel? e.g. sore calf, felt strong',
        value: current.note || ''
      });

      appendAll(wrap,
        sheetHead(Plan.prettyDate(s.date, true),
          alreadyDone ? 'Edit logged workout' : 'Log workout', true),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Actual minutes' }),
          UI.el('div', { class: 'field' }, [actualMin])
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Effort (RPE 1-10)' }),
          UI.el('div', { class: 'field' }, [rpe])
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Notes' }),
          UI.el('div', { class: 'field' }, [note])
        ]),
        UI.el('div', { class: 'btnrow' }, [
          UI.el('button', {
            class: 'btn primary block', type: 'button',
            onclick: () => {
              Store.setDoneWithActuals(s.id, athlete,
                Number(actualMin.value) || null,
                Number(rpe.value) || null,
                note.value.trim() || null);
              closeSheet();
              toast('Logged', null);
            }
          }, [alreadyDone ? 'Save changes' : 'Save']),
          UI.el('button', {
            class: 'btn ghost block', type: 'button',
            onclick: () => closeSheet()
          }, ['Cancel'])
        ]),
        alreadyDone ? UI.el('div', { class: 'btnrow' }, [
          UI.el('button', {
            class: 'btn danger block', type: 'button',
            onclick: () => {
              Store.setDone(s.id, athlete, false);
              closeSheet();
              toast('Unchecked', null);
            }
          }, ['Remove completion'])
        ]) : null
      );

      return wrap;
    });
  }

  /* ---- week options ---- */
  function openWeekOptionsSheet() {
    const week = Plan.weekFor(state.weekNumber);
    const isSkipped = Store.isWeekSkipped(week.weekNumber);

    openSheet(() => {
      const wrap = document.createDocumentFragment();

      appendAll(wrap,
        sheetHead(`Week ${week.weekNumber}`, 'Week options', true),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Week status' }),
          UI.el('div', { class: 'btnrow' }, [
            UI.el('button', {
              class: 'btn block', type: 'button',
              onclick: () => {
                Store.setWeekSkip(week.weekNumber, !isSkipped);
                closeSheet();
                toast(isSkipped ? 'Week unskipped' : 'Week skipped', null);
              }
            }, [isSkipped ? 'Unskip week' : 'Skip week'])
          ])
        ]),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Week note' }),
          UI.el('div', { class: 'btnrow' }, [
            UI.el('button', {
              class: 'btn block', type: 'button',
              onclick: () => { closeSheet(); openEditNoteSheet(); }
            }, ['Edit note'])
          ])
        ]),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Plan' }),
          UI.el('div', { class: 'btnrow' }, [
            UI.el('button', {
              class: 'btn block', type: 'button',
              onclick: () => { closeSheet(); openWeekBoard(); }
            }, ['Week board (drag to days)']),
            UI.el('button', {
              class: 'btn block', type: 'button',
              onclick: () => { closeSheet(); openWeekPlanner(); }
            }, ['Quick move']),
            UI.el('button', {
              class: 'btn block', type: 'button',
              onclick: () => { closeSheet(); openTemplateEditor(); }
            }, ['Weekly layout'])
          ])
        ]),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Add sessions' }),
          UI.el('div', { class: 'btnrow' }, [
            UI.el('button', {
              class: 'btn block', type: 'button',
              onclick: () => { closeSheet(); openBulkAddSheet(); }
            }, ['Bulk add'])
          ])
        ]),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Adjust week' }),
          UI.el('div', { class: 'btnrow' }, [
            UI.el('button', {
              class: 'btn block', type: 'button',
              onclick: () => { closeSheet(); openScaleSheet(); }
            }, ['Scale volume'])
          ])
        ]),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Calendar' }),
          UI.el('div', { class: 'btnrow' }, [
            UI.el('button', {
              class: 'btn block', type: 'button',
              onclick: () => exportWeekToCalendar()
            }, ['Add this week to Google Calendar'])
          ])
        ])
      );

      return wrap;
    });
  }

  /* ---- week planner: tap or drag workouts between days ---- */
  function plannerSessions(iso) {
    if (state.athlete !== 'both') return Plan.sessionsOn(iso, state.athlete);
    const map = new Map();
    for (const s of [...Plan.togetherOn(iso), ...Plan.sessionsOn(iso, 'eric'), ...Plan.sessionsOn(iso, 'ella')]) {
      map.set(s.id, s);
    }
    return [...map.values()];
  }

  function openWeekPlanner(preselectId) {
    const week = Plan.weekFor(state.weekNumber);
    let selected = null;

    if (preselectId) {
      for (let i = 0; i < 7; i++) {
        const iso = Plan.addDays(week.startDate, i);
        const found = plannerSessions(iso).find(x => x.id === preselectId);
        if (found) { selected = found; break; }
      }
    }

    const moveTo = (session, iso) => {
      if (!session || session.date === iso) return;
      moveSessionTo(session, iso, 'both');
      Plan.refresh();
      render();
      selected = null;
      paintSheet();
      toast('Moved to ' + Plan.prettyDate(iso), null);
    };

    openSheet(() => {
      const wrap = document.createDocumentFragment();

      appendAll(wrap,
        UI.el('div', { class: 'sh-head' }, [
          UI.el('p', { class: 'sh-eyebrow', text: 'Week ' + week.weekNumber }),
          UI.el('h2', { class: 'sh-title', id: 'sheetTitle', text: 'Plan your week' })
        ]),
        UI.el('p', {
          class: 'sh-text',
          text: 'Tap a workout, then tap a day to move it. Or hold the ⠿ handle on the week view and drag. The original plan is never changed — you can reset any moved workout.'
        })
      );

      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const dayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

      days.forEach((dayKey, i) => {
        const iso = Plan.addDays(week.startDate, i);
        const sessions = plannerSessions(iso);
        const real = sessions.filter(s => s.discipline !== 'rest');
        const total = real.reduce((sum, s) => sum + (s.duration || 0), 0);

        const row = UI.el('div', {
          class: 'planner-day' + (selected ? ' can-drop' : ''),
          dataset: { date: iso },
          onclick: () => {
            if (selected) moveTo(selected, iso);
          },
          ondragover: (e) => { e.preventDefault(); row.classList.add('drag-over'); },
          ondragleave: () => row.classList.remove('drag-over'),
          ondrop: (e) => {
            e.preventDefault();
            row.classList.remove('drag-over');
            const id = e.dataTransfer.getData('text/plain');
            const s = plannerSessions(iso).find(x => x.id === id) ||
              (weekObjSessions(id));
            if (s) moveTo(s, iso);
          }
        });

        row.append(UI.el('div', { class: 'planner-day-head' }, [
          UI.el('span', { class: 'planner-day-name', text: dayLabels[i] }),
          UI.el('span', { class: 'planner-day-date', text: Plan.prettyDate(iso) }),
          UI.el('span', { class: 'planner-day-total', text: total ? UI.fmtDur(total) : 'Rest' })
        ]));

        const chips = UI.el('div', { class: 'planner-chips' });
        if (!real.length) {
          chips.append(UI.el('span', { class: 'planner-rest', text: 'Rest day' }));
        }
        for (const s of sessions) {
          if (s.discipline === 'rest') continue;
          const chip = UI.el('button', {
            class: 'planner-chip ' + s.discipline + (selected && selected.id === s.id ? ' sel' : ''),
            type: 'button',
            draggable: 'true',
            'aria-pressed': String(!!(selected && selected.id === s.id)),
            onclick: (e) => {
              e.stopPropagation();
              const already = selected && selected.id === s.id;
              selected = already ? null : s;
              paintSheet();
            },
            ondragstart: (e) => {
              e.dataTransfer.setData('text/plain', s.id);
              e.dataTransfer.effectAllowed = 'move';
            }
          }, [
            UI.icon(s.discipline, 14),
            UI.el('span', { class: 'planner-chip-title', text: s.title || UI.LABELS[s.discipline] || s.discipline }),
            UI.el('span', { class: 'planner-chip-dur', text: UI.fmtDur(s.duration) })
          ]);
          chips.append(chip);
        }

        if (!selected) {
          chips.append(UI.el('button', {
            class: 'planner-add',
            type: 'button',
            'aria-label': 'Add a workout to ' + dayLabels[i],
            onclick: (e) => {
              e.stopPropagation();
              openAddSheet(iso);
            }
          }, ['+']));
        }
        row.append(chips);
        wrap.append(row);
      });

      if (selected) {
        wrap.append(UI.el('p', {
          class: 'planner-hint',
          text: 'Now tap the day you want "' +
            (selected.title || UI.LABELS[selected.discipline] || selected.discipline) + '" on.'
        }));
      }

      wrap.append(UI.el('div', { class: 'btnrow' }, [
        UI.el('button', {
          class: 'btn', type: 'button',
          onclick: () => { closeSheet(); openTemplateEditor(); }
        }, ['Weekly layout']),
        UI.el('button', {
          class: 'btn', type: 'button',
          onclick: () => { closeSheet(); exportWeekToCalendar(); }
        }, ['Add week to Calendar'])
      ]));

      return wrap;
    });

    /* Find a session anywhere in this week by id (for drag/drop). */
    function weekObjSessions(id) {
      for (let i = 0; i < 7; i++) {
        const iso = Plan.addDays(week.startDate, i);
        const found = plannerSessions(iso).find(x => x.id === id);
        if (found) return found;
      }
      return null;
    }
  }

  /* ---- week board: pool + days, drag workouts onto days ---- */
  function openWeekBoard(preselectId) {
    const week = Plan.weekFor(state.weekNumber);
    const who = state.athlete === 'both' ? 'both' : state.athlete;
    const sessions = Plan.boardSessionsForWeek(week.weekNumber, who);
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const dayLabels = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

    const selectedId = preselectId || null;

    const existingBoard = Store.getWeekBoard(week.weekNumber);

    openSheet(() => {
      const wrap = document.createDocumentFragment();

      appendAll(wrap,
        UI.el('div', { class: 'sh-head' }, [
          UI.el('p', { class: 'sh-eyebrow', text: 'Week ' + week.weekNumber }),
          UI.el('h2', { class: 'sh-title', id: 'sheetTitle', text: 'Week board' })
        ]),
        UI.el('p', {
          class: 'sh-text',
          text: 'Drag (or tap) each workout onto the day that works this week. Workouts left in the pool don’t show on your week until you place them.'
        }),

        /* Pool: everything not on a day yet. */
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Not scheduled yet' }),
          UI.el('div', {
            class: 'board-pool',
            'data-date': 'pool',
            ondragover: (e) => { e.preventDefault(); },
            ondrop: (e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain');
              const moved = findSession(id);
              if (moved && !Store.isPooled(week.weekNumber, moved.id)) {
                Store.poolSession(week.weekNumber, moved.id);
                Plan.refresh(); render(); paintSheet();
                toast('Back in the pool', null);
              }
            }
          }, [
            UI.el('div', { class: 'board-pool-head' }, [
              UI.el('span', { class: 'board-pool-name', text: 'Pool' }),
              UI.el('span', { class: 'board-pool-date', text: sessions.filter(s => s.pooled).length + ' waiting' })
            ]),
            UI.el('div', { class: 'planner-chips' }, [
              ...pooledChips()
            ])
          ])
        ]),

        /* The seven days. */
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Days' }),
          ...days.map((dayKey, i) => {
            const iso = Plan.addDays(week.startDate, i);
            const today = Plan.todayISO();
            const assigned = sessions.filter(s => !s.pooled && s.date === iso);
            const total = assigned.reduce((sum, s) => sum + (s.duration || 0), 0);

            const row = UI.el('div', {
              class: 'board-day' + (assigned.length ? '' : ' is-empty') + (iso === today ? ' is-today' : ''),
              'data-date': iso,
              ondragover: (e) => { e.preventDefault(); row.classList.add('drag-over'); },
              ondragleave: () => row.classList.remove('drag-over'),
              ondrop: (e) => {
                e.preventDefault();
                row.classList.remove('drag-over');
                const id = e.dataTransfer.getData('text/plain');
                const moved = findSession(id);
                if (moved) {
                  Store.assignWeekBoardSession(week.weekNumber, moved.id, iso);
                  Plan.refresh(); render(); paintSheet();
                  toast('Placed on ' + Plan.prettyDate(iso), null);
                }
              },
              onclick: () => {
                if (selectedId) {
                  const moved = findSession(selectedId);
                  if (moved && !moved.pooled && moved.date === iso) return;
                  if (moved) {
                    Store.assignWeekBoardSession(week.weekNumber, moved.id, iso);
                    Plan.refresh(); render(); paintSheet();
                    selectedId = null;
                    toast('Placed on ' + Plan.prettyDate(iso), null);
                  }
                }
              }
            }, [
              UI.el('div', { class: 'board-pool-head' }, [
                UI.el('span', { class: 'board-pool-name', text: dayLabels[i] }),
                UI.el('span', { class: 'board-pool-date', text: Plan.prettyDate(iso) + (iso === today ? ' · today' : '') }),
                UI.el('span', { class: 'board-pool-total', text: total ? UI.fmtDur(total) : 'Rest' })
              ]),
              UI.el('div', { class: 'planner-chips' }, [
                ...assigned.map(s => boardChip(s, iso))
              ])
            ])
          })
        ]),

        UI.el('div', { class: 'board-actions btnrow' }, [
          UI.el('button', {
            class: 'btn block', type: 'button',
            onclick: () => {
              const ids = sessions.map(s => s.id);
              Store.poolWholeWeek(week.weekNumber, ids);
              Plan.refresh(); render(); paintSheet();
              toast('Blank board — all workouts in the pool', null);
            }
          }, ['Clear days → pool']),
          UI.el('button', {
            class: 'btn ghost block', type: 'button',
            onclick: () => {
              Store.clearWeekBoard(week.weekNumber);
              Plan.refresh(); render(); paintSheet();
              toast('Back to plan days', null);
            }
          }, ['Use plan days'])
        ]),

        UI.el('div', { class: 'planner-hint', text: existingBoard ? 'Board saved for this week.' : '' })
      );

      return wrap;

      function pooledChips() {
        const pool = sessions.filter(s => s.pooled);
        if (!pool.length) return [elp('Rest — everything is on a day')];
        return pool.map(s => boardChip(s, 'pool'));
      }

      function boardChip(s, ownerDate) {
        const selected = selectedId === s.id;
        const isPool = ownerDate === 'pool';
        return UI.el('button', {
          class: 'planner-chip ' + s.discipline + (selected ? ' sel' : ''),
          type: 'button',
          draggable: 'true',
          'aria-pressed': String(selected),
          title: (s.title || UI.LABELS[s.discipline] || s.discipline) + ' · ' + UI.fmtDur(s.duration),
          onclick: (e) => {
            e.stopPropagation();
            selectedId = selectedId === s.id ? null : s.id;
            paintSheet();
          },
          ondragstart: (e) => {
            e.dataTransfer.setData('text/plain', s.id);
            e.dataTransfer.effectAllowed = 'move';
          }
        }, [
          UI.icon(s.discipline, 14),
          UI.el('span', { class: 'planner-chip-title', text: s.title || UI.LABELS[s.discipline] || s.discipline }),
          UI.el('span', { class: 'planner-chip-dur', text: UI.fmtDur(s.duration) })
        ]);
      }

      function findSession(id) {
        return sessions.find(s => s.id === id);
      }
      function elp(text) { return UI.el('p', { class: 'board-empty', text: text }); }
    });
  }

  function exportWeekToCalendar() {
    const who = state.athlete === 'both' ? 'eric' : state.athlete;
    const sessions = Plan.sessionsForWeek(state.weekNumber, who)
      .filter(s => s.discipline !== 'rest');
    if (!sessions.length) {
      toast('No workouts this week', null);
      return;
    }
    Cal.exportSessions(sessions, `week-${state.weekNumber}-workouts.ics`,
      'Week ' + state.weekNumber + ' workouts');
    toast('Calendar file downloaded', null);
  }

  /* ---- weekly template editor ---- */
  function openTemplateEditor() {
    const week = Plan.weekFor(state.weekNumber);
    const existing = Store.getWeekTemplate(week.weekNumber) || { days: {}, scope: 'both' };
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const disciplines = [
      ['rest', 'Rest'],
      ['swim', 'Swim'],
      ['bike', 'Bike'],
      ['run', 'Run'],
      ['brick', 'Brick'],
      ['strength', 'Mobility'],
      ['cross', 'Other'],
      ['open-water-swim', 'Open Water']
    ];

    let scope = existing.scope || 'both';
    const dayValues = { ...existing.days };

    openSheet(() => {
      const wrap = document.createDocumentFragment();

      // Scope picker
      const scopeRow = UI.el('div', { class: 'segmented' });
      const scopes = [['both','Both'],['eric','Eric'],['ella','Ella']];
      for (const [v, l] of scopes) {
        scopeRow.append(UI.el('button', {
          type: 'button',
          'aria-pressed': String(scope === v),
          class: 'scopebtn',
          onclick: () => {
            scope = v;
            scopeRow.querySelectorAll('button').forEach(b =>
              b.setAttribute('aria-pressed', String(b.textContent === l)));
          }
        }, [l]));
      }

      // Day pickers
      const dayRows = days.map((dayKey, i) => {
        const val = dayValues[dayKey] || 'rest';
        const row = UI.el('div', { class: 'tpl-day-row' });
        row.append(UI.el('span', { class: 'tpl-day-label', text: dayLabels[i] }));
        disciplines.forEach(([d, label]) => {
          row.append(UI.el('button', {
            type: 'button',
            'aria-pressed': String(val === d),
            class: 'tpl-daybtn' + (val === d ? ' sel' : ''),
            'data-day': dayKey,
            'data-discipline': d,
            onclick: (e) => {
              dayValues[dayKey] = d;
              // Update all buttons in this row
              row.querySelectorAll('button').forEach(b =>
                b.setAttribute('aria-pressed', String(b.dataset.discipline === d)));
              row.querySelectorAll('button').forEach(b =>
                b.classList.toggle('sel', b.dataset.discipline === d));
            }
          }, [label]));
        });
        return row;
      });

      // Preview
      const preview = UI.el('div', { class: 'tpl-preview' });
      const previewHeader = UI.el('div', { class: 'tpl-preview-head', text: 'Preview' });
      preview.append(previewHeader);
      days.forEach((dayKey, i) => {
        const d = dayValues[dayKey] || 'rest';
        const label = disciplines.find(([k]) => k === d)[1];
        const color = d === 'rest'
          ? 'var(--text-soft)'
          : d === 'open-water-swim' ? 'var(--ows)' : 'var(--' + d + ')';
        const p = UI.el('div', { class: 'tpl-preview-day', style: 'color:' + color });
        p.append(UI.el('span', { class: 'tpl-pv-day', text: dayLabels[i] }));
        p.append(UI.el('span', { class: 'tpl-pv-disc ' + d, text: label }));
        preview.append(p);
      });

      appendAll(wrap,
        sheetHead(`Week ${week.weekNumber}`, 'Weekly layout', true),

        UI.el('p', {
          class: 'sh-text',
          text: 'This is a filter: pick the sport you want to see on each day, or Rest to hide that day. If a sport is missing that day, add it with + in Plan week.'
        }),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Apply to' }),
          scopeRow
        ]),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Discipline per day' }),
          ...dayRows
        ]),

        preview,

        UI.el('div', { class: 'btnrow' }, [
          UI.el('button', {
            class: 'btn primary block', type: 'button',
            onclick: () => {
              Store.setWeekTemplate(week.weekNumber, { days: dayValues, scope: scope });
              closeSheet();
              toast('Template saved for Week ' + week.weekNumber, null);
              render();
            }
          }, ['Save Template']),
          UI.el('button', {
            class: 'btn ghost block', type: 'button',
            onclick: () => {
              Store.setWeekTemplate(week.weekNumber, { days: {}, scope: 'both' });
              closeSheet();
              toast('Template cleared', null);
              render();
            }
          }, ['Clear'])
        ])
      );

      return wrap;
    });
  }

  /* ---- settings ---- */
  function openSettings() {
    openSheet(() => {
      const wrap = document.createDocumentFragment();

      const themeRow = UI.el('div', { class: 'segmented segmented-wrap' });
      for (const [val, label] of [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark'], ['vibrant', 'Vibrant'], ['pink', 'Bloom 🌷']]) {
        themeRow.append(UI.el('button', {
          type: 'button',
          'aria-pressed': String(Store.state.theme === val),
          onclick: () => {
            Store.update(s => { s.theme = val; });
            applyTheme();
            themeRow.querySelectorAll('button').forEach(b =>
              b.setAttribute('aria-pressed', String(b.textContent === label)));
          }
        }, [label]));
      }

      const meRow = UI.el('div', { class: 'segmented' });
      for (const [val, label] of [['eric', 'Eric'], ['ella', 'Ella']]) {
        meRow.append(UI.el('button', {
          type: 'button',
          'aria-pressed': String(Store.state.me === val),
          onclick: () => {
            Store.update(s => { s.me = val; });
            meRow.querySelectorAll('button').forEach(b =>
              b.setAttribute('aria-pressed', String(b.textContent === label)));
          }
        }, [label]));
      }

      const fileInput = UI.el('input', {
        type: 'file', accept: '.json,application/json',
        style: 'display:none',
        onchange: (e) => {
          const file = e.target.files[0];
          if (!file) return;
          if (!confirm('Importing will overwrite all checkmarks, edits, and settings on this phone. Continue?')) {
            e.target.value = '';
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            try {
              Store.importJSON(reader.result);
              closeSheet();
              toast('Data imported', null);
            } catch (err) {
              toast('That file did not look right', null);
            }
          };
          reader.readAsText(file);
        }
      });

      const planInput = UI.el('input', {
        type: 'file', accept: '.json,application/json',
        style: 'display:none',
        onchange: (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              const parsed = JSON.parse(reader.result);
              if (!parsed || !Array.isArray(parsed.weeks) || !parsed.weeks.length) {
                throw new Error('This file has no weeks');
              }
              if (!parsed.startDate) throw new Error('This file has no startDate');
              if (!parsed.weeks.every(w => w && Array.isArray(w.days))) {
                throw new Error('Every week needs a days array');
              }
              for (const w of parsed.weeks) {
                if (!w.weekNumber || !w.startDate || !w.endDate) {
                  throw new Error('Every week needs weekNumber, startDate and endDate');
                }
                for (const d of w.days) {
                  if (!d || !d.date || !Array.isArray(d.sessions)) {
                    throw new Error('Every day needs a date and a sessions array');
                  }
                }
              }
              Store.setCustomPlan(parsed);
              await Plan.load();
              render();
              closeSheet();
              toast('Your plan is loaded', null);
            } catch (err) {
              toast(err.message || 'That plan did not look right', null);
            }
          };
          reader.readAsText(file);
        }
      });

      appendAll(wrap,
        sheetHead('Settings', 'Preferences', null),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Appearance' }), themeRow,
          UI.el('p', { class: 'note-line', text: 'Bloom is the pink theme. Themes stay on this phone — Ella can keep Bloom even if Eric picks something else.' })
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'This phone belongs to' }),
          meRow,
          UI.el('p', { class: 'note-line', text: 'Used to tag edits. Both of you can edit both plans.' })
        ]),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Your data' }),
          UI.el('p', { class: 'sh-text', text: 'Checkmarks, moves and templates sync between your phones through Turso. Export is a backup, or for moving to a new phone.' }),
          UI.el('div', { class: 'btnrow' }, [
            UI.el('button', {
              class: 'btn', type: 'button',
              onclick: () => {
                const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = UI.el('a', { href: url, download: 'ironman-data.json' });
                document.body.append(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              }
            }, ['Export']),
            UI.el('button', {
              class: 'btn', type: 'button',
              onclick: () => fileInput.click()
            }, ['Import']),
            fileInput
          ])
        ]),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Your plan' }),
          UI.el('p', {
            class: 'sh-text',
            text: Store.state.customPlan
              ? 'You are using an imported plan. Download it as a backup, or switch back to the built-in 70.3 plan.'
              : 'Import a plan.json file to use your own schedule. It needs startDate and a weeks array; everything else is optional.'
          }),
          UI.el('div', { class: 'btnrow' }, [
            UI.el('button', {
              class: 'btn', type: 'button',
              onclick: () => planInput.click()
            }, ['Import plan']),
            UI.el('button', {
              class: 'btn', type: 'button',
              onclick: () => {
                const blob = new Blob([JSON.stringify(Plan.data, null, 1)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = UI.el('a', { href: url, download: 'plan.json' });
                document.body.append(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              }
            }, ['Download plan']),
            planInput
          ]),
          Store.state.customPlan ? UI.el('div', { class: 'btnrow' }, [
            UI.el('button', {
              class: 'btn ghost block', type: 'button',
              onclick: async () => {
                if (!confirm('Switch back to the built-in plan? Your checkmarks and moves stay.')) return;
                Store.clearCustomPlan();
                await Plan.load();
                render();
                closeSheet();
                toast('Built-in plan restored', null);
              }
            }, ['Use built-in plan'])
          ]) : null
        ]),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Calendar' }),
          UI.el('p', { class: 'sh-text', text: 'Download .ics files, then import them into Google Calendar or Apple Calendar. Workouts are all-day events with the sets in the description.' }),
          UI.el('div', { class: 'btnrow' }, [
            UI.el('button', {
              class: 'btn', type: 'button',
              onclick: () => {
                try {
                  Cal.exportCalendar(Plan.data);
                  toast('Events downloaded', null);
                } catch (err) {
                  toast(err.message || 'Export failed', null);
                }
              }
            }, ['Race dates']),
            UI.el('button', {
              class: 'btn', type: 'button',
              onclick: () => exportWeekToCalendar()
            }, ['This week']),
            UI.el('button', {
              class: 'btn', type: 'button',
              onclick: () => {
                const who = state.athlete === 'both' ? 'eric' : state.athlete;
                const all = [];
                for (const w of Plan.data.weeks) {
                  all.push(...Plan.sessionsForWeek(w.weekNumber, who));
                }
                const workouts = all.filter(s => s.discipline !== 'rest');
                if (!workouts.length) { toast('No workouts to export', null); return; }
                Cal.exportSessions(workouts, 'all-workouts.ics', 'All workouts');
                toast('All workouts downloaded', null);
              }
            }, ['All workouts'])
          ])
        ]),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Weekly layouts' }),
          UI.el('p', { class: 'sh-text', text: 'Layouts choose which sport shows on each day. They sync between phones.' }),
          UI.el('div', { class: 'btnrow' }, [
            UI.el('button', {
              class: 'btn', type: 'button',
              onclick: () => { closeSheet(); openTemplateEditor(); }
            }, ['Edit this week']),
            Object.keys(Store.state.weeklyTemplates || {}).length ? UI.el('button', {
              class: 'btn danger', type: 'button',
              onclick: () => {
                if (!confirm('Clear every weekly template?')) return;
                Store.clearWeekTemplates();
                toast('Templates cleared', null);
              }
            }, ['Clear all']) : null
          ])
        ]),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Watches & apps' }),
          UI.el('p', {
            class: 'note-line',
            text: 'Strava, Garmin, COROS and Apple Health are on the someday list. For now, log minutes here — it takes about five seconds.'
          })
        ]),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Danger zone' }),
          UI.el('div', { class: 'btnrow' }, [
            UI.el('button', {
              class: 'btn danger', type: 'button',
              onclick: () => {
                if (confirm('Erase all checkmarks and edits on this phone?')) {
                  Store.resetAll();
                  closeSheet();
                  toast('Everything reset', null);
                }
              }
            }, ['Erase local data'])
          ])
        ]),

        UI.el('p', {
          class: 'note-line',
          style: 'margin-top:22px',
          text: 'Plan v' + (Plan.data.planVersion || '1') +
            ' · ' + Plan.data.weeks.length + ' weeks · ' +
            (Plan.data.goal || 'Finish comfortably')
        })
      );

      return wrap;
    });
  }

  /* ----------------------------------------------------------- toast */
  let toastTimer = null;
  function toast(message, actionLabel, actionFn) {
    const node = $('#toast');
    node.replaceChildren(UI.el('span', { text: message }));
    if (actionLabel) {
      node.append(UI.el('button', { type: 'button', onclick: actionFn }, [actionLabel]));
    }
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, actionLabel ? 5000 : 2200);
  }

  /* ------------------------------------------------------------- pwa */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const installingWorker = reg.installing;
        if (!installingWorker) return;
        installingWorker.addEventListener('statechange', () => {
          if (
            installingWorker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            toast('App updated — refresh to get the latest version', 'Refresh', () => {
              window.location.reload();
            });
          }
        });
      });
    }).catch(() => {});
  }

  /* ------------------------------------------------------------ init */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
