-- MAM Stores POS database schema (PostgreSQL / Supabase).
-- The server runs this automatically on start-up; it is safe to run more than once.
-- You can also paste it into Supabase → SQL Editor and click Run.


create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  first_name  text not null,
  last_name   text not null,
  email       text not null,
  password    text not null,
  created_at  timestamptz not null default now()
);
create unique index if not exists users_email_key on users (lower(email));

create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  contact_number  text not null,
  email           text not null unique,
  address         text not null,
  created_at      timestamptz not null default now()
);

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

create table if not exists products (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text not null,
  category     text not null,
  price        numeric(12,2) not null check (price >= 0),
  barcode      text unique,                       -- optional; NULLs don't clash
  quantity     integer not null check (quantity >= 0),  -- stock can never go negative
  created_at   timestamptz not null default now()
);

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
  payment_status   text not null default 'Paid' check (payment_status in ('Paid','Unpaid','Partial','Voided')),
  payment_method   text not null check (payment_method in ('Cash','Card')),
  cashier_id       uuid references users(id) on delete set null,
  voided_at        timestamptz,
  voided_by        uuid references users(id) on delete set null,
  void_reason      text,
  date             timestamptz not null default now()
);
create index if not exists sales_date_idx on sales (date desc);

create table if not exists sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references sales(id) on delete cascade,
  product_id  uuid references products(id) on delete set null,  -- sale history survives product deletion
  name        text not null,                                    -- name at time of sale
  quantity    integer not null check (quantity > 0),
  price       numeric(12,2) not null,
  total       numeric(12,2) not null
);
create index if not exists sale_items_sale_idx on sale_items (sale_id);

-- The app connects through its own server, never directly from the browser.
-- Turning on Row Level Security with no policies blocks Supabase's public API
-- from reading these tables, so the only way in is through the server.
alter table users      enable row level security;
alter table customers  enable row level security;
alter table employees  enable row level security;
alter table suppliers  enable row level security;
alter table products   enable row level security;
alter table sales      enable row level security;
alter table sale_items enable row level security;
