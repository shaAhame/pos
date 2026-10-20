# Critical fixes (October 2026)

## 1. Before you run it: new passwords (do this first)
The old MongoDB password and login-signing key were committed in `server/.env` and `server/db.js`.
Treat them as public:

1. In MongoDB Atlas → Database Access, change the password for user `MAM_store` (or create a new user and delete the old one).
2. Copy `server/.env.example` to `server/.env` and fill in the new connection string.
3. Set `JWTPRIVATEKEY` to a new random value:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   (Everyone will have to log in again. That is expected.)
4. If this repo is on GitHub, the old `.env` is still in the git history. Changing the password (step 1) is what actually protects you.

`.env` and `node_modules` are now in `.gitignore`.

## 2. Checkout works
- Fixed the crash (`customerId is not defined`) that made every sale fail.
- Prices are taken from the database, not from the browser, so a sale can't be tampered with.
- Walk-in customers: type a name or leave it blank. Registered customers: pick from the search list.
- Discount % and tax % can be entered at the till.
- Invoice numbers run in order: INV-000001, INV-000002, …
- After checkout the invoice opens, ready to print. Printing was also fixed (react-to-print v3).
- Added the missing `react-toastify` package, so the sales page builds.

## 3. Stock is deducted
- Each sale reduces stock. A sale is refused with a clear message if there isn't enough stock.
- Safe with two tills at once: the last item can't be sold twice.
- If any line of a sale fails, stock already taken for the other lines is put back.
- The till warns if you add more than is in stock.
- Barcode scanning looks up the product on the server, so every product is found. Before, only the first 10 products were searchable.
- Products without a barcode no longer clash with each other.

## 4. Sales are voided, not deleted
- Bills page: "Delete" is now "Void". It needs a reason, keeps the record, marks it VOIDED (also on the invoice) and returns the stock.
- The server refuses to delete sales.
- Each sale records which user (cashier) made it.

## 5. Login is checked on the server
- Every API route except login now requires a valid login token. Before, anyone could read or change all data without logging in.
- Only the first account (the shop owner) can sign up freely. After that, a logged-in user adds staff from "Add User" in the sidebar.
- When a session expires, the app goes back to the login page.
- Removed hard-coded `localhost` URLs, so the app works when deployed.

## Note for existing data
Sales saved before this update still show correctly. Item names are looked up from the products.
New sales also store the item name, so old invoices stay correct if a product is renamed or deleted.

## Still to do (not part of this fix)
- Roles (owner vs cashier, e.g. only owners can void or see salaries)
- Offline mode, thermal receipt printer and cash drawer
- Reports/dashboard, returns/refunds, end-of-day cash-up
