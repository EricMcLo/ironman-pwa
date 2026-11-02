#!/usr/bin/env python3
"""
Generates plan.json -- the season training plan for Eric & Ella.

  Run:  python3 tools/build_plan.py

IMPORTANT: after you start hand-editing plan.json, do NOT run this again --
it overwrites the file. It exists to build the initial template (and to
regenerate it if you ever want to start over).

Weekly shape:
  Mon  swim            (technique for Eric / aerobic for Ella)
  Tue  bike            (+ 20 min mobility)
  Wed  swim or OW swim
  Thu  run             (+ 20 min mobility)
  Fri  brick (build/peak) or rest
  Sat  long run with run club  <- anchor
  Sun  long bike              <- anchor

The long run and long bike are explicit per-week anchors (the coaching meat).
Everything else is water-filled from the remaining weekly minutes, per athlete,
so each athlete's scheduled total matches their targetHours.

Sessions are shared objects (one id, one card in the app). Per-athlete
differences live in `variants`, so editing one session updates both people.
"""

import json
from datetime import date, timedelta

START = date(2026, 11, 2)
RACE = date(2027, 8, 21)
MARATHON = date(2027, 4, 24)
WEEKS = 42

PHASE_SPANS = [
    ("base", 1, 6),
    ("marathon_block", 7, 22),
    ("marathon_taper_race_recovery", 23, 26),
    ("70.3_build", 27, 36),
    ("peak", 37, 39),
    ("taper_2wk", 40, 41),
    ("race_week", 42, 42),
]

PHASE_META = {
    "base": ("Easy aerobic only",
             "Six weeks of pure aerobic base and swim technique. No intensity. "
             "The goal is rhythm, not fitness."),
    "marathon_block": ("Ella run-led / Eric swim-bike",
                       "Ella builds toward the SLC Marathon. Eric holds run "
                       "maintenance and builds swim and bike volume."),
    "marathon_taper_race_recovery": ("Marathon taper, race, recover",
                                     "Ella tapers into the marathon, races, then "
                                     "recovers. Eric stays easy."),
    "70.3_build": ("70.3 specific",
                   "Triathlon focus returns. Bricks, open water, and one or two "
                   "controlled threshold sessions per week."),
    "peak": ("Peak volume",
             "Highest weeks of the season. Durability and fueling rehearsal matter "
             "more than another hard session."),
    "taper_2wk": ("Taper", "Cut volume, keep a little sharpness. Arrive healthy."),
    "race_week": ("Race week", "Short, easy, confident. Nothing to gain this week."),
}


def recovery_weeks():
    """3 weeks up / 1 week down, reset at every phase boundary."""
    out = set()
    for name, first, last in PHASE_SPANS:
        if name in ("marathon_taper_race_recovery", "taper_2wk", "race_week"):
            continue
        i = 0
        for wk in range(first, last + 1):
            i += 1
            if i % 4 == 0:
                out.add(wk)
    return out


RECOVERY = recovery_weeks()

# training hours only -- race day is NOT counted
HOURS = {
    1: (5.5, 5.5), 2: (6.0, 6.0), 3: (6.5, 6.5), 4: (4.5, 4.5),
    5: (7.0, 7.0), 6: (7.5, 7.5),
    7: (5.5, 7.0), 8: (6.0, 7.5), 9: (6.5, 8.0), 10: (5.0, 6.5),
    11: (6.5, 8.5), 12: (7.0, 9.0), 13: (7.5, 9.5), 14: (6.0, 7.5),
    15: (7.5, 9.5), 16: (8.0, 10.0), 17: (8.5, 10.5), 18: (7.0, 8.5),
    19: (8.5, 10.5), 20: (9.0, 11.0), 21: (9.5, 11.0), 22: (7.5, 9.0),
    23: (6.0, 7.0), 24: (5.0, 5.0), 25: (3.5, 3.0), 26: (4.5, 4.0),
    27: (8.0, 8.0), 28: (9.0, 9.0), 29: (9.5, 9.5), 30: (7.0, 7.0),
    31: (10.0, 10.0), 32: (10.5, 10.5), 33: (11.0, 11.0), 34: (8.0, 8.0),
    35: (11.0, 11.0), 36: (11.5, 11.5),
    37: (12.0, 12.0), 38: (12.0, 12.0), 39: (10.5, 10.5),
    40: (8.0, 8.0), 41: (5.0, 5.0), 42: (2.5, 2.5),
}

