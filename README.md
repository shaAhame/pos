# Shop POS

Point of sale for small shops: barcode till with cash change, shifts and cash-up, returns and voids,
stock receiving and counts with full history, staff roles, reports with CSV export, and offline selling
that syncs when the connection returns.

- **Shop owners:** start with [SETUP.md](SETUP.md), then [USER-GUIDE.md](USER-GUIDE.md).
- **Developers:** read on.

## Stack
- `server/`: Node 18+, Express 5, PostgreSQL (Supabase in production) via `pg`. Joi validation, JWT auth, helmet, rate-limited login.
- `client/`: React 18 + Vite, React Router 7. No UI framework; the design system lives in `src/styles.css`.
- In production the server also serves `client/dist`, so it runs as one process on one port.

## Run for development
```
npm run setup                       # install both packages
cp server/.env.example server/.env  # fill in DATABASE_URL and JWTPRIVATEKEY
npm run dev:server                  # API on :5000 (restarts on change)
npm run dev:client                  # app on :3000, proxies /api to :5000
```

## Tests
```
cd client && npm test                                                    # money maths, offline queue
cd server && TEST_DATABASE_URL=postgresql://.../pos_test npm test        # 56 API tests
```
The server tests **wipe** the test database at the start of each file and refuse to run unless the URL contains `test`.
CI runs both on every push (`.github/workflows/test.yml`).

## Design decisions
- **Money is computed on the server.** The till sends product IDs and quantities only, and the server prices them. `client/src/lib/money.js` mirrors `server/lib/sales.js` so the screen matches the receipt; a unit test pins them together.
- **Checkout is one transaction.** Product rows are locked in a fixed order (`select ... for update order by id`), so concurrent tills can't oversell or deadlock. The database also enforces `quantity >= 0`.
- **Idempotent sales.** The till generates a `clientRef` UUID per sale, so retries and offline re-uploads can never double-record.
- **Offline sales are always accepted.** The customer already paid. If stock was short, or the price changed meanwhile, the sale is recorded and flagged (`offline_note`, `offline_shortfall` stock movement) for a manager to review, instead of being rejected.
- **Stock only changes through movements** (`stock_movements`): initial, sale, void, return, receive, adjust, offline_shortfall. Product edits can't change quantity.
- **Voids vs returns.** A void is allowed only while the sale's shift is open; after cash-up, use a return. This keeps closed cash-ups correct.
- **Blind cash-up.** Cashiers don't see the expected drawer amount until they've entered their count.
- **Roles are checked on every request** against the database, so disabling a user or changing a role takes effect immediately.
- **RLS is enabled with no policies** on every table, so Supabase's public REST API can't read anything. Only the server, connecting as the database owner, has access.
- **Branches.** `locations` (shops and warehouses) with stock in `product_stock (product_id, location_id)`. Products and
  prices are global. Staff belong to one location; the owner sends `X-Location-Id` to choose one (none = all branches).
  Scoping is enforced server-side in every route, not just hidden in the UI.
- **Transfers** take stock out of the source immediately (status `in_transit`), add only what the destination confirms
  (`transfer_in`), and record shortages (`transfer_short`). The owner can cancel while in transit (`transfer_cancel`).
- **Migrations** are numbered SQL files in `server/migrations`, applied once each at start-up under an advisory lock.

## Deploying elsewhere
`docker build -t shop-pos . && docker run -p 5000:5000 --env-file server/.env shop-pos`
Behind a hosting proxy (Render, Railway, etc.), also set `TRUST_PROXY=1`.
