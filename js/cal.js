/* ==========================================================================
   cal.js — export plan events to .ics (iCalendar) for Google Calendar.

   Google Calendar, Apple Calendar, and Outlook all import .ics files natively.
   No backend, no OAuth, no server — just download and import.

   Run:  UI.exportCalendar()  (wired to a Settings button)
   ========================================================================== */

const Cal = (() => {

  /* Pad a number to 2 digits. */
  function z(n) { return String(n).padStart(2, '0'); }

  /* Convert YYYY-MM-DD to ICS DATE format: YYYYMMDD. */
  function icsDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return `${y}${z(m)}${z(d)}`;
  }

  /* Escape ICS text values (commas, semicolons, newlines). */
  function icsText(s) {
    return String(s || '').replace(/[,\n;]/g, c => {
      return { ',': '\\,', '\n': '\\n', ';': '\\;' }[c];
    });
  }

  /* Build one VEVENT block from a plan event. */
  function eventBlock(ev) {
    const start = icsDate(ev.date);
    const end = icsDate(ev.date); // all-day event
    const uid = `ironman-${ev.id || ev.date}-${start}@703utah.app`;
    const stamp = `${icsDate(new Date().toISOString().split('T')[0])}T000000Z`;
    const desc = icsText(ev.description || ev.notes || '');
    const summary = icsText(ev.name || 'Training event');

    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      'END:VEVENT'
    ].join('\n');
  }

  /* Generate full .ics text from plan events. */
  function generate(events) {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Eric & Ella//Ironman 70.3 Utah//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:70.3 Utah + CIM Marathon',
      'X-WR-TIMEZONE:America/Denver'
    ];

    for (const ev of events) {
      lines.push(eventBlock(ev));
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
    /* Export all plan events to .ics and trigger download. */
    exportCalendar(plan) {
      const events = (plan.events || [])
        .filter(e => e.date) // only dated events
        .sort((a, b) => a.date.localeCompare(b.date));

      if (!events.length) {
        throw new Error('No dated events to export');
      }

      const text = generate(events);
      download(text, 'ironman-training-calendar.ics');
    }
  };

})();