LONG_RUN_ERIC = {
    1: 60, 2: 65, 3: 70, 4: 55, 5: 75, 6: 80,
    7: 60, 8: 65, 9: 70, 10: 55, 11: 70, 12: 75, 13: 75, 14: 60,
    15: 75, 16: 80, 17: 80, 18: 65, 19: 85, 20: 80, 21: 70, 22: 60,
    23: 60, 24: 45, 25: 45, 26: 40,
    27: 70, 28: 80, 29: 85, 30: 65, 31: 90, 32: 95, 33: 100, 34: 80,
    35: 105, 36: 110, 37: 115, 38: 120, 39: 100, 40: 75, 41: 55,
}
LONG_RUN_ELLA = {
    1: 60, 2: 65, 3: 70, 4: 55, 5: 75, 6: 80,
    7: 75, 8: 85, 9: 95, 10: 70, 11: 105, 12: 115, 13: 125, 14: 90,
    15: 135, 16: 145, 17: 155, 18: 110, 19: 165, 20: 150, 21: 120, 22: 90,
    23: 75, 24: 45, 25: 45, 26: 30,
    27: 70, 28: 80, 29: 85, 30: 65, 31: 90, 32: 95, 33: 100, 34: 80,
    35: 105, 36: 110, 37: 115, 38: 120, 39: 100, 40: 75, 41: 55,
}
LONG_BIKE_ERIC = {
    1: 90, 2: 95, 3: 100, 4: 75, 5: 105, 6: 110,
    7: 110, 8: 120, 9: 125, 10: 95, 11: 130, 12: 135, 13: 140, 14: 110,
    15: 145, 16: 150, 17: 155, 18: 120, 19: 160, 20: 165, 21: 170, 22: 120,
    23: 100, 24: 80, 25: 75, 26: 70,
    27: 150, 28: 160, 29: 170, 30: 120, 31: 180, 32: 185, 33: 190, 34: 135,
    35: 195, 36: 200, 37: 210, 38: 210, 39: 180, 40: 120, 41: 90,
}
LONG_BIKE_ELLA = {
    1: 90, 2: 95, 3: 100, 4: 75, 5: 105, 6: 110,
    7: 95, 8: 100, 9: 105, 10: 80, 11: 110, 12: 115, 13: 120, 14: 95,
    15: 125, 16: 130, 17: 135, 18: 105, 19: 140, 20: 145, 21: 150, 22: 105,
    23: 90, 24: 70, 25: 45, 26: 60,
    27: 150, 28: 160, 29: 170, 30: 120, 31: 180, 32: 185, 33: 190, 34: 135,
    35: 195, 36: 200, 37: 210, 38: 210, 39: 180, 40: 120, 41: 90,
}

DOW = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
DOW3 = {"monday": "mon", "tuesday": "tue", "wednesday": "wed",
        "thursday": "thu", "friday": "fri", "saturday": "sat", "sunday": "sun"}


def phase_for(week):
    for name, first, last in PHASE_SPANS:
        if first <= week <= last:
            return name
    return "race_week"


def r5(x):
    return max(15, int(round(x / 5.0)) * 5)


def km(minutes):
    return round(minutes / 6.5, 1)


def allocate(budget, specs):
    """Water-fill `budget` minutes across [(name, min, max, weight)]."""
    alloc = {n: float(mn) for n, mn, mx, w in specs}
    if budget <= sum(alloc.values()):
        total_min = sum(alloc.values()) or 1
        f = budget / total_min
        return {n: max(0.0, v * f) for n, v in alloc.items()}

    remaining = budget - sum(alloc.values())
    active = list(specs)
    guard = 0
    while remaining > 0.01 and active and guard < 60:
        guard += 1
        wsum = sum(w for _, _, _, w in active) or 1
        for n, mn, mx, w in list(active):
            give = min(remaining * (w / wsum), max(0.0, mx - alloc[n]))
            alloc[n] += give
            if alloc[n] >= mx - 0.01:
                active.remove((n, mn, mx, w))
        remaining = budget - sum(alloc.values())
    return alloc


