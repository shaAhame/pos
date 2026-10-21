-- 004: electronics features (each one is switched on per business):
-- serial/IMEI numbers, warranty, variants, repairs, supplier claims, installments, advance orders, trade-ins.

-- ---------- products ----------
alter table products add column if not exists track_serials   boolean not null default false;
alter table products add column if not exists warranty_months integer not null default 0 check (warranty_months between 0 and 240);
alter table products add column if not exists model           text not null default '';   -- e.g. "Galaxy A15"
alter table products add column if not exists variant         text not null default '';   -- e.g. "128GB Black"

alter table sale_items add column if not exists warranty_until date;

alter table stock_movements drop constraint if exists stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check check (reason in
  ('initial','sale','void','return','receive','adjust','offline_shortfall',
   'transfer_out','transfer_in','transfer_short','transfer_cancel',
   'repair_part','repair_part_back','claim_out','claim_back','trade_in','write_off'));

-- ---------- serial numbers (one row per physical unit) ----------
create table if not exists serials (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  product_id      uuid not null,
  serial          text not null,
  status          text not null default 'in_stock' check (status in
                    ('in_stock','in_transit','sold','defective','with_supplier','written_off','missing','in_repair')),
  location_id     uuid,
  cost            numeric(12,2),
  supplier_id     uuid,
  received_at     timestamptz not null default now(),
  sale_id         uuid,
  sold_at         timestamptz,
  warranty_until  date,
  note            text,
  updated_at      timestamptz not null default now(),
  foreign key (product_id, business_id)  references products (id, business_id) on delete cascade,
  foreign key (location_id, business_id) references locations (id, business_id),
  foreign key (sale_id, business_id)     references sales (id, business_id) on delete set null (sale_id),
  unique (id, business_id)
);
create unique index if not exists serials_biz_serial_key on serials (business_id, upper(serial));
create index if not exists serials_product_loc_idx on serials (business_id, product_id, location_id, status);

-- history of each unit (received, sold, returned, sent, repaired...)
create table if not exists serial_events (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  serial_id    uuid not null,
  event        text not null,
  location_id  uuid,
  ref_number   text,
  note         text,
  user_id      uuid,
  created_at   timestamptz not null default now(),
  foreign key (serial_id, business_id) references serials (id, business_id) on delete cascade
);
create index if not exists serial_events_serial_idx on serial_events (serial_id, created_at);

-- which units were on which receipt line (kept even if a unit is later resold)
create table if not exists sale_item_serials (
  sale_item_id  uuid not null references sale_items(id) on delete cascade,
  serial_id     uuid not null references serials(id),
  serial        text not null,
  returned      boolean not null default false,
  primary key (sale_item_id, serial_id)
);

create table if not exists transfer_item_serials (
  transfer_item_id uuid not null references transfer_items(id) on delete cascade,
  serial_id        uuid not null references serials(id),
  received         boolean,
  primary key (transfer_item_id, serial_id)
);

-- ---------- repairs ----------
create table if not exists repair_jobs (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  job_number      text not null,
  location_id     uuid not null,
  customer_id     uuid,
  customer_name   text not null,
  customer_phone  text not null,
  device          text not null,
  serial          text,
  serial_id       uuid,
  issue           text not null,
  accessories     text not null default '',
  condition       text not null default '',
  estimate        numeric(12,2),
  labour_charge   numeric(12,2) not null default 0 check (labour_charge >= 0),
  under_warranty  boolean not null default false,
  status          text not null default 'received' check (status in
                    ('received','diagnosing','waiting_parts','in_progress','ready','collected','cancelled')),
  technician_id   uuid,
  promised_date   date,
  sale_id         uuid,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  collected_at    timestamptz,
  foreign key (location_id, business_id) references locations (id, business_id),
  foreign key (customer_id, business_id) references customers (id, business_id) on delete set null (customer_id),
  unique (id, business_id)
);
create unique index if not exists repair_jobs_biz_number_key on repair_jobs (business_id, job_number);
create index if not exists repair_jobs_status_idx on repair_jobs (business_id, status, created_at desc);

create table if not exists repair_events (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  job_id      uuid not null,
  status      text,
  note        text,
  user_id     uuid,
  created_at  timestamptz not null default now(),
  foreign key (job_id, business_id) references repair_jobs (id, business_id) on delete cascade
);

create table if not exists repair_parts (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  job_id      uuid not null,
  product_id  uuid not null,
  name        text not null,
  quantity    integer not null check (quantity > 0),
  price       numeric(12,2) not null check (price >= 0),
  cost        numeric(12,2),
  serial_id   uuid,
  user_id     uuid,
  created_at  timestamptz not null default now(),
  foreign key (job_id, business_id) references repair_jobs (id, business_id) on delete cascade,
  foreign key (product_id, business_id) references products (id, business_id)
);

