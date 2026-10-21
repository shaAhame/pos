-- 003: multi-business platform.
--  * businesses: each client of the platform; all data belongs to exactly one business.
--  * platform_users: MacQuad staff who manage businesses (separate from shop logins).
--  * payments: one ledger of every money movement (sales, refunds, voids, installments, deposits...).
--  * counters: invoice/return/transfer numbers per business.
-- Existing data (if any) becomes the first business.

create table if not exists businesses (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  type           text not null default 'grocery' check (type in ('grocery','electronics','general')),
  status         text not null default 'active' check (status in ('active','suspended')),
  plan           text not null default 'standard',
  features       jsonb not null default '{}'::jsonb,
  contact_name   text not null default '',
  contact_phone  text not null default '',
  contact_email  text not null default '',
  notes          text not null default '',
  created_at     timestamptz not null default now()
);

create table if not exists platform_users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  password    text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists platform_users_email_key on platform_users (lower(email));

do $$
declare
  b uuid;
  t text;
begin
  if exists (select 1 from users) then
    insert into businesses (name, type)
      values (coalesce((select nullif(shop_name, '') from settings order by id limit 1), 'My Shop'), 'grocery')
      returning id into b;
  end if;

  foreach t in array array['users','settings','customers','employees','suppliers','products','locations',
                           'product_stock','shifts','sales','returns','stock_movements','transfers'] loop
    execute format('alter table %I add column if not exists business_id uuid references businesses(id) on delete cascade', t);
    if b is not null then
      execute format('update %I set business_id = $1 where business_id is null', t) using b;
    end if;
  end loop;

  delete from settings where business_id is null;  -- fresh install: the placeholder row from 001
  -- Data that can't be attributed (only possible on an empty install) is removed.
  foreach t in array array['users','customers','employees','suppliers','products','locations',
                           'product_stock','shifts','sales','returns','stock_movements','transfers'] loop
    execute format('delete from %I where business_id is null', t);
    execute format('alter table %I alter column business_id set not null', t);
  end loop;
  alter table settings alter column business_id set not null;
end $$;

-- settings: one row per business
alter table settings drop constraint if exists settings_pkey;
alter table settings drop constraint if exists settings_id_check;
alter table settings drop column if exists id;
alter table settings add primary key (business_id);

-- uniqueness is per business now (two shops may both use barcode 123 or an employee email)
alter table products  drop constraint if exists products_barcode_key;
create unique index if not exists products_biz_barcode_key on products (business_id, barcode) where barcode is not null;
alter table employees drop constraint if exists employees_email_key;
create unique index if not exists employees_biz_email_key on employees (business_id, lower(email));
alter table suppliers drop constraint if exists suppliers_email_key;
create unique index if not exists suppliers_biz_email_key on suppliers (business_id, lower(email));
drop index if exists locations_name_key;
create unique index if not exists locations_biz_name_key on locations (business_id, lower(name));
alter table sales     drop constraint if exists sales_invoice_number_key;
create unique index if not exists sales_biz_invoice_key on sales (business_id, invoice_number);
alter table returns   drop constraint if exists returns_return_number_key;
create unique index if not exists returns_biz_number_key on returns (business_id, return_number);
alter table transfers drop constraint if exists transfers_transfer_number_key;
create unique index if not exists transfers_biz_number_key on transfers (business_id, transfer_number);

-- Composite keys: a row can only point at rows of the SAME business (database-enforced isolation).
alter table products  add constraint products_id_biz_key  unique (id, business_id);
alter table locations add constraint locations_id_biz_key unique (id, business_id);
alter table customers add constraint customers_id_biz_key unique (id, business_id);
alter table users     add constraint users_id_biz_key     unique (id, business_id);
alter table shifts    add constraint shifts_id_biz_key    unique (id, business_id);
alter table sales     add constraint sales_id_biz_key     unique (id, business_id);
alter table suppliers add constraint suppliers_id_biz_key unique (id, business_id);
alter table transfers add constraint transfers_id_biz_key unique (id, business_id);

