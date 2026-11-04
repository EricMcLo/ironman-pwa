/* ==========================================================================
   cal.js — export plan events and workouts to .ics (iCalendar).

   Google Calendar, Apple Calendar, and Outlook all import .ics files natively.
   No backend, no OAuth, no server — just download and import.
   ========================================================================== */

const Cal = (() => {

  const DISC_LABEL = {
    swim: 'Swim', 'open-water-swim': 'Open water swim', bike: 'Bike',
    run: 'Run', brick: 'Brick', strength: 'Mobility / lift',
    cross: 'Other', race: 'Race'
  };
  const DISC_EMOJI = {
    swim: '🏊', 'open-water-swim': '🏊', bike: '🚴', run: '🏃',
    brick: '🔁', strength: '🏋️', cross: '🧗', race: '🏁'
  };

  /* Pad a number to 2 digits. */
  function z(n) { return String(n).padStart(2, '0'); }

  /* Convert YYYY-MM-DD to ICS DATE format: YYYYMMDD. */
  function icsDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return `${y}${z(m)}${z(d)}`;
  }

  /* All-day events need an end date that is the next day (exclusive). */
  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return `${dt.getFullYear()}-${z(dt.getMonth() + 1)}-${z(dt.getDate())}`;
  }

  /* Escape ICS text values (commas, semicolons, newlines). */
  function icsText(s) {
    return String(s || '').replace(/[,\n;]/g, c => {
      return { ',': '\\,', '\n': '\\n', ';': '\\;' }[c];
    });
  }

  function fmtMin(min) {
    const n = Math.round(Number(min) || 0);
    if (!n) return '';
    const h = Math.floor(n / 60);
    const m = n % 60;
    return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  }

  function stamp() {
    return `${icsDate(new Date().toISOString().split('T')[0])}T000000Z`;
  }

  /* Build one VEVENT block from a plan event. */
  function eventBlock(ev) {
    const start = icsDate(ev.date);
    const end = icsDate(addDays(ev.date, 1));
    const uid = `ironman-${ev.id || ev.date}-${start}@703utah.app`;
    const desc = icsText(ev.description || ev.notes || '');
    const summary = icsText(ev.name || 'Training event');

    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp()}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    ].join('\n');
  }

  /* Build one VEVENT for a workout session. */
  function sessionBlock(s) {
    if (!s || !s.date) return '';
    const start = icsDate(s.date);
    const end = icsDate(addDays(s.date, 1));
    const uid = `ironman-${s.id}-${start}@703utah.app`;
    const emoji = DISC_EMOJI[s.discipline] || '🏃';
    const label = s.title || DISC_LABEL[s.discipline] || 'Workout';
    const dur = fmtMin(s.duration);
    const summary = icsText(`${emoji} ${label}${dur ? ' — ' + dur : ''}`);

    const bits = [];
    if (dur) bits.push(`Planned: ${dur}`);
    if (s.intensity) bits.push(`Effort: ${s.intensity}`);
    if (s.distanceKm) bits.push(`Distance: ${s.distanceKm} km`);
    if (s.sets) bits.push('', s.sets);
    if (s.notes) bits.push('', s.notes);
    if (s.race) bits.push('', 'Race day.');
    const desc = icsText(bits.join('\n'));

    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp()}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      `CATEGORIES:${DISC_LABEL[s.discipline] || 'Workout'}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    ].join('\n');
  }

  /* Generate full .ics text from blocks. */
  function generate(blocks, calName) {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Eric & Ella//Ironman 70.3 Utah//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsText(calName || '70.3 Utah + CIM Marathon')}`,
      'X-WR-TIMEZONE:America/Denver'
    ];

    for (const block of blocks) {
      if (block) lines.push(block);
    }

    lines.push('END:VCALENDAR');
    return lines.join('\n') + '\n';
  }

  /* Download .ics text as a file. */
  function download(text, filename) {
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return {
    /* Export all plan events (races, phases, milestones) to .ics. */
    exportCalendar(plan) {
      const events = (plan.events || [])
        .filter(e => e.date)
        .sort((a, b) => a.date.localeCompare(b.date));

      if (!events.length) throw new Error('No dated events to export');
      download(generate(events.map(eventBlock)), 'ironman-race-calendar.ics');
    },

    /* Export a list of resolved sessions (from Plan.sessionsForWeek or the
       whole plan) to .ics. Great for bulk-adding a week to Google Calendar. */
    exportSessions(sessions, filename, calName) {
      const blocks = (sessions || [])
        .filter(s => s && s.date && s.discipline !== 'rest')
        .sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)))
        .map(sessionBlock);

      if (!blocks.length) throw new Error('No workouts to export');
      download(generate(blocks, calName), filename || 'ironman-workouts.ics');
    }
  };

})();
