# Travel-time Model (Bonus, not built) — spec v1.0.0
> **Status:** analysis only. The time-aware strategy was dropped on 2026-10-19; v1 is distance-only. The findings below are real and feed the "next steps".

A small, explainable proof of concept. **Not ML.** 38 rows cannot support anything fancier, and the
reviewer must be able to follow every number.

## 1. The data and what it shows

Source: `data/delivery_history.csv`, normalised from the original attachment (the original was
Mac Roman encoded, used CR line endings, put day and time in one quoted field, and used `—` for an
empty note). Normalised columns: `delivery_id,warehouse_id,day,time,duration_min,note`.

Findings (computed 2026-10-16; the M4 implementation must reproduce them):

| Pattern | Evidence |
|---|---|
| **Metro routes (W01–W04, ≤ 30 km) are rush-hour dominated** | W01 (5 km): 10–18 min off-peak or weekend, but 48–65 min at 07:30–08:00 and 16:30–17:00. Metro AM peak ≈ **×2.6**, PM peak ≈ **×3.05**, weekend ≈ **×0.8** of off-peak |
| **Distance is a poor proxy for time in the city** | W02 at 12 km Fri 17:30 = **100 min**; W03 at 25 km Fri 16:00 = 75 min |
| **Regional routes are weekend-dominated, not rush-hour dominated** | Malang (W05/W06): AM peak ≈ ×1.04 only, but Fri afternoon to Sun ≈ **×1.36** ("weekend travelers heading to Malang", "return traffic") |
| **The weekend effect flips sign** by route group | City is faster at weekends; the Malang corridor is slower. A single global "weekend factor" would be wrong |
| Sparse data | W07 and W08 have 2 records each. No regional PM-peak record exists at all |

## 2. Definitions

- **Group**: `METRO` if `distanceKm ≤ 40`, else `REGIONAL`. (W01–W04 METRO; W05–W08 REGIONAL.)
- **Bucket(w, day, time)**, evaluated in this order:
  1. `Sat`/`Sun` → `WEEKEND`
  2. `REGIONAL` and `Fri` and time ≥ 12:00 → `WEEKEND` (from the notes column)
  3. Mon–Fri 06:30 ≤ t < 10:00 → `AM_PEAK`
  4. Mon–Fri 16:00 ≤ t < 20:00 → `PM_PEAK`
  5. Otherwise → `OFFPEAK`
- **baseline(w)** = median duration of w's `OFFPEAK` records (every warehouse has ≥ 1).
- **multiplier(group, bucket)** = median over all records in that group and bucket of
  `duration / baseline(warehouse)`, **rounded to 2 dp**. Undefined if there are no records.

## 3. Prediction (fallback chain)

```
predict(w, day, time):
  b = bucket(w, day, time)
  obs = durations of w's records in bucket b
  if obs non-empty      -> round(median(obs)),                 source "observed",      n = |obs|
  elif b == OFFPEAK     -> round(baseline(w)),                 source "baseline",      n = 0
  elif multiplier(g,b)  -> round(baseline(w) * multiplier),    source "group-pattern", n = 0
  else                  -> round(baseline(w)),                 source "baseline",      n = 0
round = half-up to integer (Math.round)
```

Expected values for spot checks: `test/fixtures/golden.json → travelModel`. Examples:
W01 Mon 08:00 = 53 (observed, n=2) · W07 Fri 17:00 = 92 (group-pattern) · W08 Sat 10:00 = 279
(group-pattern) · W05 Fri 17:00 = 170 (observed, n=3).

## 4. How it changes decisions (demo cases for the UI and README)

| Order | Distance strategy | Time-aware | Why |
|---|---|---|---|
| P005×350, **Mon 08:00** | W01 + W04 (75 km-eq) | **W05 alone** (160 min vs 183 for W01+W04) | Metro rush hour triples city trips; Malang barely changes on a Monday morning |
| P005×350, Wed 14:00 | W01 + W04 | W01 + W04 (125 min) | Off-peak: the two strategies agree |

**Known trade-off to state honestly in the README:** the objective minimises total
*vehicle-minutes plus overhead*. On Monday 08:00 that picks W05 (one truck, 130 min) over W01+W04
(two trucks, 53 + 70 = 123 vehicle-min plus one extra dispatch), even though W01+W04 would
**arrive sooner** (the latest arrival is 70 min). That is an operator-cost objective. A service-time
objective (minimise latest arrival) would choose differently. We show the alternative and its
arrival time in `alternatives[]` instead of hiding it. This is a "what I'd do next" item: make the
objective selectable.

## 5. Limits (say them, don't hide them)
- n = 1–3 per cell. Medians of one record are anecdotes. Sample size is shown on every prediction.
- REGIONAL rules learned from Malang are applied to Pasuruan and Jember with no data of their own.
- No date, season, holiday or weather. Customer location is fixed.
- The model is fitted at startup from the CSV, which is fine at 38 rows. With real volume it should
  be refitted offline on a schedule.
