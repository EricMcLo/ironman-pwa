#!/usr/bin/env python3
"""
Adjusts plan.json weeks 1-8 (Nov-Dec) for conservative rebuilding.

Current: 6 training days, 5.5-7.5 hours/week
Target: 3-4 training days, 3.5-5.5 hours/week

Based on coaching consensus:
  - 2 sessions per discipline is enough to finish a 70.3 (Ironman.com)
  - Start conservatively, build gradually
  - Every 4th week is recovery

Run:  python3 tools/adjust_early_weeks.py
"""

import json
from datetime import date, timedelta

PLAN_PATH = "plan.json"

# New target hours for weeks 1-8 (Eric = Ella since they run about equal)
NEW_HOURS = {
    1: 4.0,   # down from 5.5
    2: 4.5,   # down from 6.0
    3: 5.0,   # down from 6.5
    4: 3.5,   # recovery (down from 4.5)
    5: 5.5,   # down from 7.0
    6: 6.0,   # down from 7.5
    7: 4.5,   # recovery (down from 5.5/7.0)
    8: 5.0,   # down from 6.0/7.5
}

# Day structure: full day names -> discipline or None (rest)
WEEK_STRUCTURE = {
    1:  {"monday": "swim", "tuesday": None, "wednesday": None, "thursday": "run",
         "friday": None, "saturday": "sat_run", "sunday": "sun_bike"},
    2:  {"monday": "swim", "tuesday": None, "wednesday": None, "thursday": "run",
         "friday": None, "saturday": "sat_run", "sunday": "sun_bike"},
    3:  {"monday": "swim", "tuesday": None, "wednesday": None, "thursday": "run",
         "friday": None, "saturday": "sat_run", "sunday": "sun_bike"},
    4:  {"monday": "swim", "tuesday": None, "wednesday": None, "thursday": "run",
         "friday": None, "saturday": "sat_run", "sunday": "sun_bike"},  # recovery
    5:  {"monday": "swim", "tuesday": None, "wednesday": "bike", "thursday": "run",
         "friday": None, "saturday": "sat_run", "sunday": "sun_bike"},
    6:  {"monday": "swim", "tuesday": None, "wednesday": "bike", "thursday": "run",
         "friday": None, "saturday": "sat_run", "sunday": "sun_bike"},
    7:  {"monday": "swim", "tuesday": None, "wednesday": None, "thursday": "run",
         "friday": None, "saturday": "sat_run", "sunday": "sun_bike"},  # recovery
    8:  {"monday": "swim", "tuesday": None, "wednesday": "bike", "thursday": "run",
         "friday": None, "saturday": "sat_run", "sunday": "sun_bike"},
}

# Duration allocations per discipline per week (minutes)
WEEK_DURATIONS = {
    1:  {"swim": 35, "run": 30, "sat_run": 55, "sun_bike": 65},
    2:  {"swim": 40, "run": 35, "sat_run": 60, "sun_bike": 70},
    3:  {"swim": 40, "run": 40, "sat_run": 65, "sun_bike": 75},
    4:  {"swim": 30, "run": 25, "sat_run": 45, "sun_bike": 55},  # recovery
    5:  {"swim": 40, "bike": 45, "run": 35, "sat_run": 65, "sun_bike": 70},
    6:  {"swim": 40, "bike": 50, "run": 40, "sat_run": 70, "sun_bike": 75},
    7:  {"swim": 35, "run": 30, "sat_run": 50, "sun_bike": 65},  # recovery
    8:  {"swim": 40, "bike": 50, "run": 35, "sat_run": 60, "sun_bike": 70},
}

DISCIPLINE_KEYS = {
    "swim": ("swim",),
    "bike": ("bike",),
    "run": ("run",),
    "sat_run": ("run",),
    "sun_bike": ("bike",),
}


