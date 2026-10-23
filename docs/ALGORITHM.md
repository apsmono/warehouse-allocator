# Allocation Algorithm — spec v1.0.1

`ENGINE_VERSION = "1.0.1"`. Bump it (see VERSIONING.md) whenever any rule below changes the output
for any input. **This file is read-only for the executor.** If code and spec disagree, the spec
wins. If the spec looks wrong, stop and say so in REPORT.md.

---

## 1. Inputs

```ts
type Order = { lines: { productId: string; quantity: number }[] };
type Options = {
  allowSplit?: boolean;                 // default true
  strategy?: "distance" | "time-aware"; // default "distance"
  dispatchAt?: { day: Day; time: string }; // required iff strategy = "time-aware"; time "HH:MM" 24h
};
type CatalogSnapshot = { products: Product[]; warehouses: Warehouse[]; stock: StockRow[] };
type Product   = { id; name; category; requiresColdChain: boolean };
type Warehouse = { id; city; distanceKm: number; hasColdStorage: boolean; hasColdFleet: boolean };
type StockRow  = { warehouseId; productId; quantity: number }; // quantity >= 0
```

The engine signature is `allocate(order, snapshot, options, travelModel?) => Decision`. It is pure:
no DB, no `Date.now()`, no `Math.random()`.

## 2. Steps

### Step 0: Normalise
1. Merge duplicate `productId` lines by summing quantities (golden G10).
2. Sort the merged lines by `productId` ascending. Everything downstream iterates in this order.

### Step 1: Eligibility
Warehouse `w` is **eligible for product `p`** iff:
- `stock(w, p) > 0`, **and**
- `!p.requiresColdChain || (w.hasColdStorage && w.hasColdFleet)`

For every ordered product, record an **exclusion** for each warehouse that holds `stock > 0` but
fails a rule. Do not record warehouses that simply have none of the product (that is noise):

| Code | When |
|---|---|
| `NO_COLD_FLEET` | Cold product, warehouse has cold storage but no refrigerated vans (W02, W06) |
| `NO_COLD_STORAGE` | Cold product, warehouse has no refrigerated storage |

With the seed data, the exclusions that actually occur are W02 and W06 for P002/P004 (`NO_COLD_FLEET`).

**Candidate warehouses** = warehouses eligible for at least one ordered product.

### Step 2: Travel cost per warehouse
- `distance` strategy: `travel(w) = w.distanceKm`, `OVERHEAD = 20`.
  _(Not built in v1: the time-aware strategy returns 422 STRATEGY_NOT_AVAILABLE.)_
- `time-aware` strategy: `travel(w) = travelModel.predict(w, dispatchAt).minutes` (an integer, see
  TRAVEL-MODEL.md), `OVERHEAD = 30`.

### Step 3: Enumerate and allocate
For every non-empty subset `S` of candidates (if `allowSplit === false`, subsets of size 1 only),
in order of increasing size, then lexicographic warehouse IDs:
1. Order the warehouses in `S` by `(travel(w) asc, id asc)`. This is the **fill order**.
2. For each merged line, in productId order, take `min(remaining, stock(w,p))` from each eligible
   `w` in fill order until the line is satisfied or `S` runs out. Leftover = shortfall.
3. **Discard `S` if any warehouse in it received zero units.** It is dominated: the same fill is
   possible without it, at lower cost.
4. Score: `filled = Σ allocated units`, `cost = Σ_{w∈S} (OVERHEAD + travel(w))`.

With 8 warehouses there are at most 255 subsets, so exhaustive search is trivially fast and
**provably optimal** for the stated objective. Record `evaluatedCombinations` (subsets that
survived step 3).

### Step 4: Rank (lexicographic, all ascending)
```
key(S) = ( -filled, cost, maxTravel(S), |S|, sortedIds(S).join(",") )
```
1. Fill as many units as possible (a partial order beats nothing; more beats less).
2. Then the lowest total cost.
3. Then the earliest latest-arrival (`maxTravel`).
4. Then fewer shipments.
5. Then alphabetical IDs. This is purely for determinism.

**Chosen** = rank 1. **Alternatives** = ranks 2 and 3 (they may fill fewer units; show
`unitsFilled`).

### Step 5: Status
| Status | Condition |
|---|---|
| `FULL` | Chosen set has zero shortfall |
| `PARTIAL` | Chosen set fills ≥ 1 unit but has a shortfall |
| `UNFULFILLABLE` | No candidate warehouses at all (only reachable with test fixtures; with seed data every product has eligible stock) |

## 3. Output