SWIM_ERIC = {
    "base": "8x50 drill/swim (catch-up, fingertip drag) + 200 easy + 100 cool-down",
    "build": "10x50 drill/swim (mix) + 300 easy + 4x50 build + 100 cool-down",
    "peak": "12x50 drill/swim (mix) + 300 easy + 6x50 strong + 100 cool-down",
    "taper": "6x50 build + 200 easy + 100 cool-down",
}
SWIM_ELLA = {
    "base": "4x100 aerobic w/ paddles + 200 easy + 4x50 drill + 100 cool-down",
    "build": "6x100 aerobic + 4x50 drill + 300 easy + 100 cool-down",
    "peak": "8x100 aerobic + 6x200 threshold (30s rest) + 200 easy",
    "taper": "4x100 aerobic + 4x50 build + 200 easy",
}

SPEC = [("swim1", 30, 60, 0.30), ("swim2", 30, 60, 0.30),
        ("bike", 40, 110, 0.25), ("run", 30, 70, 0.15)]

# Ella is run-led through the marathon block, so her midweek bike is capped
# and the freed minutes go to running.
SPEC_MARATHON_ELLA = [("swim1", 30, 60, 0.30), ("swim2", 30, 60, 0.30),
                      ("bike", 40, 90, 0.15), ("run", 30, 120, 0.25)]


def session(sid, discipline, athletes, dur_e, dur_l, intensity, sets_e, sets_l,
            notes_e, notes_l, together=False, dist_e=None, dist_l=None,
            fueling=None, race_e=False, race_l=False):
    """One shared session object with per-athlete variants."""
    s = {
        "id": sid,
        "discipline": discipline,
        "athletes": athletes,
        "duration": max(dur_e, dur_l),
        "intensity": intensity,
        "sets": sets_e,
        "notes": notes_e,
        "together": together,
        "variants": {
            "eric": {"duration": dur_e, "sets": sets_e, "notes": notes_e},
            "ella": {"duration": dur_l, "sets": sets_l, "notes": notes_l},
        },
    }
    if dist_e is not None:
        s["variants"]["eric"]["distanceKm"] = dist_e
    if dist_l is not None:
        s["variants"]["ella"]["distanceKm"] = dist_l
    if dist_e is not None:
        s["distanceKm"] = dist_e
    if fueling:
        s["fueling"] = fueling
    if race_e:
        s["variants"]["eric"]["race"] = True
        s["race"] = True
    if race_l:
        s["variants"]["ella"]["race"] = True
        s["race"] = True
    return s


def rest_session(sid, note="Optional walk or mobility."):
    return {
        "id": sid, "discipline": "rest", "athletes": ["eric", "ella"],
        "duration": 0, "intensity": "RPE1", "sets": "Rest",
        "notes": note, "together": True,
        "variants": {
            "eric": {"duration": 0, "sets": "Rest", "notes": note},
            "ella": {"duration": 0, "sets": "Rest", "notes": note},
        },
    }


def dur_of(s, athlete):
    return (s.get("variants") or {}).get(athlete, {}).get("duration", s["duration"])


def is_race_for(s, athlete):
    return (s.get("variants") or {}).get(athlete, {}).get(
        "race", s.get("race", False))


def planned_minutes(week, athlete):
    t = 0
    for day in week["days"]:
        for s in day["sessions"]:
            if athlete not in s["athletes"] or is_race_for(s, athlete):
                continue
            t += dur_of(s, athlete)
    return t


