export type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export type Strategy = "distance" | "time-aware";

export type AllocationStatus = "FULL" | "PARTIAL" | "UNFULFILLABLE";

export type CostUnit = "km" | "min";

export type ExclusionCode = "NO_COLD_FLEET" | "NO_COLD_STORAGE";

export type TravelPredictionSource = "observed" | "group-pattern" | "baseline";

export type OrderLine = {
  productId: string;
  quantity: number;
};

export type Order = {
  lines: OrderLine[];
};

export type DispatchAt = {
  day: Day;
  time: string;
};

export type Options = {
  allowSplit?: boolean;
  strategy?: Strategy;
  dispatchAt?: DispatchAt;
};

export type Product = {
  id: string;
  name: string;
  category: string;
  requiresColdChain: boolean;
};

export type Warehouse = {
  id: string;
  city: string;
  distanceKm: number;
  hasColdStorage: boolean;
  hasColdFleet: boolean;
};

export type StockRow = {
  warehouseId: string;
  productId: string;
  quantity: number;
};

export type CatalogSnapshot = {
  products: Product[];
  warehouses: Warehouse[];
  stock: StockRow[];
};

export type ShipmentTravel = {
  minutes: number;
  source: TravelPredictionSource;
  sampleSize: number;
  bucket: string;
};

export type ShipmentItem = {
  productId: string;
  quantity: number;
};

export type Shipment = {
  warehouseId: string;
  city: string;
  distanceKm: number;
  travel?: ShipmentTravel;
  items: ShipmentItem[];
};

export type Shortfall = {
  productId: string;
  requested: number;
  allocated: number;
  missing: number;
  reason: string;
};

export type Exclusion = {
  warehouseId: string;
  productId: string;
  code: ExclusionCode;
  detail: string;
};

export type Alternative = {
  warehouses: string[];
  unitsFilled: number;
  totalCost: number;
  delta: number;
  whyNot: string;
};

export type DecisionMeta = {
  engineVersion: string;
  shipmentOverhead: number;
  evaluatedCombinations: number;
};

export type Decision = {
  status: AllocationStatus;
  strategy: Strategy;
  dispatchAt?: DispatchAt;
  shipments: Shipment[];
  shortfalls: Shortfall[];
  totalCost: number;
  costUnit: CostUnit;
  summary: string;
  reasons: string[];
  excluded: Exclusion[];
  alternatives: Alternative[];
  meta: DecisionMeta;
};

export type TravelModel = {
  predict(warehouse: Warehouse, dispatchAt: DispatchAt): ShipmentTravel;
};
