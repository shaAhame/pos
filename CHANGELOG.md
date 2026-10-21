# Changelog

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