def build_week(week):
    phase = phase_for(week)
    recovery = week in RECOVERY
    hours_e, hours_l = HOURS[week]
    build = phase in ("70.3_build", "peak")
    quality = build and not recovery
    marathon_block = phase == "marathon_block"
    week_start = START + timedelta(days=(week - 1) * 7)

    saturday = week_start + timedelta(days=5)
    is_race_sat = saturday == RACE
    is_marathon_sat = saturday == MARATHON

    lr_e = 0 if (is_race_sat or is_marathon_sat) else LONG_RUN_ERIC[week]
    lr_l = 0 if (is_race_sat or is_marathon_sat) else LONG_RUN_ELLA[week]

    if week == 42:
        lb_e = lb_l = 45
    else:
        lb_e, lb_l = LONG_BIKE_ERIC[week], LONG_BIKE_ELLA[week]

    # the Sunday after a race is a rest day, so no long ride is scheduled
    sunday = week_start + timedelta(days=6)
    if sunday in (RACE + timedelta(days=1), MARATHON + timedelta(days=1)):
        lb_e = lb_l = 0

    # one mobility slot in recovery weeks, none in race week
    strength = 0 if week == 42 else (20 if (recovery or week == 26) else 40)

    brick_on = (build and not recovery and 29 <= week <= 38
                and not is_race_sat)
    brick_min = (90 if phase == "70.3_build" else 115) if brick_on else 0

    # the 45-min support run Eric does on marathon day counts toward his hours
    support_e = 45 if is_marathon_sat else 0

    budget_e = max(120, hours_e * 60 - strength - lr_e - lb_e - brick_min - support_e)
    budget_l = max(120, hours_l * 60 - strength - lr_l - lb_l - brick_min)

    a_e = allocate(budget_e, SPEC)
    a_l = allocate(budget_l, SPEC_MARATHON_ELLA if marathon_block else SPEC)

    swim_e1, swim_e2 = r5(a_e["swim1"]), r5(a_e["swim2"])
    swim_l1, swim_l2 = r5(a_l["swim1"]), r5(a_l["swim2"])
    bike_e, bike_l = r5(a_e["bike"]), r5(a_l["bike"])
    run_e, run_l = r5(a_e["run"]), r5(a_l["run"])

    days = []
    for i, dow in enumerate(DOW):
        d = week_start + timedelta(days=i)
        tag = DOW3[dow]
        sessions = []

        # ---------------- Saturday ----------------
        if dow == "saturday":
            if is_race_sat:
                sessions.append(session(
                    f"w{week:02d}-sat-race", "race", ["eric", "ella"], 390, 390,
                    "RPE6", "Ironman 70.3 Utah", "Ironman 70.3 Utah",
                    "Pace the swim, ride within yourself, walk aid stations if needed.",
                    "Use your swim strength, stay patient on the bike, run your own race.",
                    together=True, race_e=True, race_l=True))
            elif is_marathon_sat:
                sessions.append(session(
                    f"w{week:02d}-sat-race", "race", ["eric", "ella"], 45, 270,
                    "RPE6-7", "Easy 45 min run", "SLC Marathon",
                    "Support crew. Easy run only.",
                    "Even effort. Fuel early, walk aid stations if needed.",
                    together=True, race_e=False, race_l=True))
            else:
                sessions.append(session(
                    f"w{week:02d}-sat-run1", "run", ["eric", "ella"], lr_e, lr_l,
                    "Z1-Z2",
                    "Easy long run with run club -- own pace",
                    "Easy long run with run club -- own pace",
                    "Run maintenance. Easy, no racing the group.",
                    ("Marathon long run. Own pace, fueling practice."
                     if marathon_block else
                     "Easy long run. Own pace, no racing the group."),
                    together=True, dist_e=km(lr_e), dist_l=km(lr_l),
                    fueling="Practice 60 g carbs/hr" if max(lr_e, lr_l) >= 90 else None))

        # ---------------- Sunday ----------------
        elif dow == "sunday":
            if d in (RACE + timedelta(days=1), MARATHON + timedelta(days=1)):
                sessions.append(rest_session(
                    f"w{week:02d}-sun-rest",
                    "Day after racing. Walk, eat, sleep. Nothing else."))
            else:
                sessions.append(session(
                    f"w{week:02d}-sun-bike1", "bike", ["eric", "ella"], lb_e, lb_l,
                    "Z2", "Long endurance ride", "Long endurance ride",
                    "Your strength. Steady aerobic, no hero efforts.",
                    ("Bike maintenance during the marathon block."
                     if marathon_block else "Steady aerobic ride."),
                    together=True,
                    fueling="Practice race fueling" if max(lb_e, lb_l) >= 120 else None))

        # ---------------- Monday / Wednesday swim ----------------
        elif dow in ("monday", "wednesday"):
            bucket = ("base" if week <= 26
                      else "taper" if week >= 40
                      else "peak" if week >= 37
                      else "build")
            de = swim_e1 if dow == "monday" else swim_e2
            dl = swim_l1 if dow == "monday" else swim_l2
            sessions.append(session(
                f"w{week:02d}-{tag}-swim1", "swim", ["eric", "ella"], de, dl,
                "Z1" if bucket == "base" else "Z1-Z2",
                SWIM_ERIC[bucket], SWIM_ELLA[bucket],
                "Technique focus: drills, short sets, building comfort.",
                "Lane leader. Hold form and pace through the set.",
                together=True))

        # ---------------- Tuesday bike + mobility ----------------
        elif dow == "tuesday":
            if recovery:
                bsets = "Easy recovery spin"
                bnote_e = bnote_l = "Recovery week -- gentle."
            elif quality:
                bsets = ("3x12 min at Z3 (RPE 6-7), 5 min easy spin between"
                         " + 10 easy each end")
                bnote_e = bnote_l = "Controlled sub-threshold. Not all-out."
            else:
                bsets = "Steady aerobic spin"
                bnote_e = bnote_l = "Aerobic base."
            sessions.append(session(
                f"w{week:02d}-tue-bike1", "bike", ["eric", "ella"], bike_e, bike_l,
                "Z3" if quality else "Z2", bsets, bsets, bnote_e, bnote_l))
            if strength:
                sessions.append(session(
                    f"w{week:02d}-tue-str1", "strength", ["eric", "ella"], 20, 20,
                    "RPE3", "Mobility + bodyweight", "Mobility + bodyweight",
                    "Reserved slot. No specific program.",
                    "Reserved slot. No specific program."))

        # ---------------- Thursday run + mobility ----------------
        elif dow == "thursday":
            if recovery:
                sets_e = sets_l = "Easy recovery run"
                note_e = note_l = "Recovery week -- truly easy."
            elif marathon_block:
                sets_e, note_e = ("Easy run, conservation mode",
                                  "Holding run volume while swim and bike build.")
                sets_l, note_l = ("Steady aerobic run, relaxed",
                                  "Marathon block: aerobic volume, not speed.")
            elif week >= 40:
                sets_e = sets_l = "Short easy run + 4x20s relaxed strides"
                note_e = note_l = "Keep the legs awake. Nothing hard."
            elif quality:
                q = ("3x8 min at Z3 (RPE 6-7), 2 min easy jog between"
                     if week % 2 == 0 else "20 min continuous Z3 (RPE 6-7)")
                sets_e = sets_l = q + " + 10 easy each end"
                note_e = note_l = "Controlled sub-threshold. Never all-out."
            else:
                sets_e = sets_l = "Easy conversational run"
                note_e = note_l = "Aerobic base."
            sessions.append(session(
                f"w{week:02d}-thu-run1", "run", ["eric", "ella"], run_e, run_l,
                "Z3" if quality else "Z2", sets_e, sets_l, note_e, note_l,
                dist_e=km(run_e), dist_l=km(run_l)))
            if strength:
                sessions.append(session(
                    f"w{week:02d}-thu-str1", "strength", ["eric", "ella"], 20, 20,
                    "RPE3", "Mobility + bodyweight", "Mobility + bodyweight",
                    "Reserved slot. No specific program.",
                    "Reserved slot. No specific program."))

        # ---------------- Friday brick or rest ----------------
        elif dow == "friday":
            if brick_on:
                bmin = 65 if phase == "70.3_build" else 80
                rmin = 25 if phase == "70.3_build" else 35
                sessions.append(session(
                    f"w{week:02d}-fri-brick1", "brick", ["eric", "ella"],
                    bmin + rmin, bmin + rmin, "Z2-Z3",
                    f"Bike {bmin} min Z2 -> run {rmin} min easy off the bike",
                    f"Bike {bmin} min Z2 -> run {rmin} min easy off the bike",
                    "Transition practice. Smooth, not fast.",
                    "Transition practice. Smooth, not fast.",
                    together=True))
            else:
                sessions.append(rest_session(f"w{week:02d}-fri-rest"))

        # ---------------- open water swap (summer, build/peak) ----------------
        if (phase in ("70.3_build", "peak") and not recovery
                and dow == "wednesday" and week >= 31 and d <= RACE):
            sessions = [s for s in sessions if s["discipline"] != "swim"]
            sessions.insert(0, session(
                f"w{week:02d}-wed-ows1", "open-water-swim", ["eric", "ella"],
                45, 55, "Z1-Z2",
                "8x100 with sighting + 200 easy",
                "8x100 with sighting + 4x100 drafting",
                "Sighting and comfort. Stay relaxed when it's choppy.",
                "Drafting practice. Find feet and stay there.",
                together=True))

        days.append({"date": d.isoformat(), "dayOfWeek": dow, "sessions": sessions})

    # ---------- nudge to hit target hours exactly ----------
    def planned(athlete):
        return planned_minutes({"days": days}, athlete)

    def nudge(athlete, target, order=None):
        if order is None:
            order = [("tue-bike1", 35, 130), ("thu-run1", 25, 90),
                     ("mon-swim1", 25, 70), ("wed-swim1", 25, 70),
                     ("sun-bike1", 45, 220), ("sat-run1", 40, 180)]
        for _ in range(400):
            diff = target - planned(athlete)
            if abs(diff) < 2.5:
                return
            step = 5 if diff > 0 else -5
            moved = False
            for part, lo, hi in order:
                for day in days:
                    for s in day["sessions"]:
                        if part not in s["id"] or athlete not in s["athletes"]:
                            continue
                        cur = dur_of(s, athlete)
                        nxt = cur + step
                        if nxt < lo or nxt > hi:
                            continue
                        v = s["variants"][athlete]
                        v["duration"] = nxt
                        if "distanceKm" in v:
                            v["distanceKm"] = km(nxt)
                        if s.get("distanceKm") is not None and athlete == "eric":
                            s["distanceKm"] = km(nxt)
                        s["duration"] = max(s["variants"]["eric"]["duration"],
                                            s["variants"]["ella"]["duration"])
                        moved = True
                        break
                    if moved:
                        break
                if moved:
                    break
            if not moved:
                return

    nudge("eric", hours_e * 60)

    # Ella is run-led through the marathon block: give her spare minutes to
    # running before topping up the bike.
    if marathon_block:
        ella_order = [("thu-run1", 25, 120), ("tue-bike1", 35, 90),
                      ("mon-swim1", 25, 70), ("wed-swim1", 25, 70),
                      ("sun-bike1", 45, 200), ("sat-run1", 40, 180)]
    else:
        ella_order = None
    nudge("ella", hours_l * 60, ella_order)

    focus = PHASE_META[phase][1]
    if 37 <= week <= 41:
        focus += (" Heat adaptation: do the long sessions in the warm part of the "
                  "day when you can, and drink to a schedule.")

    return {
        "weekNumber": week,
        "startDate": week_start.isoformat(),
        "endDate": (week_start + timedelta(days=6)).isoformat(),
        "phase": phase,
        "phaseName": PHASE_META[phase][0],
        "recoveryWeek": recovery,
        "focus": focus,
        "targetHours": {"eric": hours_e, "ella": hours_l},
        "days": days,
    }