```ts
type Decision = {
  status: "FULL" | "PARTIAL" | "UNFULFILLABLE";
  strategy: "distance" | "time-aware";
  dispatchAt?: { day; time };
  shipments: {                         // in fill order
    warehouseId; city; distanceKm;
    travel?: { minutes; source: "observed" | "group-pattern" | "baseline"; sampleSize; bucket }; // time-aware only
    items: { productId; quantity }[];  // productId order
  }[];
  shortfalls: { productId; requested; allocated; missing; reason: string }[];
  totalCost: number; costUnit: "km" | "min";
  summary: string;                     // one sentence
  reasons: string[];                   // 2–6 sentences, see §4
  excluded: { warehouseId; productId; code; detail: string }[];
  alternatives: { warehouses: string[]; unitsFilled; totalCost; delta: number; whyNot: string }[];
  meta: { engineVersion; shipmentOverhead; evaluatedCombinations };
};
```

## 4. Explanation templates (deterministic, no LLM)

`summary`:
- FULL, one warehouse: `"Ship everything from {W} ({city}, {km} km)."`
- FULL, split: `"Split into {n} shipments: {W1} and {W2}…, because no single eligible warehouse holds the full order."`
  (If a single warehouse *could* fill the order but the split is cheaper, use instead:
  `"Split into {n} nearby shipments; cheaper than one shipment from {Wsingle} ({km} km)."`)
- PARTIAL: `"Can fill {filled} of {requested} units; {missing} units of {product} are short across all eligible warehouses."`

`reasons[]`, in this order, each included only when relevant:
1. Cold chain: `"{product} needs a cold chain; only W04, W07, W08 have both refrigerated storage and refrigerated vans."`
2. Exclusion callout: `"W02 holds {q} {product} but has no refrigerated vans, so it cannot deliver it safely."`
3. Choice: `"{W} is the nearest warehouse that can supply {items}."`
4. Split trade-off: `"Each extra shipment adds {overhead} {unit} to the cost; splitting still saves {saved} {unit}."`
5. Shortfall: `"Total eligible stock of {product} is {n}; {missing} units should be back-ordered."`
6. Time-aware only: `"At {day} {time}, {W} is predicted at {min} min ({source}, n={k})."`

`alternatives[].whyNot`: `"+{delta} {unit}: {one extra shipment | longer trip | fills {k} fewer units}"`.

Wording may be polished, but each sentence must be generated from structured data. **No string is
hand-written per scenario.**

## 5. Golden scenarios (distance strategy, seed data)

The authoritative expected values are in `test/fixtures/golden.json` (21 cases including no-split and
time-aware). The summary is below for humans; costs are in km-equivalent.

| ID | Order | Expected | Cost | Why it matters |
|---|---|---|---|---|
| G01 | P001×100 | W01 | 25 | Baseline: nearest with stock |
| G02 | P001×250 | W03 | 45 | Single at 25 km beats W01+W02 (57) |
| G03 | P002×10 | **W04** | 50 | **W02 is nearer and has 30 vials but no cold fleet** |
| G04 | P002×50 | W08 | 170 | W04+W07 = 48 is not enough; single far trip beats W04+W08 (220) |
| G05 | P002×120 | W04+W07+W08, **PARTIAL**, short 12 | 285 | Eligible total is 108; W02/W06 excluded |
| G06 | P001+P003+P005 ×100 | W01 | 25 | One warehouse covers a 3-line order |
| G07 | P002×10 + P001×100 | W01 (gloves) + W04 (HepB) | 75 | Mixed cold/non-cold |
| G08 | P004×60 | W04 25 + W08 35 | 220 | Fill order: nearest first |
| G09 | P005×350 | W01 300 + W04 50 | 75 | **Two near trips beat one 90 km trip (110)** |
| G10 | P001×50 + P001×50 | W01 | 25 | Duplicate lines merged |
| G11 | P004×25 + P002×40 | W04 | 50 | Exactly uses W04's stock |
| G12 | P003×1200 | W01+W03+W05+W06, PARTIAL, short 100 | 295 | Total 1100. W06 is fine for syringes (no cold need) |
| G13 | P001×1100 | all 5 glove warehouses | 277 | Needs every unit in the network |

No-split: G07 → W07 alone, PARTIAL short 2 HepB · G08 → W08 alone, PARTIAL short 10 · G09 → W05.

## 6. Properties (property-based or randomised tests)

For random orders over the seed catalogue:
- P1: no allocation exceeds stock. Σ per (w,p) ≤ stock.
- P2: no cold product is ever allocated from a warehouse lacking storage or fleet.
- P3: allocated + missing = requested, for each line.
- P4: deterministic. The same input twice gives deep-equal output.
- P5: `allowSplit=false` gives at most 1 shipment.
- P6: every shipment has ≥ 1 item.

## 7. Complexity and the scaling note (for the README)
O(2^n · lines · n). Fine for n ≤ ~16. Beyond that, switch to greedy set-cover with a cost heuristic
or a small ILP. This is documented as a "next step", not built.
