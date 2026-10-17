CREATE TABLE products (
  id                  text PRIMARY KEY CHECK (id ~ '^P[0-9]{3}$'),
  name                text NOT NULL,
  category            text NOT NULL,
  requires_cold_chain boolean NOT NULL
);
CREATE TABLE warehouses (
  id               text PRIMARY KEY CHECK (id ~ '^W[0-9]{2}$'),
  city             text NOT NULL,
  distance_km      numeric(6,1) NOT NULL CHECK (distance_km >= 0),
  has_cold_storage boolean NOT NULL,
  has_cold_fleet   boolean NOT NULL,
  CHECK (NOT has_cold_fleet OR has_cold_storage)   -- a reefer fleet without cold storage is not modelled
);
CREATE TABLE inventory (
  warehouse_id text NOT NULL REFERENCES warehouses(id),
  product_id   text NOT NULL REFERENCES products(id),
  quantity     integer NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (warehouse_id, product_id)
);
CREATE TABLE delivery_history (
  id           text PRIMARY KEY,
  warehouse_id text NOT NULL REFERENCES warehouses(id),
  day_of_week  text NOT NULL CHECK (day_of_week IN ('Mon','Tue','Wed','Thu','Fri','Sat','Sun')),
  depart_time  time NOT NULL,
  duration_min integer NOT NULL CHECK (duration_min > 0),
  note         text
);
CREATE TABLE allocation_decisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  engine_version text NOT NULL,
  strategy       text NOT NULL CHECK (strategy IN ('distance','time-aware')),
  status         text NOT NULL CHECK (status IN ('FULL','PARTIAL','UNFULFILLABLE')),
  request        jsonb NOT NULL,
  decision       jsonb NOT NULL
);
CREATE INDEX allocation_decisions_created_at_idx ON allocation_decisions (created_at DESC);
CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
