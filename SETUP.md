# Setup guide

This gets the POS running in a shop. Allow about 30 minutes the first time.

## What you need
- A Windows, Mac or Linux computer for the counter. This is the **main till**: it runs the POS server.
- Internet for that computer. Short outages are fine (see "When the internet drops" below).
- A free **Supabase** account (the database), at https://supabase.com
- Optional: a USB barcode scanner (any "keyboard" type works with no setup) and an 80mm receipt printer.

## 1. Install Node.js
Download the **LTS** version from https://nodejs.org and install it with the default options.

## 2. Create the database in Supabase
1. Sign in at https://supabase.com and click **New project**.
2. Choose a name (e.g. `mam-pos`). Click **Generate a password**, then **save the password somewhere safe**.
   Region: the closest to you (for Sri Lanka, *Mumbai* or *Singapore*).
3. When the project is ready, click **Connect** at the top. Under **Connection string**, choose **Session pooler** and copy it.
   It looks like `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`

Use the **Session pooler** string. The "Direct connection" one usually doesn't work on normal internet connections.

You don't need to create tables; the POS does that itself.

## 3. Create the settings file
1. Unzip the POS folder somewhere permanent, e.g. `C:\POS`.
2. In the `server` folder, copy `.env.example` and name the copy `.env`.
   On Windows, turn on *View → File name extensions* so it isn't secretly saved as `.env.txt`.
3. Open `.env` in Notepad and fill in two lines:
   - `DATABASE_URL=` paste the connection string, replacing `[YOUR-PASSWORD]` with your password (remove the brackets too).
   - `JWTPRIVATEKEY=` a long random secret. Open Command Prompt and run
     `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`, then paste the result.
4. Save. Never share this file.

## 4. Start it
- **Windows:** double-click `start-pos.bat`.
- **Mac/Linux:** run `./start-pos.sh` in a terminal.

The first start installs and builds everything (needs internet, a few minutes). Then the browser opens at
**http://localhost:5000**. Keep the black window open while the shop is open; closing it stops the POS.

## 5. First use
### a) Set up the MacQuad platform (once)
This POS is one system that runs many client businesses, grocery or electronics. MacQuad manages them all from
the platform page.
1. Open **http://localhost:5000/platform** and create the first **MacQuad admin** account. This only happens once.
2. Click **Add business**: business name, type (Grocery, Electronics / mobile phones, or General), and the owner's
   name, email and temporary password. Each business gets its own products, staff, branches, sales and settings,
   and can never see another business's data.
3. Open a business to switch its **features** on or off: serial/IMEI numbers, warranty, variants, repairs, supplier
   claims, installments, advance orders, trade-ins, split payments, item discounts. The type sets sensible defaults;
   change anything a client asks for.
4. **Suspend** a business (e.g. unpaid subscription) to log its staff out at once; **Reactivate** to restore it.
5. Give the owner their email and password. They log in at the normal address (**/login**).

If you upgraded from version 2, your existing shop is already the first business, and every existing login still
works. You only need to do step 1.

### b) In each business (the owner)
1. Log in at **/login** with the owner account the platform created.
2. **Shop settings**: address, phone, receipt message, tax %, the maximum discount a cashier may give.
3. **Staff logins**: add an account for each person (Cashier or Manager).
4. **Suppliers** (optional), then **Products**: add products with price, cost price, barcode and opening stock.
5. Do a test sale: **Till** → open a shift → sell → **Sales** → void it (as a manager).

## Extra tills in the same shop
Other computers or tablets on the same Wi-Fi can use the POS through the main till:
1. On the main till, find its local IP address (Windows: run `ipconfig`, look for *IPv4 Address*, e.g. `192.168.1.20`).
2. On the other device, open `http://192.168.1.20:5000` in Chrome or Edge.
3. If it doesn't load, allow Node.js through the Windows Firewall on the main till (Windows asks the first time; choose *Private networks*).

Give the main till a fixed IP address in your router settings so the address doesn't change.

## Several branches in different places
Tills in the same shop can share the main till (above). Branches in **different towns** can't reach a computer inside
another shop, so for several branches run the POS on a small **online server** instead, and every branch opens its web
address in Chrome. Any host that runs a Docker app works (for example Render or Railway): use the included `Dockerfile`,
set the same values as in `server/.env` in the host's settings (plus `TRUST_PROXY=1`), and use an `https://` address.
Then add your branches on the **Branches** page. Each branch keeps selling offline if its own internet drops.

## Start automatically when the computer turns on (Windows)
Press `Win + R`, type `shell:startup`, press Enter, and put a **shortcut** to `start-pos.bat` in that folder.

## Receipt printer and cash drawer
- Install the printer's Windows driver and set it as the **default printer**. In its *Printing preferences*, choose **80mm** paper.
- Most cash drawers plug into the receipt printer and open when it prints. Turn on "open cash drawer" (sometimes called *peripheral* or *cash drawer kick*) in the printer driver settings.
- For one-click printing with no dialog, start Chrome with `--kiosk-printing` (add it to the shortcut that opens the POS).

## Card payments
The POS records card sales; the card itself is charged on your bank's card machine as usual.

## When the internet drops
The till keeps selling. Sales are saved on that device and uploaded automatically when the connection returns
(the top bar shows **Offline (3 waiting)** meanwhile). Rules:
- Don't clear the browser's data or use a private window while sales are waiting.
- Logging in needs a connection, so stay logged in during the day.
- If an offline sale sold more than the recorded stock, it's flagged. **Reports** and **Sales → Offline sales only** show what to check.

## Backups
- Supabase keeps your data in the cloud. In Supabase, **Database → Backups** shows what your plan includes; plans differ, so check it.
- Every week, download **Reports → Download sales (CSV)** for your own records.
- Full copy of everything (needs PostgreSQL tools installed): `pg_dump "<your DATABASE_URL>" > pos-backup.sql`

## Updating to a new version
1. Close the POS window.
2. Replace the folder's contents with the new version, but **keep your `server/.env`**.
3. Start the POS again. The screens are rebuilt and database changes are applied automatically.
   If the new version says it needs new packages, run `npm run setup` once first.

## Troubleshooting
| What you see | What to do |
|---|---|
| `Port 5000 is already used` (common on Mac: AirPlay Receiver) | Put `PORT=5050` in `server/.env` and open http://localhost:5050 instead. |
| `Database connection error: Invalid URL` | Your database password has a symbol such as `#`, `@`, `/` or `?`. Write it percent-encoded in DATABASE_URL (`#` → `%23`, `@` → `%40`, `/` → `%2F`, `?` → `%3F`), or reset it in Supabase to one with only letters and numbers. |
| `Missing settings in server/.env` | The file isn't named exactly `.env`, or isn't in the `server` folder. |
| `JWTPRIVATEKEY ... must be a long random value` | Generate one as in step 3. |
| `password authentication failed` | Wrong password in DATABASE_URL, or the `[ ]` brackets are still there. Reset it in Supabase → Project Settings → Database. |
| `ENOTFOUND`, `ENETUNREACH`, or a timeout | You copied the *Direct connection* string. Use **Session pooler**. |
| `Tenant or user not found` | The user part must be `postgres.<your project id>` exactly as Supabase shows it. |
| The top bar says **Offline** but the internet works | The Supabase project may be paused (free projects pause after a period of no use). Open it in Supabase and click **Restore**. |
| Forgot the owner password | Another owner can reset it in **Staff logins**. If there's no other owner, ask your developer to reset it in the database. |
