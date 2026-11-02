/* ==========================================================================
   ui.js — all rendering. Pure functions that return DOM nodes.
   Nothing here reads or writes storage directly.
   ========================================================================== */

const UI = (() => {

  const ICONS = {
    swim: '<path d="M2 15.5c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6"/><path d="M2 19.5c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6"/><circle cx="17.5" cy="6.5" r="2"/><path d="M6 10.5l4-1.5 4 2"/>',
    'open-water-swim': '<path d="M2 15.5c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6"/><path d="M2 19.5c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6"/><path d="M13 8l2-3 4 1"/><circle cx="11" cy="6" r="1.6"/>',
    bike: '<circle cx="5.5" cy="17" r="3.3"/><circle cx="18.5" cy="17" r="3.3"/><path d="M5.5 17l4.5-8h5l3.5 8"/><path d="M9 9h6"/>',
    run: '<circle cx="15" cy="4.6" r="2"/><path d="M14 8.6l-3.4 4.2 3.2 1.9-1.8 5"/><path d="M10.6 12.8L6.4 11.6"/><path d="M13.8 14.7l4.2 1.6"/>',
    brick: '<rect x="3" y="7" width="8.5" height="8.5" rx="2.2"/><rect x="12.5" y="9" width="8.5" height="8.5" rx="2.2"/>',
    strength: '<path d="M4 9.5v5M7 7.5v9M17 7.5v9M20 9.5v5M7 12h10"/>',
    rest: '<path d="M20.5 14.6A8.4 8.4 0 019.4 3.5a8.4 8.4 0 1011.1 11.1z"/>',
    race: '<path d="M5.5 21V3.5"/><path d="M5.5 4h11l-2 4 2 4h-11"/>'
  };

  const LABELS = {
    swim: 'Swim',
    'open-water-swim': 'Open water',
    bike: 'Bike',
    run: 'Run',
    brick: 'Brick',
    strength: 'Mobility',
    rest: 'Rest',
    race: 'Race'
  };

  const ZONE_ORDER = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];

  /* ---------------------------------------------------------- helpers */
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const child of [].concat(children || [])) {
      if (child == null || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function icon(discipline, size) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = ICONS[discipline] || ICONS.rest;
    if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
    return svg;
  }

  function fmtDur(min) {
    if (!min) return '—';
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function fmtHours(h) {
    if (h == null) return '—';
    return h.toFixed(1).replace(/\.0$/, '');
  }

  function zoneClass(zone) {
    const z = (zone || '').split('-')[0];
    return z === 'Z3' || z === 'Z4' || z === 'Z5' ? 'zone z3' : 'zone';
  }

  function subtitle(s) {
    const bits = [];
    if (s.intensity) bits.push(s.intensity);
    if (s.distanceKm) bits.push(s.distanceKm + ' km');
    if (s.fueling) bits.push('fuel');
    return bits.join(' · ');
  }

  /* ------------------------------------------------------ session card */
  function sessionCard(s, opts) {
    opts = opts || {};
    const expanded = opts.expandedIds && opts.expandedIds.has(s.id);
    const mode = opts.mode || 'single';

    const card = el('div', {
      class: 'session' + (s.done ? ' s-done' : ''),
      dataset: { id: s.id }
    });

    const disc = el('span', { class: 'disc ' + s.discipline, 'aria-hidden': 'true' }, [icon(s.discipline)]);

    const line1 = el('div', { class: 's-line1' }, [
      el('span', { class: 's-title', text: s.title || LABELS[s.discipline] || s.discipline }),
      el('span', { class: 's-dur', text: fmtDur(s.duration) }),
      s.intensity ? el('span', { class: zoneClass(s.intensity), text: s.intensity }) : null
    ]);

    const preview = [s.sets, s.notes].filter(Boolean).join(' — ');
    const line2 = el('div', { class: 's-line2', text: preview || subtitle(s) || '' });

    const main = el('button', {
      class: 'session-main',
      type: 'button',
      'aria-expanded': expanded ? 'true' : 'false',
      onclick: () => opts.onToggleExpand && opts.onToggleExpand(s)
    }, [disc, el('div', { class: 's-body' }, [line1, line2])]);

    const checks = el('div', { class: 'checks' });

    if (mode === 'both') {
      checks.append(
        athleteCheck('Er', 'eric', s.ericDone, () => opts.onCheck && opts.onCheck(s, 'eric')),
        athleteCheck('El', 'ella', s.ellaDone, () => opts.onCheck && opts.onCheck(s, 'ella'))
      );
    } else {
      checks.append(el('button', {
        class: 'check',
        type: 'button',
        role: 'checkbox',
        'aria-checked': s.done ? 'true' : 'false',
        'aria-label': s.done ? 'Mark not done' : 'Mark done',
        onclick: (e) => { e.stopPropagation(); opts.onCheck && opts.onCheck(s); }
      }, [icon('race', 14).cloneNode(true)]));
      // swap the tick glyph in
      checks.lastChild.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>';
    }

    card.append(el('div', { class: 'session-row' }, [main, checks]));

    if (expanded) card.append(detailBlock(s, opts));

    return card;
  }

  function athleteCheck(label, athlete, done, onToggle) {
    return el('button', {
      class: 'check tiny ' + athlete,
      type: 'button',
      role: 'checkbox',
      'aria-checked': done ? 'true' : 'false',
      'aria-label': athlete + (done ? ' done' : ' not done'),
      onclick: (e) => { e.stopPropagation(); onToggle(); }
    }, [label]);
  }

  function detailBlock(s, opts) {
    const wrap = el('div', { class: 's-detail' });

    if (s.sets) wrap.append(el('div', { class: 'sets', text: s.sets }));
    if (s.notes) wrap.append(el('p', { text: s.notes, style: 'margin-top:8px' }));
    if (s.fueling) {
      wrap.append(el('div', { class: 'fuel' }, ['⚡', s.fueling]));
    }
    if (s.log && s.log.note) {
      wrap.append(el('p', { class: 'note-line', text: 'Your note: ' + s.log.note }));
    }
    if (s.overridden) {
      wrap.append(el('p', {
        class: 'note-line',
        text: 'Edited from the original plan.'
      }));
    }

    const actions = el('div', { class: 's-actions' }, [
      el('button', {
        class: 'mini', type: 'button',
        onclick: (e) => { e.stopPropagation(); opts.onOpen && opts.onOpen(s); }
      }, ['Details']),
      el('button', {
        class: 'mini', type: 'button',
        onclick: (e) => { e.stopPropagation(); opts.onMove && opts.onMove(s); }
      }, ['Move']),
      el('button', {
        class: 'mini', type: 'button',
        onclick: (e) => { e.stopPropagation(); opts.onEdit && opts.onEdit(s); }
      }, ['Edit'])
    ]);

    wrap.append(actions);
    return wrap;
  }

  /* ------------------------------------------------------------ day */
  function dayBlock(iso, athlete, opts) {
    const today = Plan.todayISO();
    const sessions = athlete === 'both'
      ? Plan.togetherOn(iso)
      : Plan.sessionsOn(iso, athlete);

    const total = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
    const allRest = sessions.length === 0 ||
      sessions.every(s => s.discipline === 'rest');

    const block = el('section', {
      class: 'day' +
        (iso === today ? ' is-today' : '') +
        (allRest ? ' is-rest' : ''),
      dataset: { date: iso }
    });

    const head = el('div', { class: 'day-head' }, [
      el('span', { class: 'day-name', text: Plan.dayName(iso) }),
      el('span', { class: 'day-date', text: Plan.prettyDate(iso) }),
      iso === today ? el('span', { class: 'day-today-pill', text: 'Today' }) : null,
      el('span', { class: 'day-total', text: total ? fmtDur(total) : '—' }),
      opts.onAdd ? el('button', {
        class: 'day-add', type: 'button', 'aria-label': 'Add a session',
        onclick: (e) => { e.stopPropagation(); opts.onAdd(iso); }
      }, ['+']) : null
    ]);
    block.append(head);

    const list = el('div', { class: 'sessions' });

    if (!sessions.length) {
      const e = Plan.sessionsOn(iso, 'eric').filter(x => x.discipline !== 'rest');
      const l = Plan.sessionsOn(iso, 'ella').filter(x => x.discipline !== 'rest');

      if (athlete === 'both' && (e.length || l.length)) {
        const line = (who, items) => el('div', { class: 'split-line' }, [
          el('span', { class: 'split-who ' + who, text: who === 'eric' ? 'Eric' : 'Ella' }),
          el('span', {
            text: items.length
              ? items.map(x => `${LABELS[x.discipline]} ${fmtDur(x.duration)}`).join(' · ')
              : 'rest'
          })
        ]);
        list.append(el('div', { class: 'split-note' }, [
          el('div', { class: 'split-head', text: 'Not together today' }),
          line('eric', e),
          line('ella', l)
        ]));
      } else {
        list.append(el('div', {
          class: 'empty', style: 'padding:18px 14px;font-size:.82rem',
          text: 'Nothing planned.'
        }));
      }
    } else {
      for (const s of sessions) {
        list.append(sessionCard(s, Object.assign({ mode: athlete === 'both' ? 'both' : 'single' }, opts)));
      }
    }

    block.append(list);

    return block;
  }

  /* ---------------------------------------------------------- banner */
  function banner(athlete, weekNumber) {
    const today = Plan.todayISO();
    const week = Plan.weekFor(weekNumber || Plan.weekNumberFor(today));
    const phase = Plan.phaseMeta(week.phase);
    const days = Plan.raceCountdown();
    const hrs = Plan.weekHours(week.weekNumber, athlete === 'both' ? 'eric' : athlete);

    const chips = [];
    if (days > 0) {
      chips.push(el('span', { class: 'chip strong', text: days + ' days to Utah' }));
    } else if (days === 0) {
      chips.push(el('span', { class: 'chip strong', text: 'Race day' }));
    } else {
      chips.push(el('span', { class: 'chip strong', text: 'Race complete' }));
    }
    if (week.recoveryWeek) chips.push(el('span', { class: 'chip', text: 'Recovery week' }));
    chips.push(el('span', {
      class: 'chip',
      text: `${fmtHours(hrs.doneHours)} / ${fmtHours(hrs.target)} h this week`
    }));

    return el('div', { class: 'hero' }, [
      el('p', {
        class: 'hero-eyebrow',
        text: `Week ${week.weekNumber} of ${Plan.data.weeks.length} · ` +
              `${Plan.prettyDate(week.startDate)} – ${Plan.prettyDate(week.endDate)}`
      }),
      el('h1', {
        class: 'hero-title',
        text: phase.nameLabel || week.phaseName || week.phase
      }),
      el('p', { class: 'hero-focus', text: week.focus || '' }),
      el('div', { class: 'hero-chips' }, chips)
    ]);
  }

  /* ------------------------------------------------------ month grid */
  function monthGrid(year, month, athlete, onPick) {
    const grid = document.createDocumentFragment();
    const first = new Date(year, month, 1);
    const startShift = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < startShift; i++) {
      grid.append(el('div', { class: 'mcell blank' }));
    }

    const today = Plan.todayISO();

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = Plan.isoOf(year, month, d);
      const sessions = athlete === 'both'
        ? Plan.togetherOn(iso)
        : Plan.sessionsOn(iso, athlete);
      const real = sessions.filter(s => s.discipline !== 'rest');
      const minutes = real.reduce((sum, s) => sum + (s.duration || 0), 0);
      const isRace = real.some(s => s.race);
      const allDone = real.length > 0 && real.every(s =>
        athlete === 'both' ? (s.ericDone && s.ellaDone) : s.done);

      const dots = el('div', { class: 'mdots' });
      const seen = new Set();
      for (const s of real) {
        if (seen.has(s.discipline)) continue;
        seen.add(s.discipline);
        dots.append(el('span', { class: 'mdot ' + s.discipline }));
      }

      grid.append(el('button', {
        class: 'mcell' +
          (iso === today ? ' today' : '') +
          (isRace ? ' race' : '') +
          (allDone ? ' all-done' : ''),
        type: 'button',
        dataset: { date: iso },
        onclick: () => onPick(iso),
        'aria-label': `${Plan.prettyDate(iso, true)}, ${minutes} minutes`
      }, [
        el('span', { class: 'mnum', text: String(d) }),
        dots,
        minutes ? el('span', { class: 'mhours', text: (minutes / 60).toFixed(1) }) : null
      ]));
    }

    return grid;
  }

  function legend() {
    const items = ['swim', 'bike', 'run', 'brick', 'strength', 'race'];
    return items.map(d => el('span', null, [
      el('span', { class: 'mdot ' + d }),
      LABELS[d]
    ]));
  }

  /* ----------------------------------------------------------- chart */
  function chart(athlete) {
    const weeks = Plan.data.weeks;
    const BAR_W = 10;
    const GAP = 5;
    const GROUP = BAR_W + GAP;
    const H = 132;
    const TOP = 10;
    const LEFT = 26;
    const maxH = 12.5;
    const width = LEFT + weeks.length * GROUP + 10;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', width);
    svg.setAttribute('height', H + 22);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Weekly hours: planned bar with completed portion filled in');

    const ns = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs) => {
      const n = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      return n;
    };

    for (const h of [0, 4, 8, 12]) {
      const y = TOP + (H - TOP) * (1 - h / maxH);
      svg.append(mk('line', {
        x1: LEFT - 4, x2: width - 6, y1: y, y2: y,
        stroke: 'currentColor', 'stroke-width': 1, opacity: h === 0 ? .3 : .1
      }));
      const label = mk('text', {
        x: LEFT - 8, y: y + 3.5, 'text-anchor': 'end',
        'font-size': 9, fill: 'currentColor', opacity: .45
      });
      label.textContent = h;
      svg.append(label);
    }

    const currentWeek = Plan.weekOf(Plan.todayISO()).weekNumber;

    weeks.forEach((w, i) => {
      const hrs = Plan.weekHours(w.weekNumber, athlete === 'both' ? 'eric' : athlete);
      const x = LEFT + i * GROUP;

      const plannedH = Math.max(2, (Math.min(hrs.plannedHours, maxH) / maxH) * (H - TOP));
      const doneH = Math.max(0, (Math.min(hrs.doneHours, maxH) / maxH) * (H - TOP));

      const isNow = w.weekNumber === currentWeek;
      const isRace = w.weekNumber === weeks.length;
      const baseY = TOP + (H - TOP) - plannedH;

      if (isNow) {
        svg.append(mk('rect', {
          x: x - 3.5, y: TOP - 5, width: BAR_W + 7, height: H - TOP + 9,
          rx: 5, fill: 'none', stroke: 'currentColor',
          'stroke-width': 1, opacity: .3
        }));
      }

      // track = what the plan asked for
      svg.append(mk('rect', {
        x, y: baseY, width: BAR_W, height: plannedH, rx: 3,
        fill: isRace ? 'var(--race)' : 'currentColor',
        opacity: isRace ? .3 : (isNow ? .34 : .18)
      }));

      // fill = what actually happened, growing up from the bottom
      if (doneH > 0) {
        svg.append(mk('rect', {
          x, y: TOP + (H - TOP) - doneH, width: BAR_W, height: doneH, rx: 3,
          fill: isRace ? 'var(--race)' : 'currentColor',
          opacity: isNow ? .95 : .6
        }));
      }

      if (w.recoveryWeek) {
        svg.append(mk('circle', {
          cx: x + BAR_W / 2, cy: H + 8, r: 1.7,
          fill: 'currentColor', opacity: .3
        }));
      }

      if ((i + 1) % 4 === 1 || isNow) {
        const t = mk('text', {
          x: x + BAR_W / 2, y: H + 20, 'text-anchor': 'middle',
          'font-size': 9, fill: 'currentColor',
          opacity: isNow ? .95 : .4,
          'font-weight': isNow ? 700 : 400
        });
        t.textContent = w.weekNumber;
        svg.append(t);
      }
    });

    svg.style.color = 'var(--text-mid)';
    svg.dataset.currentWeek = String(currentWeek);
    return svg;
  }

  function stats(athlete) {
    const a = athlete === 'both' ? 'eric' : athlete;
    const today = Plan.todayISO();
    const week = Plan.weekOf(today);
    const hrs = Plan.weekHours(week.weekNumber, a);
    const days = Plan.raceCountdown();
    const planned = Plan.weeksAsPlanned(a);

    return [
      stat('Days to race', days > 0 ? String(days) : '—', days > 0 ? 'days' : ''),
      stat('This week', `${hrs.complete}<small>/${hrs.total}</small>`, 'sessions'),
      stat('Hours this week', fmtHours(hrs.doneHours), `of ${fmtHours(hrs.target)}`),
      stat('Weeks as planned',
        planned.elapsed ? `${planned.done}<small>/${planned.elapsed}</small>` : '—',
        planned.elapsed ? '80%+ done' : 'none yet')
    ];
  }

  function stat(k, v, sub) {
    return el('div', { class: 'stat' }, [
      el('div', { class: 'k', text: k }),
      el('div', { class: 'v', html: v + (sub ? ` <small>${sub}</small>` : '') })
    ]);
  }

  function phaseList() {
    const currentWeek = Plan.weekOf(Plan.todayISO()).weekNumber;
    const list = el('ol', { class: 'phaselist' });

    for (const p of Plan.data.phases) {
      const isNow = currentWeek >= p.firstWeek && currentWeek <= p.lastWeek;
      const span = p.firstWeek === p.lastWeek
        ? `W${p.firstWeek}`
        : `W${p.firstWeek}–${p.lastWeek}`;
      list.append(el('li', { class: 'phaseitem' + (isNow ? ' now' : '') }, [
        el('span', { class: 'pw', text: span }),
        el('span', { class: 'pn', text: p.nameLabel }),
        el('span', { class: 'pd', text: Plan.prettyDate(p.endDate) })
      ]));
    }
    return list;
  }

  /* ------------------------------------------------------- day sheet */
  function daySheetBody(iso, athlete, handlers) {
    const frag = document.createDocumentFragment();
    const sessions = athlete === 'both'
      ? Plan.togetherOn(iso)
      : Plan.sessionsOn(iso, athlete);

    frag.append(el('div', { class: 'sh-head' }, [
      el('p', { class: 'sh-eyebrow', text: Plan.dayName(iso) + ' · ' + Plan.prettyDate(iso, true) }),
      el('h2', { class: 'sh-title', id: 'sheetTitle', text: 'Sessions' })
    ]));

    if (!sessions.length) {
      frag.append(el('div', { class: 'empty' }, [
        el('h3', { text: 'Nothing planned' }),
        el('p', { text: 'A real rest day. Or add something below.' })
      ]));
    } else {
      const list = el('div', { class: 'sessions', style: 'border:1px solid var(--line);border-radius:14px;overflow:hidden' });
      for (const s of sessions) {
        list.append(sessionCard(s, {
          mode: athlete === 'both' ? 'both' : 'single',
          expandedIds: new Set([s.id]),
          onCheck: handlers.onCheck,
          onOpen: handlers.onOpen,
          onMove: handlers.onMove,
          onEdit: handlers.onEdit
        }));
      }
      frag.append(list);
    }

    frag.append(el('div', { class: 'btnrow' }, [
      el('button', {
        class: 'btn primary block', type: 'button',
        onclick: () => handlers.onAdd(iso)
      }, ['+ Add a session'])
    ]));

    return frag;
  }

  /* ------------------------------------------------- session detail */
  function sessionSheetBody(s, athlete, handlers) {
    const frag = document.createDocumentFragment();

    const chips = [
      el('span', { class: 'pill accent', text: fmtDur(s.duration) }),
      s.intensity ? el('span', { class: 'pill', text: s.intensity }) : null,
      s.distanceKm ? el('span', { class: 'pill', text: s.distanceKm + ' km' }) : null,
      s.race ? el('span', { class: 'pill', text: 'Race' }) : null
    ];

    frag.append(el('div', { class: 'sh-head' }, [
      el('p', { class: 'sh-eyebrow', text: Plan.prettyDate(s.date, true) + ' · Week ' + s.weekNumber }),
      el('h2', { class: 'sh-title', id: 'sheetTitle', text: s.title || LABELS[s.discipline] || s.discipline }),
      el('div', { class: 'sh-chips' }, chips)
    ]));

    if (s.sets) {
      frag.append(el('div', { class: 'sh-section' }, [
        el('div', { class: 'sh-label', text: 'Session' }),
        el('pre', { class: 'sh-mono', text: s.sets })
      ]));
    }

    if (s.notes) {
      frag.append(el('div', { class: 'sh-section' }, [
        el('div', { class: 'sh-label', text: 'Notes' }),
        el('p', { class: 'sh-text', text: s.notes })
      ]));
    }

    if (s.fueling) {
      frag.append(el('div', { class: 'sh-section' }, [
        el('div', { class: 'sh-label', text: 'Fueling' }),
        el('p', { class: 'sh-text', text: s.fueling })
      ]));
    }

    const zoneKey = (s.intensity || '').split('-')[0];
    const zone = Plan.data.zones[zoneKey];
    if (zone) {
      frag.append(el('div', { class: 'sh-section' }, [
        el('div', { class: 'sh-label', text: `What ${zoneKey} means` }),
        el('p', { class: 'sh-text', text: `${zone.name} (RPE ${zone.rpe}). ${zone.desc}` })
      ]));
    }

    if (s.log) {
      frag.append(el('div', { class: 'sh-section' }, [
        el('div', { class: 'sh-label', text: 'Your log' }),
        el('p', {
          class: 'sh-text',
          text: (s.log.actualMin ? `Actual: ${fmtDur(s.log.actualMin)}. ` : '') +
                (s.log.rpe ? `RPE ${s.log.rpe}. ` : '') +
                (s.log.note || '')
        })
      ]));
    }

    const buttons = [];
    if (athlete !== 'both') {
      buttons.push(el('button', {
        class: 'btn ' + (s.done ? 'ghost' : 'primary'), type: 'button',
        onclick: () => handlers.onCheck(s)
      }, [s.done ? 'Mark not done' : 'Mark done']));
    }
    buttons.push(
      el('button', { class: 'btn', type: 'button', onclick: () => handlers.onMove(s) }, ['Move']),
      el('button', { class: 'btn', type: 'button', onclick: () => handlers.onEdit(s) }, ['Edit'])
    );

    frag.append(el('div', { class: 'btnrow' }, buttons));

    if (s.overridden) {
      frag.append(el('div', { class: 'btnrow' }, [
        el('button', {
          class: 'btn ghost', type: 'button',
          onclick: () => handlers.onReset(s)
        }, ['Reset to original plan'])
      ]));
    }

    return frag;
  }

  return {
    el, icon, fmtDur, fmtHours, LABELS, ICONS,
    sessionCard, dayBlock, banner, monthGrid, legend, chart, stats,
    phaseList, daySheetBody, sessionSheetBody, detailBlock
  };
})();
