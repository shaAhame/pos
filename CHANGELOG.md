# Changelog

## 3.0.0
One system for many client businesses, run by MacQuad from the new platform page (/platform): add clients
(grocery, electronics or general), switch features on per client, suspend/reactivate, reset owner passwords. Each
business's data is isolated and enforced by the database.
New for electronics shops: serial/IMEI tracking per unit, warranty periods and lookup, variants, repair job cards with
parts and warranty detection, supplier warranty claims, installment plans with collections and late tracking, advance
orders with deposits, trade-ins. New at every till: split payments, discounts per item, manager PIN approval for large
discounts. All money now goes through one payments ledger. Existing data becomes the first business automatically.

## 2.1.0
Multiple branches: shops and warehouses, stock per branch, owner-only stock transfers with receiving and shortage
records, staff tied to a branch, branch picker for the owner, branch comparison in reports, branch address on receipts.
Existing data moves into "Main store" automatically. The start scripts now rebuild the screens after an update.

## 2.0.0
Complete rebuild for real shop use: PostgreSQL/Supabase, staff roles, shifts and blind cash-up, returns, voids with audit,
stock receiving/counts with history, offline selling with sync, reports and CSV, 80mm receipts, shop settings,
security hardening, migrations, automated tests (42 server and 12 client), and a new interface.

## 1.1.0
Fixed checkout crash, stock deduction, server-side login checks, removed committed passwords.