EVENTS = [
    ("plan_start", "2026-11-02", "Plan starts", ["eric", "ella"],
     "First week. Easy aerobic only."),
    ("phase", "2026-12-14", "Marathon block begins", ["ella"],
     "Ella starts building toward the SLC Marathon. Eric shifts to swim/bike."),
    ("phase", "2027-04-05", "Marathon taper begins", ["ella"],
     "Volume drops. Trust the work already done."),
    ("race", "2027-04-24", "SLC Marathon", ["ella"],
     "Ella's marathon. Eric on support duty."),
    ("phase", "2027-05-03", "70.3 build begins", ["eric", "ella"],
     "Triathlon focus returns for both. Bricks and open water start."),
    ("milestone", "2027-06-01", "Open water season", ["eric", "ella"],
     "Swap one pool swim for open water each week once the water is warm enough."),
    ("phase", "2027-07-12", "Peak begins", ["eric", "ella"],
     "Highest volume of the season."),
    ("milestone", "2027-07-12", "Heat adaptation begins", ["eric", "ella"],
     "Final 6 weeks: train in the warm part of the day when you can, hydrate deliberately."),
    ("phase", "2027-08-02", "Taper begins", ["eric", "ella"],
     "Two weeks of cutting back. Nothing to gain now."),
    ("race", "2027-08-21", "Ironman 70.3 Utah", ["eric", "ella"],
     "Finish comfortably."),
]