def build_session(wn, dow, assigned, durs):
    """Build a session dict for the given day and assignment."""
    fueling = None
    dist_e = dist_l = None

    if assigned == "swim":
        dur = durs["swim"]
        sid = f"w{wn:02d}-mon-swim1"
        sets_e = "8x50 drill/swim (catch-up, fingertip drag) + 200 easy + 100 cool-down"
        sets_l = "4x100 aerobic w/ paddles + 200 easy + 4x50 drill + 100 cool-down"
        note_e = "Technique focus: drills, short sets, building comfort."
        note_l = "Lane leader. Hold form and pace through the set."
        intensity = "Z1"
        together = True
        dist_e = round(dur / 6.5, 1)
        dist_l = round(dur / 6.5, 1)

    elif assigned == "bike":
        dur = durs["bike"]
        sid = f"w{wn:02d}-wed-bike1"
        sets_e = sets_l = "Steady aerobic spin"
        note_e = note_l = "Aerobic base."
        intensity = "Z2"
        together = True

    elif assigned == "run":
        dur = durs["run"]
        sid = f"w{wn:02d}-thu-run1"
        sets_e = sets_l = "Easy conversational run"
        note_e = note_l = "Aerobic base."
        intensity = "Z2"
        together = True
        dist_e = round(dur / 6.5, 1)
        dist_l = round(dur / 6.5, 1)

    elif assigned == "sat_run":
        dur = durs["sat_run"]
        sid = f"w{wn:02d}-sat-run1"
        sets_e = sets_l = "Easy long run with run club -- own pace"
        note_e = "Run maintenance. Easy, no racing the group."
        note_l = "Easy long run. Own pace, no racing the group."
        intensity = "Z1-Z2"
        together = True
        dist_e = round(dur / 6.5, 1)
        dist_l = round(dur / 6.5, 1)
        fueling = "Practice 60 g carbs/hr" if dur >= 90 else None

    elif assigned == "sun_bike":
        dur = durs["sun_bike"]
        sid = f"w{wn:02d}-sun-bike1"
        sets_e = sets_l = "Long endurance ride"
        note_e = "Your strength. Steady aerobic, no hero efforts."
        note_l = "Steady aerobic ride."
        intensity = "Z2"
        together = True
        fueling = "Practice race fueling" if dur >= 120 else None

    else:
        return None

    session = {
        "id": sid,
        "discipline": assigned,
        "athletes": ["eric", "ella"],
        "duration": dur,
        "intensity": intensity,
        "sets": sets_e,
        "notes": note_e,
        "together": together,
        "variants": {
            "eric": {"duration": dur, "sets": sets_e, "notes": note_e},
            "ella": {"duration": dur, "sets": sets_l, "notes": note_l},
        },
    }
    if dist_e is not None:
        session["variants"]["eric"]["distanceKm"] = dist_e
        session["variants"]["ella"]["distanceKm"] = dist_l
        session["distanceKm"] = dist_e
    if fueling:
        session["fueling"] = fueling

    return session


def build_rest_session(wn, dow):
    """Build a rest session for a given day."""
    tag = dow[:3]
    return {
        "id": f"w{wn:02d}-{tag}-rest",
        "discipline": "rest",
        "athletes": ["eric", "ella"],
        "duration": 0,
        "intensity": "RPE1",
        "sets": "Rest",
        "notes": "Rest day.",
        "together": True,
        "variants": {
            "eric": {"duration": 0, "sets": "Rest", "notes": "Rest day."},
            "ella": {"duration": 0, "sets": "Rest", "notes": "Rest day."},
        },
    }


def main():
    with open(PLAN_PATH) as f:
        plan = json.load(f)

    for wk in plan["weeks"]:
        wn = wk["weekNumber"]
        if wn not in NEW_HOURS:
            continue

        new_hours = NEW_HOURS[wn]
        structure = WEEK_STRUCTURE[wn]
        durs = WEEK_DURATIONS[wn]

        print(f"\n=== WEEK {wn} ({wk['startDate']}) ===")
        print(f"Target: {new_hours}h (was {wk['targetHours']['eric']}h)")

        for day in wk["days"]:
            dow = day["dayOfWeek"]
            assigned = structure.get(dow)

            if assigned is None:
                day["sessions"] = [build_rest_session(wn, dow)]
                continue

            session = build_session(wn, dow, assigned, durs)
            if session:
                day["sessions"] = [session]
            else:
                day["sessions"] = [build_rest_session(wn, dow)]

        # Update target hours
        wk["targetHours"] = {"eric": new_hours, "ella": new_hours}

        # Verify total minutes
        total_e = sum(s["variants"]["eric"]["duration"]
                      for d in wk["days"] for s in d["sessions"])
        print(f"  Eric total: {total_e} min ({total_e/60:.1f}h)")

    # Bump plan version
    plan["planVersion"] = "3.0"

    with open(PLAN_PATH, "w") as f:
        json.dump(plan, f, indent=1, ensure_ascii=False)

    print("\nDone. Weeks 1-8 adjusted.")


if __name__ == "__main__":
    main()
