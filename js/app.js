/* ==========================================================================
   app.js — state, routing, sheets. The glue.
   ========================================================================== */

(() => {
  const $ = (sel) => document.querySelector(sel);

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
      meta.setAttribute('content',
        t === 'dark' ? '#131512' : t === 'vibrant' ? '#0a0a0c' : '#faf9f6');
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
          class: 'linkbtn', type: 'button',
          onclick: openScaleSheet
        }, ['Adjust week']),
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

    $('#weekHead').after(UI.todayStrip((iso) => {
      state.weekNumber = Plan.weekNumberFor(iso);
      render();
    }));

    const list = document.createDocumentFragment();
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
      athlete === 'both' ? 'Eric' : (Plan.data.athletes[athlete] || {}).name || athlete;

    // bring the current week into view inside the scrolling chart
    const wrap = $('#chartWrap');
    const cw = Number(svg.dataset.currentWeek) || 1;
    const barX = 26 + (cw - 1) * 15;
    wrap.scrollLeft = Math.max(0, barX - wrap.clientWidth / 2);

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
      onMove: (s) => openMoveSheet(s),
      onEdit: (s) => openEditSheet(s),
      onAdd: (iso) => openAddSheet(iso),
      onReset: (s) => resetSession(s)
    };
  }

  function toggleDone(s, athleteOverride) {
    if (state.athlete === 'both') {
      Store.toggleDone(s.id, athleteOverride || 'eric');
    } else {
      Store.toggleDone(s.id, state.athlete);
    }
  }

  function resetSession(s) {
    Store.clearOverride(s.id);
    closeSheet();
    toast('Reset to the original plan', null);
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

      wrap.append(
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
              Store.move(s.id, picked, scope);
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
      wrap.append(UI.el('button', {
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

      wrap.append(
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
  function openAddSheet(iso) {
    pushSheet(() => {
      let discipline = 'run';
      let athlete = state.athlete === 'both' ? 'both' : state.athlete;

      const wrap = document.createDocumentFragment();

      const discRow = UI.el('div', { class: 'segmented' });
      const discs = [['run', 'Run'], ['bike', 'Bike'], ['swim', 'Swim'], ['strength', 'Mobility'], ['rest', 'Rest']];
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

      wrap.append(
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

      wrap.append(
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

  /* ---- settings ---- */
  function openSettings() {
    openSheet(() => {
      const wrap = document.createDocumentFragment();

      const themeRow = UI.el('div', { class: 'segmented' });
      for (const [val, label] of [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark'], ['vibrant', 'Vibrant']]) {
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

      wrap.append(
        sheetHead('Settings', 'Preferences', null),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Appearance' }), themeRow
        ]),
        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'This phone belongs to' }),
          meRow,
          UI.el('p', { class: 'note-line', text: 'Used to tag edits. Both of you can edit both plans.' })
        ]),

        UI.el('div', { class: 'sh-section' }, [
          UI.el('div', { class: 'sh-label', text: 'Your data' }),
          UI.el('p', { class: 'sh-text', text: 'Checkmarks and edits live on this phone only for now. Export to move them to another device.' }),
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
          UI.el('div', { class: 'sh-label', text: 'Calendar' }),
          UI.el('p', { class: 'sh-text', text: 'Download race and milestone events as an .ics file, then import into Google Calendar or Apple Calendar.' }),
          UI.el('div', { class: 'btnrow' }, [
            UI.el('button', {
              class: 'btn', type: 'button',
              onclick: () => {
                try {
                  Cal.exportCalendar(Plan.data);
                  toast('Calendar file downloaded', null);
                } catch (err) {
                  toast(err.message || 'Export failed', null);
                }
              }
            }, ['Export to Calendar'])
          ])
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
            Plan.data.goal
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
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* ------------------------------------------------------------ init */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
