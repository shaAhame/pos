-- 001: initial schema for the POS.
-- Written to be safe on a fresh database AND on a database created by the
-- earlier version of this app (tables may already exist).

-- ---------- users & settings ----------
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  first_name  text not null,
  last_name   text not null,
  email       text not null,
  password    text not null,
  created_at  timestamptz not null default now()
);
alter table users add column if not exists role   text not null default 'cashier';
alter table users add column if not exists active boolean not null default true;
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('owner','manager','cashier'));
create unique index if not exists users_email_key on users (lower(email));
-- Anyone created by the old version was effectively an admin.
update users set role = 'owner' where role = 'cashier' and not exists (select 1 from users where role = 'owner');

create table if not exists settings (
  id                    int primary key default 1 check (id = 1),
  shop_name             text not null default 'My Shop',
  address               text not null default '',
  phone                 text not null default '',
  email                 text not null default '',
  receipt_footer        text not null default 'Thank you for shopping with us!',
  currency              text not null default 'Rs.',
  default_tax_rate      numeric(5,2) not null default 0 check (default_tax_rate between 0 and 100),
  max_cashier_discount  numeric(5,2) not null default 10 check (max_cashier_discount between 0 and 100),
  timezone              text not null default 'Asia/Colombo',
  updated_at            timestamptz not null default now()
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- ---------- people ----------
create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  contact_number  text not null,
  email           text,
  address         text,
  created_at      timestamptz not null default now()
);
alter table customers alter column email drop not null;
alter table customers alter column address drop not null;

create table if not exists employees (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  position        text not null,
  salary          numeric(12,2) not null check (salary >= 0),
  contact_number  text not null,
  email           text not null unique,
  created_at      timestamptz not null default now()
);

create table if not exists suppliers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  company         text not null,
  contact_number  text not null,
  email           text not null unique,
  address         text not null,
  created_at      timestamptz not null default now()
);

-- ---------- products & stock ----------
create table if not exists products (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text not null,
  category     text not null,
  price        numeric(12,2) not null check (price >= 0),
  barcode      text unique,
  quantity     integer not null check (quantity >= 0),
  created_at   timestamptz not null default now()
);
alter table products alter column description set default '';
alter table products add column if not exists cost_price          numeric(12,2) check (cost_price >= 0);
alter table products add column if not exists low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0);
alter table products add column if not exists active              boolean not null default true;

create table if not exists shifts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id),
  opened_at      timestamptz not null default now(),
  opening_float  numeric(12,2) not null default 0 check (opening_float >= 0),
  closed_at      timestamptz,
  closed_by      uuid references users(id),
  counted_cash   numeric(12,2),
  expected_cash  numeric(12,2),
  variance       numeric(12,2),
  note           text
);
-- A user can have at most one open shift.
create unique index if not exists shifts_one_open_per_user on shifts (user_id) where closed_at is null;

-- ---------- sales ----------
create sequence if not exists invoice_seq;
create table if not exists sales (
  id               uuid primary key default gen_random_uuid(),
  invoice_number   text not null unique,
  customer_id      uuid references customers(id) on delete set null,
  customer_name    text not null default 'Walk-in Customer',
  subtotal         numeric(12,2) not null,
  discount         numeric(5,2)  not null default 0,
  discount_amount  numeric(12,2) not null default 0,
  tax_rate         numeric(5,2)  not null default 0,
  tax_amount       numeric(12,2) not null default 0,
  total_amount     numeric(12,2) not null,
  payment_status   text not null default 'Paid',
  payment_method   text not null check (payment_method in ('Cash','Card')),
  cashier_id       uuid references users(id) on delete set null,
  voided_at        timestamptz,
  voided_by        uuid references users(id) on delete set null,
  void_reason      text,
  date             timestamptz not null default now()
);
alter table sales add column if not exists client_ref      uuid unique;
alter table sales add column if not exists shift_id        uuid references shifts(id) on delete set null;
alter table sales add column if not exists amount_tendered numeric(12,2);
alter table sales add column if not exists change_given    numeric(12,2);
alter table sales add column if not exists offline         boolean not null default false;
alter table sales add column if not exists offline_note    text;
alter table sales add column if not exists synced_at       timestamptz;
alter table sales drop constraint if exists sales_payment_status_check;
alter table sales add constraint sales_payment_status_check check (payment_status in ('Paid','Voided'));
create index if not exists sales_date_idx  on sales (date desc);
create index if not exists sales_shift_idx on sales (shift_id);

create table if not exists sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references sales(id) on delete cascade,
  product_id  uuid references products(id) on delete set null,
  name        text not null,
  quantity    integer not null check (quantity > 0),
  price       numeric(12,2) not null,
  total       numeric(12,2) not null
);
alter table sale_items add column if not exists cost_price        numeric(12,2);
alter table sale_items add column if not exists returned_quantity integer not null default 0;
alter table sale_items drop constraint if exists sale_items_returned_check;
alter table sale_items add constraint sale_items_returned_check check (returned_quantity between 0 and quantity);
create index if not exists sale_items_sale_idx    on sale_items (sale_id);
create index if not exists sale_items_product_idx on sale_items (product_id);

-- ---------- returns ----------
create sequence if not exists return_seq;
create table if not exists returns (
  id             uuid primary key default gen_random_uuid(),
  return_number  text not null unique,
  sale_id        uuid not null references sales(id),
  user_id        uuid references users(id) on delete set null,
  shift_id       uuid references shifts(id) on delete set null,
  reason         text not null,
  refund_method  text not null check (refund_method in ('Cash','Card')),
  refund_amount  numeric(12,2) not null check (refund_amount >= 0),
  created_at     timestamptz not null default now()
);
create index if not exists returns_sale_idx on returns (sale_id);
create index if not exists returns_date_idx on returns (created_at);

create table if not exists return_items (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references returns(id) on delete cascade,
  sale_item_id  uuid not null references sale_items(id),
  product_id    uuid references products(id) on delete set null,
  name          text not null,
  quantity      integer not null check (quantity > 0),
  amount        numeric(12,2) not null,
  restocked     boolean not null default true
);

-- ---------- stock history ----------
create table if not exists stock_movements (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  change          integer not null,
  quantity_after  integer not null,
  reason          text not null check (reason in ('initial','sale','void','return','receive','adjust','offline_shortfall')),
  sale_id         uuid references sales(id) on delete set null,
  return_id       uuid references returns(id) on delete set null,
  supplier_id     uuid references suppliers(id) on delete set null,
  unit_cost       numeric(12,2),
  note            text,
  user_id         uuid references users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists stock_movements_product_idx on stock_movements (product_id, created_at desc);

-- Only the server may touch these tables. With RLS on and no policies,
-- Supabase's public (anon/authenticated) API can read or write nothing.
alter table users           enable row level security;
alter table settings        enable row level security;
alter table customers       enable row level security;
alter table employees       enable row level security;
alter table suppliers       enable row level security;
alter table products        enable row level security;
alter table shifts          enable row level security;
alter table sales           enable row level security;
alter table sale_items      enable row level security;
alter table returns         enable row level security;
alter table return_items    enable row level security;
alter table stock_movements enable row level security;
