# Putting your own shop online (Railway)

This is for running the POS for **one business of your own** — your phone shop and its
branches — on the internet, so every branch uses the same system from anywhere.

It is the same POS as the client platform, started in single-shop mode: you set your shop
name, branches and owner login as settings, and the shop is created the first time it starts.
There is no client portal in this mode; you run everything from inside the shop.

---

## Before you start

You need:
- A **Railway** account (the $5 Hobby plan is enough — see *What this costs* below).
- This folder on your computer.
- Node.js installed (you already have it).

---

## What this costs

The Hobby plan is **$5 a month and includes $5 of usage**. Usage above that is charged extra.
A POS for a few branches is small, but a database running 24 hours a day uses a good part of
that $5 on its own.

**Two ways to set it up:**

| | Where the database lives | Monthly cost | Good when |
|---|---|---|---|
| **A** | Railway Postgres | Usually near or a little over the $5 credit | You want everything in one place |
| **B** | Supabase free database, app on Railway | Usually inside the $5 credit | You want to stay within the $5 |

You already have a Supabase account from the first POS, so **B** is the cheaper option and
costs nothing extra. Both are set up the same way; only `DATABASE_URL` differs.

Watch your usage for the first week under **Railway → your project → Usage**.

---

## Step 1: Install the Railway command line

In Terminal:

```
npm install -g @railway/cli
railway login
```

A browser window opens; sign in there.

## Step 2: Create the project

Go into this folder (the one with `railway.json` in it), then:

```
railway init
```

Give it a name, for example `idealz-pos`.

## Step 3: Set up the database

**Option A — Railway's own database:**

```
railway add --database postgres
```

Then, when setting the variables in step 4, use this for the database:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Railway fills that in for you. It connects over its own private network, so it is fast and
does not count as internet traffic.

**Option B — your existing Supabase (free):**

In Supabase: your project → **Connect** → **Session pooler** → copy the connection string and
put your database password in place of `[YOUR-PASSWORD]`. Use that as `DATABASE_URL`.

Either way, the POS works out the right security settings for the database by itself.

## Step 4: Your settings

Open **Railway → your project → the service → Variables**, and add these.
Change every value to your own.

```
DATABASE_URL      = (from step 3)
JWTPRIVATEKEY     = (a long random value - see below)
TRUST_PROXY       = 1

SHOP_NAME         = Idealz Lanka
SHOP_TYPE         = electronics
SHOP_PHONE        = 077 866 2627
SHOP_ADDRESS      = 45 Galle Road, Colombo 03
SHOP_CURRENCY     = Rs.
SHOP_TIMEZONE     = Asia/Colombo

BRANCHES          = Colombo 03,Kandy,Galle
WAREHOUSES        = Main warehouse

OWNER_NAME        = Shakeeb Ahamed
OWNER_EMAIL       = you@mecquad.tech
OWNER_PASSWORD    = (a strong password you choose)
```

Make the `JWTPRIVATEKEY` by running this on your computer and copying the result:

```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Notes:
- `BRANCHES` are shops that sell. `WAREHOUSES` only hold stock and cannot sell.
  Separate them with commas. You can add or rename branches later inside the POS.
- `OWNER_PASSWORD` needs at least 8 characters with capitals, small letters and numbers.
  It is used **once**, to create your login. Change it in the POS afterwards and the
  setting no longer matters.
- `SHOP_TYPE` can be `electronics`, `grocery` or `general`. `electronics` switches on
  IMEI tracking, warranty, repairs, installments, orders, trade-ins and supplier claims.

## Step 5: Send it up

```
railway up
```

The first build takes a few minutes. When it finishes, open **Deployments → View logs**.
You should see:

```
Connected to database
Created "Idealz Lanka" (electronics) with branches: Colombo 03 (store), Kandy (store), Galle (store), Main warehouse (warehouse)
Owner login: you@mecquad.tech - use the password you set in OWNER_PASSWORD
POS server running on http://localhost:8080
```

## Step 6: Get your web address

**Settings → Networking → Generate Domain.** You get something like
`idealz-pos-production.up.railway.app`.

Open it, log in with your owner email and password, and the shop is ready.

To use your own address such as `pos.mecquad.tech`, use **Custom Domain** on the same page
and add the CNAME record it gives you at your domain provider.

---

## After it is running

1. **Change your password**: Account → Change password.
2. **Add your staff**: Staff logins → Add staff login. Each person is tied to one branch;
   cashiers sell, managers also handle returns, stock and reports.
3. **Add your products**: for phones, tick *Track each unit by serial / IMEI number*
   and set the warranty months. Enter one IMEI per line when stock comes in.
4. **Stock your branches**: put opening stock in one branch, then use **Transfers** to send
   units to the others. Only the owner can transfer.
5. **Check the receipt**: make a test sale and confirm the shop name, address and phone are right.
   Change them under Shop settings.

## Redeploying

Run `railway up` again. Your data is safe: the shop is only created when there isn't one,
so a redeploy never overwrites anything. Database changes are applied automatically.

## Backups

Your sales and stock live in the database, not in this folder.

- **Railway Postgres**: your project → Postgres → Backups.
- **Supabase**: Database → Backups.

Take a backup before any big change. On a free Supabase project, check how long backups are
kept — download your own copy regularly if you rely on it.

## If something goes wrong

| What you see | What it means |
|---|---|
| `Missing settings: DATABASE_URL, JWTPRIVATEKEY` | Those variables aren't set on the service. |
| `Shop setup failed: OWNER_PASSWORD needs ...` | The password is too weak; make it longer with capitals and numbers. |
| `Shop setup failed: SHOP_TYPE must be one of ...` | Use `electronics`, `grocery` or `general`. |
| `Database connection error` | `DATABASE_URL` is wrong, or the database is asleep or still starting. |
| The page loads but login fails | Use the owner email exactly as you typed it in the variables. |
| You forgot the password | Run `node server/reset-password.js` with the same `DATABASE_URL` set. |

To see what is happening at any time: **Deployments → View logs**, or `railway logs`.

---

## Keeping this separate from the client platform

This install runs **only your shop**. The MecQuad client platform (the one that manages
other shops as customers) is a separate deployment with its own database, and `SHOP_NAME`
is not set there.

Never point both at the same database.
