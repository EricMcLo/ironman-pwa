#!/usr/bin/env python3
"""
Extends plan.json with W43-W51: the 9 weeks between Ironman 70.3 Utah
(Sat Aug 21, 2027) and the California International Marathon (Sun Oct 24, 2027).

Path A: Utah is the "A" race, CIM is the "B" race. No time goals — just finish.

Post-70.3 philosophy (top triathlon coaching consensus):
  * Week 1 after the 70.3: recovery only. Shake out the legs, nothing hard.
  * Weeks 2-6: marathon build. Running becomes the priority; bike and swim drop
    to maintenance (short, easy, 1-2x/week each).
  * Weeks 7-8: taper. Volume comes down ~30-40%, keep a little sharpness.
  * Week 9: race week. Short, easy, confident. CIM on Sunday.

Hours are "training hours only" — race day itself is not counted, matching the
existing W42 race-week convention.

Run:  python3 tools/extend_plan.py
"""

import json
from datetime import date, timedelta

PLAN_PATH = "plan.json"

START_OF_EXTENSION = date(2027, 8, 23)  # Monday after Utah
CIM = date(2027, 10, 24)                # Sunday


# ------------------------------------------------------------------ helpers

def session(sid, discipline, athletes, dur_e, dur_l, intensity, sets_e, sets_l,
            notes_e, notes_l, together=True, race_e=False, race_l=False,
            dist_e=None, dist_l=None, fueling=None):
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
    if fueling:
        s["fueling"] = fueling
    if race_e:
        s["variants"]["eric"]["race"] = True
    if race_l:
        s["variants"]["ella"]["race"] = True
    if race_e or race_l:
        s["race"] = True
    return s


def rest_session(sid, note="Optional walk or mobility."):
    return {
        "id": sid,
        "discipline": "rest",
        "athletes": ["eric", "ella"],
        "duration": 0,
        "intensity": "RPE1",
        "sets": "Rest",
        "notes": note,
        "together": True,
        "variants": {
            "eric": {"duration": 0, "sets": "Rest", "notes": note},
            "ella": {"duration": 0, "sets": "Rest", "notes": note},
        },
    }


def km(minutes):
    return round(minutes / 6.5, 1)