alter table product_stock   add constraint product_stock_product_biz_fk  foreign key (product_id, business_id)  references products (id, business_id) on delete cascade;
alter table product_stock   add constraint product_stock_location_biz_fk foreign key (location_id, business_id) references locations (id, business_id) on delete cascade;
alter table stock_movements add constraint stock_mv_product_biz_fk  foreign key (product_id, business_id)  references products (id, business_id) on delete cascade;
alter table stock_movements add constraint stock_mv_location_biz_fk foreign key (location_id, business_id) references locations (id, business_id) on delete cascade;
alter table sales           add constraint sales_location_biz_fk foreign key (location_id, business_id) references locations (id, business_id);
alter table sales           add constraint sales_shift_biz_fk    foreign key (shift_id, business_id)    references shifts (id, business_id) on delete set null (shift_id);
alter table sales           add constraint sales_customer_biz_fk foreign key (customer_id, business_id) references customers (id, business_id) on delete set null (customer_id);
alter table sales           add constraint sales_cashier_biz_fk  foreign key (cashier_id, business_id)  references users (id, business_id) on delete set null (cashier_id);
alter table shifts          add constraint shifts_location_biz_fk foreign key (location_id, business_id) references locations (id, business_id);
alter table shifts          add constraint shifts_user_biz_fk     foreign key (user_id, business_id)     references users (id, business_id);
alter table users           add constraint users_location_biz_fk  foreign key (location_id, business_id) references locations (id, business_id) on delete set null (location_id);
alter table transfers       add constraint transfers_from_biz_fk  foreign key (from_location_id, business_id) references locations (id, business_id);
alter table transfers       add constraint transfers_to_biz_fk    foreign key (to_location_id, business_id)   references locations (id, business_id);
alter table returns         add constraint returns_sale_biz_fk    foreign key (sale_id, business_id) references sales (id, business_id);

create index if not exists users_business_idx      on users (business_id);
create index if not exists products_business_idx   on products (business_id, active, name);
create index if not exists customers_business_idx  on customers (business_id, name);
create index if not exists sales_business_date_idx on sales (business_id, date desc);

-- ---------- numbering per business ----------
create table if not exists counters (
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text not null,
  value        bigint not null default 0,
  primary key (business_id, name)
);
insert into counters (business_id, name, value)
  select business_id, 'invoice', coalesce(max(nullif(regexp_replace(invoice_number, '\D', '', 'g'), '')::bigint), 0) from sales group by business_id
  on conflict do nothing;
insert into counters (business_id, name, value)
  select business_id, 'return', coalesce(max(nullif(regexp_replace(return_number, '\D', '', 'g'), '')::bigint), 0) from returns group by business_id
  on conflict do nothing;
insert into counters (business_id, name, value)
  select business_id, 'transfer', coalesce(max(nullif(regexp_replace(transfer_number, '\D', '', 'g'), '')::bigint), 0) from transfers group by business_id
  on conflict do nothing;

-- ---------- payments: every money movement ----------
alter table sales drop constraint if exists sales_payment_method_check;
alter table sales add constraint sales_payment_method_check check (payment_method in ('Cash','Card','Bank','Split','Installment'));
alter table returns drop constraint if exists returns_refund_method_check;
alter table returns add constraint returns_refund_method_check check (refund_method in ('Cash','Card','Bank','Credit'));

create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  location_id  uuid,
  shift_id     uuid,
  user_id      uuid,
  sale_id      uuid,
  return_id    uuid references returns(id) on delete set null,
  kind         text not null check (kind in ('sale','void','refund','installment','deposit','deposit_refund')),
  method       text not null check (method in ('Cash','Card','Bank','TradeIn','Credit','Deposit')),
  amount       numeric(12,2) not null,
  reference    text,
  created_at   timestamptz not null default now(),
  foreign key (location_id, business_id) references locations (id, business_id),
  foreign key (shift_id, business_id)    references shifts (id, business_id) on delete set null (shift_id),
  foreign key (user_id, business_id)     references users (id, business_id) on delete set null (user_id),
  foreign key (sale_id, business_id)     references sales (id, business_id) on delete set null (sale_id)
);
create index if not exists payments_shift_idx on payments (shift_id);
create index if not exists payments_biz_date_idx on payments (business_id, created_at desc);
create index if not exists payments_sale_idx on payments (sale_id);

-- Existing history becomes ledger rows so cash-ups stay correct.
insert into payments (business_id, location_id, shift_id, user_id, sale_id, kind, method, amount, created_at)
  select business_id, location_id, shift_id, cashier_id, id, 'sale', payment_method, total_amount, date from sales;
insert into payments (business_id, location_id, shift_id, user_id, sale_id, kind, method, amount, created_at)
  select business_id, location_id, shift_id, voided_by, id, 'void', payment_method, -total_amount, coalesce(voided_at, date)
    from sales where payment_status = 'Voided';
insert into payments (business_id, location_id, shift_id, user_id, sale_id, return_id, kind, method, amount, created_at)
  select r.business_id, r.location_id, r.shift_id, r.user_id, r.sale_id, r.id, 'refund', r.refund_method, -r.refund_amount, r.created_at from returns r;

-- ---------- till upgrades ----------
alter table sale_items add column if not exists discount numeric(12,2) not null default 0 check (discount >= 0);
alter table sales add column if not exists approved_by uuid;
alter table users add column if not exists approval_pin text;   -- bcrypt hash of a manager's approval PIN

alter table businesses     enable row level security;
alter table platform_users enable row level security;
alter table counters       enable row level security;
alter table payments       enable row level security;

-- generic link from a stock movement to a repair job / supplier claim (used by later features)
alter table stock_movements add column if not exists ref_id uuid;
