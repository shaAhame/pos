-- 002: branches (locations), stock per branch, transfers between branches.
-- Existing data is moved into a location called "Main store".

create table if not exists locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text not null default 'store' check (type in ('store','warehouse')),
  address     text not null default '',
  phone       text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists locations_name_key on locations (lower(name));
insert into locations (name, type) select 'Main store', 'store' where not exists (select 1 from locations);

-- Stock now lives per product per location.
create table if not exists product_stock (
  product_id   uuid not null references products(id) on delete cascade,
  location_id  uuid not null references locations(id) on delete cascade,
  quantity     integer not null default 0 check (quantity >= 0),
  primary key (product_id, location_id)
);
create index if not exists product_stock_location_idx on product_stock (location_id);

do $$
declare main uuid := (select id from locations order by created_at, id limit 1);
begin
  if exists (select 1 from information_schema.columns where table_name = 'products' and column_name = 'quantity') then
    insert into product_stock (product_id, location_id, quantity)
      select id, main, quantity from products
      on conflict (product_id, location_id) do nothing;
    alter table products drop column quantity;
  end if;

  alter table users           add column if not exists location_id uuid references locations(id) on delete set null;
  alter table shifts          add column if not exists location_id uuid references locations(id);
  alter table sales           add column if not exists location_id uuid references locations(id);
  alter table returns         add column if not exists location_id uuid references locations(id);
  alter table stock_movements add column if not exists location_id uuid references locations(id) on delete cascade;

  update users           set location_id = main where location_id is null and role <> 'owner';
  update shifts          set location_id = main where location_id is null;
  update sales           set location_id = main where location_id is null;
  update returns         set location_id = main where location_id is null;
  update stock_movements set location_id = main where location_id is null;
end $$;

-- Every product has a stock row (0) in every location.
insert into product_stock (product_id, location_id, quantity)
  select p.id, l.id, 0 from products p cross join locations l
  on conflict (product_id, location_id) do nothing;

create index if not exists sales_location_idx  on sales (location_id, date desc);
create index if not exists shifts_location_idx on shifts (location_id, opened_at desc);
create index if not exists stock_movements_loc_idx on stock_movements (location_id, product_id, created_at desc);

alter table stock_movements drop constraint if exists stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check check (reason in
  ('initial','sale','void','return','receive','adjust','offline_shortfall',
   'transfer_out','transfer_in','transfer_short','transfer_cancel'));

-- ---------- transfers ----------
create sequence if not exists transfer_seq;
create table if not exists transfers (
  id               uuid primary key default gen_random_uuid(),
  transfer_number  text not null unique,
  from_location_id uuid not null references locations(id),
  to_location_id   uuid not null references locations(id),
  status           text not null default 'in_transit' check (status in ('in_transit','received','cancelled')),
  note             text,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  received_by      uuid references users(id) on delete set null,
  received_at      timestamptz,
  receive_note     text,
  cancelled_by     uuid references users(id) on delete set null,
  cancelled_at     timestamptz,
  check (from_location_id <> to_location_id)
);
create index if not exists transfers_status_idx on transfers (status, created_at desc);

create table if not exists transfer_items (
  id                 uuid primary key default gen_random_uuid(),
  transfer_id        uuid not null references transfers(id) on delete cascade,
  product_id         uuid not null references products(id),
  name               text not null,
  quantity_sent      integer not null check (quantity_sent > 0),
  quantity_received  integer check (quantity_received >= 0 and quantity_received <= quantity_sent),
  unique (transfer_id, product_id)
);

alter table stock_movements add column if not exists transfer_id uuid references transfers(id) on delete set null;

alter table locations      enable row level security;
alter table product_stock  enable row level security;
alter table transfers      enable row level security;
alter table transfer_items enable row level security;