-- ---------- supplier warranty claims ----------
create table if not exists supplier_claims (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  claim_number     text not null,
  supplier_id      uuid not null,
  location_id      uuid not null,
  status           text not null default 'sent' check (status in ('sent','repaired','replaced','credited','rejected')),
  reason           text not null,
  note             text,
  credit_amount    numeric(12,2),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  resolved_by      uuid,
  resolved_at      timestamptz,
  resolution_note  text,
  foreign key (supplier_id, business_id) references suppliers (id, business_id),
  foreign key (location_id, business_id) references locations (id, business_id),
  unique (id, business_id)
);
create unique index if not exists supplier_claims_biz_number_key on supplier_claims (business_id, claim_number);

create table if not exists supplier_claim_items (
  id               uuid primary key default gen_random_uuid(),
  claim_id         uuid not null references supplier_claims(id) on delete cascade,
  product_id       uuid not null references products(id),
  name             text not null,
  quantity         integer not null check (quantity > 0),
  serial_id        uuid references serials(id),
  from_stock       boolean not null default true,      -- taken off the shelf (vs. a defective item already off stock)
  replacement_serial text
);

-- ---------- installments (easy payment) ----------
create table if not exists installment_plans (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  plan_number   text not null,
  sale_id       uuid not null,
  customer_id   uuid not null,
  location_id   uuid not null,
  sale_total    numeric(12,2) not null,
  down_payment  numeric(12,2) not null,
  fee           numeric(12,2) not null default 0 check (fee >= 0),
  financed      numeric(12,2) not null check (financed > 0),   -- (sale_total - down_payment) + fee
  months        integer not null check (months between 1 and 60),
  first_due     date not null,
  status        text not null default 'active' check (status in ('active','completed','cancelled')),
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  foreign key (sale_id, business_id)     references sales (id, business_id),
  foreign key (customer_id, business_id) references customers (id, business_id),
  foreign key (location_id, business_id) references locations (id, business_id),
  unique (id, business_id)
);
create unique index if not exists installment_plans_biz_number_key on installment_plans (business_id, plan_number);

create table if not exists installment_dues (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references installment_plans(id) on delete cascade,
  seq         integer not null,
  due_date    date not null,
  amount      numeric(12,2) not null check (amount > 0),
  paid        numeric(12,2) not null default 0 check (paid >= 0 and paid <= amount),
  paid_at     timestamptz,
  unique (plan_id, seq)
);
create index if not exists installment_dues_due_idx on installment_dues (due_date) where paid < amount;

-- ---------- advance orders with deposits ----------
create table if not exists orders (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  order_number    text not null,
  location_id     uuid not null,
  customer_id     uuid,
  customer_name   text not null,
  customer_phone  text not null,
  status          text not null default 'open' check (status in ('open','ready','completed','cancelled')),
  total           numeric(12,2) not null check (total >= 0),
  deposit_paid    numeric(12,2) not null default 0 check (deposit_paid >= 0),
  due_date        date,
  note            text,
  sale_id         uuid,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  foreign key (location_id, business_id) references locations (id, business_id),
  foreign key (customer_id, business_id) references customers (id, business_id) on delete set null (customer_id),
  unique (id, business_id)
);
create unique index if not exists orders_biz_number_key on orders (business_id, order_number);

create table if not exists order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  product_id  uuid not null references products(id),
  name        text not null,
  quantity    integer not null check (quantity > 0),
  price       numeric(12,2) not null check (price >= 0)
);

-- ---------- trade-ins ----------
create table if not exists trade_ins (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  sale_id      uuid not null,
  description  text not null,
  serial       text,
  condition    text not null default '',
  value        numeric(12,2) not null check (value > 0),
  product_id   uuid,             -- if the item was put into stock to resell
  serial_id    uuid,
  user_id      uuid,
  created_at   timestamptz not null default now(),
  foreign key (sale_id, business_id) references sales (id, business_id)
);

-- link payments to plans / orders
alter table payments add column if not exists plan_id  uuid references installment_plans(id) on delete set null;
alter table payments add column if not exists order_id uuid references orders(id) on delete set null;

alter table serials               enable row level security;
alter table serial_events         enable row level security;
alter table sale_item_serials     enable row level security;
alter table transfer_item_serials enable row level security;
alter table repair_jobs           enable row level security;
alter table repair_events         enable row level security;
alter table repair_parts          enable row level security;
alter table supplier_claims       enable row level security;
alter table supplier_claim_items  enable row level security;
alter table installment_plans     enable row level security;
alter table installment_dues      enable row level security;
alter table orders                enable row level security;
alter table order_items           enable row level security;
alter table trade_ins             enable row level security;