ZONES = {
    "Z1": {"name": "Recovery", "rpe": "1-2",
           "desc": "Very easy. Could chat in full sentences. Active recovery."},
    "Z2": {"name": "Aerobic", "rpe": "3-4",
           "desc": "Comfortable and sustainable for hours. Mostly nose-breathing."},
    "Z3": {"name": "Sub-threshold", "rpe": "6-7",
           "desc": "Comfortably hard. Short sentences only. Controlled -- never all-out."},
    "Z4": {"name": "Threshold", "rpe": "8",
           "desc": "Hard. Used sparingly, if at all."},
    "Z5": {"name": "VO2", "rpe": "9-10", "desc": "Not used in this plan."},
}


def main():
    weeks = [build_week(w) for w in range(1, WEEKS + 1)]

    plan = {
        "planVersion": "2.0",
        "startDate": START.isoformat(),
        "raceDate": RACE.isoformat(),
        "raceName": "Ironman 70.3 Utah",
        "goal": "Finish comfortably — no time goal",
        "athletes": {
            "eric": {"name": "Eric", "color": "#4f7d99",
                     "notes": "Strong cyclist, weak swimmer, rebuilding conservatively. "
                              "Run about equal to Ella."},
            "ella": {"name": "Ella", "color": "#a8637a",
                     "notes": "Strong swimmer, runs about equal to Eric. "
                              "Also racing the SLC Marathon on 2027-04-24."},
        },
        "zones": ZONES,
        "events": [
            {"id": f"ev{i}", "type": t, "date": d, "name": n,
             "athletes": a, "notes": notes}
            for i, (t, d, n, a, notes) in enumerate(EVENTS, 1)
        ],
        "phases": [
            {"name": name, "nameLabel": PHASE_META[name][0],
             "startDate": (START + timedelta(days=(first - 1) * 7)).isoformat(),
             "endDate": (START + timedelta(days=(last - 1) * 7 + 6)).isoformat(),
             "firstWeek": first, "lastWeek": last,
             "focus": PHASE_META[name][1]}
            for name, first, last in PHASE_SPANS
        ],
        "weeks": weeks,
    }

    with open("plan.json", "w", encoding="utf-8") as f:
        json.dump(plan, f, indent=1, ensure_ascii=False)

    print(f"{'wk':>3} {'phase':<31} {'rec':<5} {'tgt E/L':>9} {'plan E/L':>11} {'delta':>14}")
    bad = []
    for w in weeks:
        te, tl = w["targetHours"]["eric"], w["targetHours"]["ella"]
        pe = planned_minutes(w, "eric") / 60
        pl = planned_minutes(w, "ella") / 60
        de, dl = (pe - te) / te * 100, (pl - tl) / tl * 100
        flag = ""
        if abs(de) > 5 or abs(dl) > 5:
            flag = "  <-- OFF"
            bad.append(w["weekNumber"])
        print(f"{w['weekNumber']:>3} {w['phase']:<31} "
              f"{'DOWN' if w['recoveryWeek'] else '':<5} "
              f"{te:>4.1f}/{tl:<4.1f} {pe:>5.1f}/{pl:<5.1f} "
              f"{de:>+5.1f}%/{dl:>+5.1f}%{flag}")
    print(f"\n{len(weeks)} weeks, off-target: {bad or 'none'}")
    print(f"recovery weeks: {sorted(RECOVERY)}")


if __name__ == "__main__":
    main()
