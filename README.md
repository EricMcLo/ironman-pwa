# Ironman 70.3 Utah — Eric & Ella

A 42-week training plan for **Ironman 70.3 Utah, Saturday Aug 21 2027**, with a
mobile-first web app to read it, check things off, and move sessions around.

No time goal. The goal is to **finish comfortably**.

```
Start:  Mon Nov 2 2026
Race:   Sat Aug 21 2027   (42 weeks)
Also:   Sat Apr 24 2027   — Ella runs the SLC Marathon
```

---

## Run it

The app loads `plan.json` with `fetch()`, which browsers block on `file://`.
So serve the folder over HTTP:

```bash
cd ~/Documents/ironman
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

### Put it on your phone

1. Make sure the phone is on the same Wi-Fi as the computer.
2. Find the computer's local IP: `ipconfig getifaddr en0`
3. On the phone, open `http://<that-ip>:8080`
4. Safari → Share → **Add to Home Screen**. Chrome → menu → **Install app**.

It then runs full-screen and works offline (service worker caches everything).

---

## What's in here

| File | What it is |
|---|---|
| `plan.json` | **The plan.** 42 weeks × 7 days × 2 athletes. Source of truth. |
| `index.html` | Page shell. |
| `css/style.css` | All styling. Design tokens live at the top. |
| `js/store.js` | **Persistence.** Everything saved lives here. Swap this for a backend later. |
| `js/plan.js` | Loads `plan.json`, applies your edits, answers "what's on today?". |
| `js/ui.js` | Rendering. Pure functions that return DOM nodes. |
| `js/app.js` | State, view switching, sheets, event handlers. |
| `manifest.json` | PWA metadata (name, icons, colours). |
| `sw.js` | Service worker — offline cache. |
| `tools/build_plan.py` | Generated the original `plan.json`. See warning below. |

### ⚠️ About `tools/build_plan.py`

It generated the first version of `plan.json`. **`plan.json` is now the source
of truth.** If you run the script again it will overwrite any hand edits.

Run it only if you want to regenerate the whole season from scratch:

```bash
python3 tools/build_plan.py
```

It prints a table proving every week's scheduled minutes match its target hours.

---

## How the data model works

Three layers, kept separate on purpose:

```
1. TEMPLATE      plan.json              never changes while you use the app
2. YOUR EDITS    localStorage           moves, edits, added sessions, week scaling
3. COMPLETIONS   localStorage           checkmarks + optional log (time, RPE, note)
```

Layer 2 and 3 are **overrides**, not rewrites. That means:

- "Reset to original plan" always works.
- You can see what the plan originally said.
- Nothing is destroyed by accident.

### `plan.json` shape

```jsonc
{
  "planVersion": "2.0",
  "startDate": "2026-11-02",
  "raceDate": "2027-08-21",
  "athletes": { "eric": {...}, "ella": {...} },
  "zones":    { "Z1": {...}, ... },      // what each zone means
  "events":   [ {...} ],                 // races + milestones
  "phases":   [ {...} ],                 // base → marathon block → 70.3 build → peak → taper
  "weeks": [
    {
      "weekNumber": 1,
      "startDate": "2026-11-02",
      "endDate": "2026-11-08",
      "phase": "base",
      "recoveryWeek": false,
      "targetHours": { "eric": 5.5, "ella": 5.5 },
      "focus": "Six weeks of pure aerobic base…",
      "days": [
        {
          "date": "2026-11-02",
          "dayOfWeek": "monday",
          "sessions": [
            {
              "id": "w01-mon-swim1",          // stable — checkmarks key off this
              "discipline": "swim",           // swim | bike | run | brick | strength | rest | race
              "athletes": ["eric", "ella"],
              "duration": 35,                 // minutes
              "intensity": "Z1",
              "sets": "8x50 drill/swim …",
              "notes": "Technique focus…",
              "together": true,               // do you do it side by side?
              "variants": {
                "eric": { "duration": 35, "sets": "…", "notes": "…" },
                "ella": { "duration": 40, "sets": "…", "notes": "…" }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

A **shared session is one object** with one `id`, plus a `variants` block for
whatever differs per athlete. That keeps "we're doing this together" honest and
means one checkmark row in the app, not two.

### What the app writes to localStorage

```js
{
  version: 1,
  me: "eric",              // whose phone this is (tags edits)
  theme: "auto",           // auto | light | dark
  view: "week",
  log: {
    "w01-mon-swim1|eric": { done: true, at: "2026-11-02T…" }
  },
  overrides: {
    "w01-thu-run1": { date: "2026-11-06" },          // moved for both
    "w01-tue-bike1": { "ella": { duration: 75 } }    // changed for Ella only
  },
  weekScale: { "7": 0.8 },  // week 7 at 80%
  extras: [ { id: "x…", date: "…", discipline: "run", duration: 30, … } ],
  meta: { by: "eric", at: "…" }
}
```

Every record carries an `id` and a timestamp. That is exactly what a sync
backend needs, which is why `js/store.js` is the only file you'd rewrite to add
one.

---

## Moving training days around

This was the big ask, so it's built in three levels:

| You want | Where |
|---|---|
| Shift one session | Session → **Move** → tap a day. Choose *Both / Eric / Ella*. |
| Change one session | Session → **Edit** → duration, zone, sets, notes. |
| Ease off a whole week | Week header → **Adjust week** → 70 / 80 / 90 / 100 / 110%. |
| Add something | **+** in any day header. |

Moving a shared session moves it for both by default, because you're doing it
together. Switch the scope to one person if only one of you is shifting.

---

## Design notes

- **Mobile first.** 390 px is the design width. Bottom tab bar, bottom sheets,
  44 px tap targets.
- **No build step.** No npm, no bundler. Edit a file, refresh.
- **No external requests.** System fonts only, so it loads instantly and works
  offline.
- **Dark mode** follows the system, and can be pinned in Settings.
- **Dates are parsed as local time** (`new Date(y, m-1, d)`), never UTC — that's
  what stops a workout showing up on the wrong day.

---

## Where this goes next

Deliberately not built yet:

1. **Shared sync (Turso).** Right now checkmarks live on one phone. The seam is
   `js/store.js` — replace `load()` / `save()` with HTTP calls and the rest of
   the app doesn't change.
2. **Editing UI for the plan itself.** Right now "editing" means per-session
   overrides. Restructuring the season still means editing `plan.json`.
3. **Notifications.** A 7 am nudge on training days.

The plan is to use this for ~2 weeks first and see what actually annoys you
before adding any of it.