def build_week(week, start, phase, phase_name, focus, recovery, target_e,
               target_l, lr_min, tr_min, swim_min, bike_min, strength_days):
    """
    Build one marathon-phase week.

    lr_min  : Saturday long run minutes
    tr_min  : Thursday run minutes
    swim_min: Mon/Wed swim minutes each
    bike_min: Tue/Sun bike minutes each
    strength_days: list of weekdays that get a 20-min strength slot
    """
    week_start = start
    days = []

    for i, dow in enumerate(["monday", "tuesday", "wednesday", "thursday",
                             "friday", "saturday", "sunday"]):
        d = week_start + timedelta(days=i)
        tag = dow[:3]
        sessions = []

        # -------- Monday: swim --------
        if dow == "monday":
            sessions.append(session(
                f"w{week:02d}-mon-swim1", "swim", ["eric", "ella"], swim_min,
                swim_min, "Z1",
                "Easy aerobic swim — technique focus.",
                "Easy aerobic swim — hold form through the set.",
                "Drills and comfort. No intensity.",
                "Lane leader. Steady and relaxed.",
                together=True))

        # -------- Tuesday: bike + optional strength --------
        elif dow == "tuesday":
            sessions.append(session(
                f"w{week:02d}-tue-bike1", "bike", ["eric", "ella"], bike_min,
                bike_min, "Z2",
                "Easy recovery spin.", "Easy recovery spin.",
                "Gentle. Legs loose, not tired.",
                "Gentle. Legs loose, not tired.",
                together=True))
            if "tuesday" in strength_days:
                sessions.append(session(
                    f"w{week:02d}-tue-str1", "strength", ["eric", "ella"], 20,
                    20, "RPE3",
                    "Mobility + bodyweight.", "Mobility + bodyweight.",
                    "Reserved slot. No specific program.",
                    "Reserved slot. No specific program."))

        # -------- Wednesday: swim --------
        elif dow == "wednesday":
            sessions.append(session(
                f"w{week:02d}-wed-swim1", "swim", ["eric", "ella"], swim_min,
                swim_min, "Z1",
                "Easy aerobic swim.", "Easy aerobic swim.",
                "Short and relaxed.", "Short and relaxed.",
                together=True))

        # -------- Thursday: run + optional strength --------
        elif dow == "thursday":
            sessions.append(session(
                f"w{week:02d}-thu-run1", "run", ["eric", "ella"], tr_min,
                tr_min, "Z1-Z2",
                "Easy conversational run.", "Easy conversational run.",
                "Aerobic base. No racing.",
                "Aerobic base. No racing.",
                together=True,
                dist_e=km(tr_min), dist_l=km(tr_min)))
            if "thursday" in strength_days:
                sessions.append(session(
                    f"w{week:02d}-thu-str1", "strength", ["eric", "ella"], 20,
                    20, "RPE3",
                    "Mobility + bodyweight.", "Mobility + bodyweight.",
                    "Reserved slot. No specific program.",
                    "Reserved slot. No specific program."))

        # -------- Friday: rest --------
        elif dow == "friday":
            sessions.append(rest_session(
                f"w{week:02d}-fri-rest",
                "Rest day. Recover."))

        # -------- Saturday: long run --------
        elif dow == "saturday":
            if week == 51:
                # shakeout run before Sunday's marathon
                sessions.append(session(
                    f"w{week:02d}-sat-run1", "run", ["eric", "ella"], 30,
                    30, "Z1",
                    "Easy shakeout — legs loose, nothing hard.",
                    "Easy shakeout — legs loose, nothing hard.",
                    "20 min easy + 5 x 20s relaxed strides.",
                    "20 min easy + 5 x 20s relaxed strides.",
                    together=True, dist_e=5, dist_l=5))
            else:
                sessions.append(session(
                    f"w{week:02d}-sat-run1", "run", ["eric", "ella"], lr_min,
                    lr_min, "Z1-Z2",
                    "Easy long run — own pace, finish feeling good.",
                    "Easy long run — own pace, finish feeling good.",
                    "Marathon long run. Own pace, fueling practice.",
                    "Marathon long run. Own pace, fueling practice.",
                    together=True, dist_e=km(lr_min), dist_l=km(lr_min),
                    fueling="Practice 60 g carbs/hr" if lr_min >= 75 else None))

        # -------- Sunday: bike or race --------
        elif dow == "sunday":
            if d == CIM:
                sessions.append(session(
                    f"w{week:02d}-sun-race", "race", ["eric", "ella"], 240,
                    270, "RPE6-7",
                    "California International Marathon.", "California International Marathon.",
                    "Even effort. Fuel early. Walk aid stations if needed.",
                    "Even effort. Fuel early. Walk aid stations if needed.",
                    together=True, race_e=True, race_l=True))
            else:
                sessions.append(session(
                    f"w{week:02d}-sun-bike1", "bike", ["eric", "ella"], bike_min,
                    bike_min, "Z2",
                    "Easy endurance ride.", "Easy endurance ride.",
                    "Steady aerobic, no hero efforts.",
                    "Steady aerobic, no hero efforts.",
                    together=True))

        days.append({"date": d.isoformat(), "dayOfWeek": dow, "sessions": sessions})

    return {
        "weekNumber": week,
        "startDate": week_start.isoformat(),
        "endDate": (week_start + timedelta(days=6)).isoformat(),
        "phase": phase,
        "phaseName": phase_name,
        "recoveryWeek": recovery,
        "focus": focus,
        "targetHours": {"eric": target_e, "ella": target_l},
        "days": days,
    }


# ------------------------------------------------------------------ week specs

# (week, start, phase, phase_name, focus, recovery, target_e, target_l,
#  long_run, thursday_run, swim, bike, strength_days)
WEEKS = [
    # --- W43: recovery (the week after Utah) ---
    (43, date(2027, 8, 23), "marathon_recovery", "Recovery week",
     "Shake out the 70.3. Easy only — swim, spin, very short run. Nothing hard.",
     True, 3.5, 3.5, 40, 25, 30, 35, ["tuesday"]),

    # --- W44-W48: marathon build ---
    (44, date(2027, 8, 30), "marathon_build", "Marathon build",
     "Running becomes the priority. Bike and swim drop to maintenance.",
     False, 5.0, 5.0, 60, 30, 35, 45, ["tuesday", "thursday"]),
    (45, date(2027, 9, 6), "marathon_build", "Marathon build",
     "Long run nudges up. Everything else stays easy.",
     False, 5.5, 5.5, 75, 35, 35, 50, ["tuesday", "thursday"]),
    (46, date(2027, 9, 13), "marathon_build", "Marathon build",
     "Longest long run of the block. Still all easy.",
     False, 6.0, 6.0, 90, 40, 40, 50, ["tuesday", "thursday"]),
    (47, date(2027, 9, 20), "marathon_build", "Marathon build",
     "Peak long run. Trust the work, don't test it.",
     False, 6.5, 6.5, 105, 45, 40, 55, ["tuesday", "thursday"]),
    (48, date(2027, 9, 27), "marathon_build", "Marathon build",
     "Longest long run (~2 hrs). Start trimming midweek volume.",
     False, 5.5, 5.5, 120, 40, 30, 40, ["tuesday", "thursday"]),

    # --- W49-W50: taper ---
    (49, date(2027, 10, 4), "marathon_taper", "Marathon taper",
     "Cut volume by a third. Keep a little sharpness.",
     False, 4.5, 4.5, 75, 35, 30, 35, ["tuesday", "thursday"]),
    (50, date(2027, 10, 11), "marathon_taper", "Marathon taper",
     "Cut volume again. Arrive fresh, not fatigued.",
     False, 3.5, 3.5, 50, 25, 25, 30, ["tuesday"]),

    # --- W51: race week (CIM Sunday Oct 24) ---
    (51, date(2027, 10, 18), "race_week", "Race week",
     "Short, easy, confident. Nothing to gain this week.",
     False, 2.5, 2.5, 30, 20, 30, 30, ["tuesday"]),
]


