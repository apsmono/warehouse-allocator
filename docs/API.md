# API Contract — `/api/v1`

JSON only. No auth. All errors use one shape:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Order is invalid", "details": [ { "path": "lines.0.quantity", "message": "Must be an integer ≥ 1" } ] } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `MALFORMED_JSON` | Body is not parseable JSON |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 10 KB |
| 404 | `NOT_FOUND` | Unknown route or allocation id |
| 422 | `VALIDATION_FAILED` | Schema or business validation failed |
| 429 | `RATE_LIMITED` | > 60 POST/min/IP |
| 500 | `INTERNAL` | Anything else. Never leak stack traces or SQL |

---

## `GET /api/v1/health`
```json
{ "status": "ok", "version": "0.2.0", "commit": "a1b2c3d", "db": "ok", "engineVersion": "1.0.0" }
```
If the DB is unreachable, return `503` with `"db": "down"`. Used by the weekly keep-alive workflow.

## `GET /api/v1/catalog`
```json
{
  "products":   [{ "id": "P002", "name": "Vaccine — Hepatitis B (10-dose vial)", "category": "Pharmaceutical", "requiresColdChain": true }],
  "warehouses": [{ "id": "W02", "city": "Surabaya", "distanceKm": 12, "hasColdStorage": true, "hasColdFleet": false,
                   "stock": [{ "productId": "P001", "quantity": 50 }] }]
}
```

## `POST /api/v1/allocations`

Request:
```json
{
  "lines": [ { "productId": "P002", "quantity": 10 }, { "productId": "P001", "quantity": 100 } ],
  "options": { "allowSplit": true, "strategy": "distance" }
}
```

Validation (Zod):
- `lines`: 1–20 items. `productId` must exist in the catalogue. `quantity` integer 1–100 000.
- `options.allowSplit`: boolean, default `true`.
- `options.strategy`: `"distance"` (default) | `"time-aware"`. Before M4 ships, `"time-aware"` returns 422 `STRATEGY_NOT_AVAILABLE`.
- `options.dispatchAt`: `{ day: "Mon".."Sun", time: "HH:MM" }`. **Required iff** strategy is `time-aware`; rejected otherwise.
- Unknown top-level keys → 422 (strict schema).

Response `201`:
```json
{
  "id": "0d9f…uuid",
  "createdAt": "2026-10-20T03:00:00.000Z",
  "decision": { "...": "the Decision object from ALGORITHM.md §3" }
}
```

Persistence failure must **not** lose the answer. If the decision computes but the insert fails,
return `200` with the decision, `id: null` and a log line. A broken DB must never block the core
feature.

## `GET /api/v1/allocations/:id`
Returns the stored `{ id, createdAt, request, decision }`, or 404. The `:id` must be a UUID; anything else returns 404 (not 500).

## `GET /api/v1/travel-model` (M4)
```json
{
  "fittedFrom": 38,
  "groups": { "METRO": ["W01","W02","W03","W04"], "REGIONAL": ["W05","W06","W07","W08"] },
  "baselines": { "W01": 16.5 },
  "multipliers": { "METRO.AM_PEAK": 2.6, "REGIONAL.PM_PEAK": null },
  "cells": [ { "warehouseId": "W01", "bucket": "AM_PEAK", "n": 2, "median": 52.5 } ]
}
```
