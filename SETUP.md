# MAM Stores POS: setup guide (Supabase)

The app has two parts that both run on your computer (or a server):
- **server**: talks to the database (Supabase)
- **client**: the screens you use in the browser

## 1. Install Node.js
Download the **LTS** version from https://nodejs.org and install it.
Check: open a terminal / Command Prompt and type `node -v`. It should show a version number.

## 2. Create the Supabase database
1. Go to https://supabase.com and sign in (or create a free account).
2. Click **New project**.
   - Name: `mam-pos` (anything is fine)
   - **Database password**: click *Generate a password*, then **copy it somewhere safe**. You need it in step 3.
   - Region: pick the closest one to Sri Lanka (e.g. *South Asia (Mumbai)* or *Singapore*).
3. Wait a minute or two for the project to finish setting up.
4. Click **Connect** (top of the project page). Under **Connection string**, choose **Session pooler**,
   then copy the string. It looks like:
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`

   Use the *Session pooler* one. The "Direct connection" usually doesn't work on home and office internet (it needs IPv6).

You don't need to create any tables. The server creates them automatically the first time it starts.
(If you'd rather do it by hand: Supabase → **SQL Editor** → paste `server/schema.sql` → **Run**.)

## 3. Create the settings file
1. In the `server` folder, copy `.env.example` and name the copy **`.env`**.
   On Windows, make sure it isn't saved as `.env.txt`.
2. Open `.env` in Notepad and fill in:
   ```
   DATABASE_URL=the connection string from step 2, with [YOUR-PASSWORD] replaced by your real password
   PORT=5000
   JWTPRIVATEKEY=any long random text (at least 40 characters)
   SALT=10
   ```
   Remove the square brackets too: `...:MyPass123@aws-0...`, not `...:[MyPass123]@aws-0...`.
   If the password contains symbols like `@ # / :`, generate a new one with only letters and numbers. It's easier.
3. Save. **Never share this file or upload it to GitHub.**

## 4. Start the server
```
cd server
npm install
npm start
```
Wait for **"Connected to database"**. Leave this window open.

## 5. Start the app (in a second terminal)
```
cd client
npm install
npm start
```
Your browser opens at http://localhost:3000.

## 6. First use and a quick test
1. **Sign up** to create the owner account. Only the first account can be created this way.
2. **Log in**.
3. **Product**: add 2–3 products with price, quantity and barcode.
4. **Sales**: scan or pick products, then **Checkout**. The invoice opens.
5. **Product**: check that the stock went down.
6. **Bills**: **Void** the test sale, then check that the stock came back.

Staff accounts: **Add User** in the sidebar (while logged in).

In Supabase → **Table Editor** you can see all your data (products, sales, sale_items, …).

## Troubleshooting
| Message | Fix |
|---|---|
| `DATABASE_URL is not set` | The file isn't named exactly `.env`, or it isn't in the `server` folder. |
| `password authentication failed` | Wrong password in DATABASE_URL, or the `[ ]` brackets are still there. Reset it in Supabase → Project Settings → Database. |
| `ENOTFOUND` / `ENETUNREACH` / timeout | You copied the *Direct connection* string. Use **Session pooler**. |
| `Tenant or user not found` | The user part must look like `postgres.abcdefgh` (with your project ID), as shown in Supabase. |
| Project paused | Free Supabase projects pause after a period of no use. Open the project in Supabase and click **Restore**. |
