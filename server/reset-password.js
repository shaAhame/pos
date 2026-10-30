#!/usr/bin/env node
// Reset a forgotten password, straight against the database.
//
//   node reset-password.js                      list every login
//   node reset-password.js <email> <password>   set a new password for that login
//
// Works for MecQuad platform admins and for shop staff (owner, manager, cashier).
// Run it from the server folder, with the same .env the POS uses.

require("dotenv").config({ path: __dirname + "/.env" });
const bcrypt = require("bcrypt");
const { createPool, query, close } = require("./lib/db");

const SALT = () => Number(process.env.SALT) || 10;

// Same rule the POS enforces: 8+ characters, with at least 3 of
// lower case / upper case / number.
function checkPassword(pw) {
  if (!pw || pw.length < 8) return "at least 8 characters";
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((re) => re.test(pw)).length;
  if (kinds < 3) return "a mix of small letters, capital letters and numbers";
  return null;
}

async function list() {
  const { rows: admins } = await query(
    "select name, email, active from platform_users order by created_at"
  );
  const { rows: staff } = await query(
    `select u.first_name || ' ' || u.last_name as name, u.email, u.role, u.active, b.name as business
       from users u join businesses b on b.id = u.business_id
      order by b.name, u.role, u.email`
  );

  console.log("\nMecQuad platform logins (these open /platform):");
  if (!admins.length) console.log("  none yet - open /platform to create the first one");
  for (const a of admins) console.log(`  ${a.email}${a.active ? "" : "  (disabled)"}   ${a.name}`);

  console.log("\nShop logins (these open /login):");
  let current = null;
  for (const s of staff) {
    if (s.business !== current) { current = s.business; console.log(`  ${current}`); }
    console.log(`    ${s.email}${s.active ? "" : "  (disabled)"}   ${s.name}, ${s.role}`);
  }
  console.log("\nTo set a new password:");
  console.log("  node reset-password.js <email> <new password>\n");
}

async function reset(email, password) {
  const problem = checkPassword(password);
  if (problem) {
    console.error(`\nThat password is too weak. It needs ${problem}.\n`);
    process.exitCode = 1;
    return;
  }
  const hash = await bcrypt.hash(password, SALT());

  const admin = await query(
    "update platform_users set password = $2, active = true where lower(email) = lower($1) returning name",
    [email, hash]
  );
  if (admin.rows.length) {
    console.log(`\nDone. ${admin.rows[0].name} can now log in at /platform with this password.\n`);
    return;
  }

  const user = await query(
    `update users set password = $2, active = true where lower(email) = lower($1)
      returning first_name || ' ' || last_name as name, role`,
    [email, hash]
  );
  if (user.rows.length) {
    console.log(`\nDone. ${user.rows[0].name} (${user.rows[0].role}) can now log in at /login with this password.\n`);
    return;
  }

  console.error(`\nNo login found for "${email}". Run it with no arguments to see every login.\n`);
  process.exitCode = 1;
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("\nNo DATABASE_URL found. Run this from the server folder, where the .env file is.\n");
    process.exit(1);
  }
  createPool();
  try {
    const [email, ...rest] = process.argv.slice(2);
    if (!email) await list();
    else await reset(email, rest.join(" "));
  } catch (err) {
    console.error("\nCouldn't reach the database:", err.message, "\n");
    process.exitCode = 1;
  } finally {
    await close();
  }
})();
