# What changed

## Database: MongoDB → Supabase (PostgreSQL)
- `server/schema.sql` defines all tables. The server creates them automatically on first start.
- Checkout is one database transaction: the sale, its items and every stock deduction are saved together, or nothing is saved.
- Stock can never go below zero. The database itself enforces it.
- Voiding a sale (and returning its stock) is also one transaction, and a sale can't be voided twice.
- Deleting a product or customer keeps old sales and invoices intact.
- Row Level Security is turned on for every table, so Supabase's public API can't read your data. Only your server can.
- Setup: see **SETUP.md**.

## Security
- The old MongoDB password and login key that were in the code have been removed. Settings now live in `server/.env` (never committed). Since you no longer use that MongoDB database, delete the old cluster (or at least the `MAM_store` user) in MongoDB Atlas.
- Every API route except login needs a valid login token.
- Only the first account (the owner) can sign up freely. After that, staff are added from "Add User".

## Checkout and stock
- Fixed the crash that made every sale fail.
- Prices come from the database, not the browser.
- Walk-in or registered customers, discount %, tax %, numbered invoices (INV-000001…), invoice opens after checkout and prints.
- The till warns before you exceed stock. The server refuses oversells, even from two tills at once.
- Barcode lookup searches all products.

## Sales are voided, not deleted
- Void needs a reason, keeps the record, returns the stock and shows VOIDED on the invoice.
- Each sale records the cashier.

## Still to do
- Roles (owner vs cashier)
- Offline mode, thermal receipt printer, cash drawer
- Reports/dashboard, returns, end-of-day cash-up