# ------------------------------------------------------------------ main

def dur_of(s, athlete):
    return (s.get("variants") or {}).get(athlete, {}).get("duration", s["duration"])


def is_race_for(s, athlete):
    return (s.get("variants") or {}).get(athlete, {}).get(
        "race", s.get("race", False))


def planned_minutes(days, athlete):
    total = 0
    for day in days:
        for s in day["sessions"]:
            if athlete not in s["athletes"] or is_race_for(s, athlete):
                continue
            total += dur_of(s, athlete)
    return total


def nudge(days, athlete, target_min, order=None):
    """Adjust session durations by 5 min until within tolerance of target."""
    if order is None:
        order = [("tue-bike1", 35, 130), ("thu-run1", 25, 90),
                 ("mon-swim1", 25, 70), ("wed-swim1", 25, 70),
                 ("sun-bike1", 45, 220), ("sat-run1", 40, 180)]
    for _ in range(400):
        diff = target_min - planned_minutes(days, athlete)
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


def main():
    with open(PLAN_PATH) as f:
        plan = json.load(f)

    existing_weeks = {w["weekNumber"] for w in plan["weeks"]}
    new_weeks = []
    for spec in WEEKS:
        week_num = spec[0]
        if week_num in existing_weeks:
            raise SystemExit(f"Week {week_num} already exists — aborting.")
        new_weeks.append(build_week(*spec))

    # Nudge each new week to hit target hours exactly (±2.5 min)
    for wk in new_weeks:
        for athlete in ("eric", "ella"):
            target_min = wk["targetHours"][athlete] * 60
            nudge(wk["days"], athlete, target_min)

    plan["weeks"].extend(new_weeks)
    plan["endDate"] = CIM.isoformat()
    plan["planVersion"] = "2.1"

    # Add CIM event
    plan.setdefault("events", []).append({
        "id": "cim_marathon",
        "date": CIM.isoformat(),
        "name": "California International Marathon",
        "athletes": ["eric", "ella"],
        "description": "Finish comfortably — no time goal.",
    })

    with open(PLAN_PATH, "w") as f:
        json.dump(plan, f, indent=1, ensure_ascii=False)

    print(f"Added {len(new_weeks)} weeks (W{new_weeks[0]['weekNumber']}–W{new_weeks[-1]['weekNumber']})")
    print(f"Plan now ends {plan['endDate']}")
    print("Total weeks:", len(plan["weeks"]))

    # Verify hours match targets for every week
    def dur_of(s, athlete):
        return (s.get("variants") or {}).get(athlete, {}).get("duration", s["duration"])

    def is_race_for(s, athlete):
        return (s.get("variants") or {}).get(athlete, {}).get(
            "race", s.get("race", False))

    for wk in new_weeks:
        for athlete in ("eric", "ella"):
            total = 0
            for day in wk["days"]:
                for s in day["sessions"]:
                    if athlete not in s["athletes"] or is_race_for(s, athlete):
                        continue
                    total += dur_of(s, athlete)
            target_min = wk["targetHours"][athlete] * 60
            diff = abs(total - target_min)
            status = "OK" if diff < 2.5 else "OFF-TARGET"
            print(f"  W{wk['weekNumber']} {athlete}: {total/60:.1f}h "
                  f"(target {wk['targetHours'][athlete]}h) [{status}]")


if __name__ == "__main__":
    main()
