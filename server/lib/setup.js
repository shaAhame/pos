// Single-shop mode: create the shop, its branches and the owner login on first start,
// from environment settings. Used when the POS is hosted for one business of your own
// (e.g. your phone shop chain on Railway) instead of running as the MecQuad client platform.
//
// It runs only when SHOP_NAME is set, and only while no business exists yet, so
// redeploying never touches live data.
const bcrypt = require("bcrypt");
const { tx } = require("./db");
const { PRESETS } = require("./features");

const SALT = () => Number(process.env.SALT) || 10;
const clean = (v) => (typeof v === "string" ? v.trim() : "");
const list = (v) => clean(v).split(",").map((s) => s.trim()).filter(Boolean);

// Same rule the POS enforces elsewhere: 8+ characters, 3 of lower/upper/number.
function weakPassword(pw) {
  if (!pw || pw.length < 8) return "at least 8 characters";
  if ([/[a-z]/, /[A-Z]/, /[0-9]/].filter((re) => re.test(pw)).length < 3)
    return "small letters, capital letters and numbers";
  return null;
}

function readConfig(env = process.env) {
  const name = clean(env.SHOP_NAME);
  if (!name) return null;

  const type = clean(env.SHOP_TYPE) || "electronics";
  if (!PRESETS[type]) throw new Error(`SHOP_TYPE must be one of: ${Object.keys(PRESETS).join(", ")}`);

  const email = clean(env.OWNER_EMAIL).toLowerCase();
  const password = env.OWNER_PASSWORD || "";
  if (!email || !email.includes("@")) throw new Error("OWNER_EMAIL must be a real email address");
  const weak = weakPassword(password);
  if (weak) throw new Error(`OWNER_PASSWORD needs ${weak}`);

  const owner = clean(env.OWNER_NAME) || "Shop Owner";
  const [firstName, ...rest] = owner.split(/\s+/);

  const branches = list(env.BRANCHES);
  const warehouses = list(env.WAREHOUSES);
  if (!branches.length) branches.push("Main shop");

  const dupes = [...branches, ...warehouses].filter((n, i, a) => a.indexOf(n) !== i);
  if (dupes.length) throw new Error(`Branch names must be different from each other: ${dupes.join(", ")}`);

  return {
    name, type, email, password,
    firstName, lastName: rest.join(" ") || "Owner",
    branches, warehouses,
    address: clean(env.SHOP_ADDRESS),
    phone: clean(env.SHOP_PHONE),
    currency: clean(env.SHOP_CURRENCY) || "Rs.",
    timezone: clean(env.SHOP_TIMEZONE) || "Asia/Colombo",
    receiptFooter: clean(env.RECEIPT_FOOTER) || "Keep this receipt for warranty claims.",
  };
}

// Returns a short description of what happened, for the start-up log.
async function autoSetup(env = process.env) {
  const cfg = readConfig(env);
  if (!cfg) return null;

  return tx(async (db) => {
    // Lock so two containers starting at once can't both create the shop.
    await db.query("lock table businesses in exclusive mode");
    const { rows: existing } = await db.query("select name from businesses limit 1");
    if (existing.length) return { created: false, name: existing[0].name };

    const { rows: [biz] } = await db.query(
      "insert into businesses (name, type, plan, features) values ($1,$2,'self-hosted','{}'::jsonb) returning id",
      [cfg.name, cfg.type]
    );
    await db.query(
      `insert into settings (business_id, shop_name, address, phone, email, currency, timezone, receipt_footer)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [biz.id, cfg.name, cfg.address, cfg.phone, cfg.email, cfg.currency, cfg.timezone, cfg.receiptFooter]
    );

    const made = [];
    for (const [names, kind] of [[cfg.branches, "store"], [cfg.warehouses, "warehouse"]]) {
      for (const n of names) {
        await db.query("insert into locations (business_id, name, type) values ($1,$2,$3)", [biz.id, n, kind]);
        made.push(`${n} (${kind})`);
      }
    }

    // The owner is not tied to one branch: they switch between them in the top bar.
    await db.query(
      `insert into users (business_id, first_name, last_name, email, password, role, location_id)
       values ($1,$2,$3,$4,$5,'owner',null)`,
      [biz.id, cfg.firstName, cfg.lastName, cfg.email, await bcrypt.hash(cfg.password, SALT())]
    );

    return { created: true, name: cfg.name, type: cfg.type, email: cfg.email, branches: made };
  });
}

// Single-shop installs don't need the client-management portal, so it is switched
// off unless explicitly asked for.
const singleShop = (env = process.env) => !!clean(env.SHOP_NAME);
const platformEnabled = (env = process.env) => env.ENABLE_PLATFORM === "1" || !singleShop(env);

module.exports = { autoSetup, readConfig, weakPassword, singleShop, platformEnabled };
