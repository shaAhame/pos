const router = require("express").Router();
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const passwordComplexity = require("joi-password-complexity");
const { query, tx } = require("../lib/db");
const { Joi, validate, text } = require("../lib/validate");
const { requireAuth, signToken } = require("../middleware/auth");
const { fail } = require("../lib/errors");

const SALT = () => Number(process.env.SALT) || 10;
// Used when the email doesn't exist, so a login takes the same time either way.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);
const strongPassword = passwordComplexity({ min: 8, max: 72, lowerCase: 1, upperCase: 1, numeric: 1, symbol: 0, requirementCount: 3 }).label("Password");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many login attempts. Wait 15 minutes and try again." },
});

const publicUser = (u) => ({ _id: u.id, firstName: u.first_name, lastName: u.last_name, email: u.email, role: u.role, locationId: u.location_id || null });

// Is this a brand-new install with no accounts yet?
router.get("/status", async (req, res) => {
  const { rows } = await query("select exists(select 1 from users) as any");
  res.json({ needsSetup: !rows[0].any });
});

// First-time setup: create the owner account. Only works while there are no users.
router.post(
  "/setup",
  loginLimiter,
  validate(Joi.object({
    firstName: text(60).required(), lastName: text(60).required(),
    email: Joi.string().trim().email().max(200).required(), password: strongPassword.required(),
    shopName: text(120).allow(""),
  })),
  async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, SALT());
    const user = await tx(async (db) => {
      await db.query("lock table users in exclusive mode");
      const { rows } = await db.query("select exists(select 1 from users) as any");
      if (rows[0].any) fail(409, "Setup is already done. Please log in.");
      const { rows: created } = await db.query(
        `insert into users (first_name, last_name, email, password, role) values ($1,$2,$3,$4,'owner') returning *`,
        [req.body.firstName, req.body.lastName, req.body.email, hash]
      );
      if (req.body.shopName) await db.query("update settings set shop_name = $1, updated_at = now() where id = 1", [req.body.shopName]);
      return created[0];
    });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  }
);

// Login
router.post(
  "/login",
  loginLimiter,
  validate(Joi.object({ email: Joi.string().trim().email().required(), password: Joi.string().required() })),
  async (req, res) => {
    const { rows } = await query("select * from users where lower(email) = lower($1)", [req.body.email]);
    const user = rows[0];
    // Always run bcrypt so response time doesn't reveal whether the email exists.
    const ok = await bcrypt.compare(req.body.password, user ? user.password : DUMMY_HASH);
    if (!user || !ok) fail(401, "Invalid email or password");
    if (!user.active) fail(403, "Your account is disabled. Ask the owner.");
    res.json({ token: signToken(user), user: publicUser(user) });
  }
);

// Current user
router.get("/me", requireAuth, (req, res) => {
  res.json({ _id: req.user.id, firstName: req.user.firstName, lastName: req.user.lastName, email: req.user.email, role: req.user.role, locationId: req.user.locationId || null });
});

// Change own password
router.post(
  "/password",
  requireAuth,
  validate(Joi.object({ currentPassword: Joi.string().required(), newPassword: strongPassword.required() })),
  async (req, res) => {
    const { rows } = await query("select password from users where id = $1", [req.user.id]);
    if (!(await bcrypt.compare(req.body.currentPassword, rows[0].password))) fail(400, "Current password is wrong");
    await query("update users set password = $2 where id = $1", [req.user.id, await bcrypt.hash(req.body.newPassword, SALT())]);
    res.json({ message: "Password changed" });
  }
);

module.exports = { router, strongPassword, SALT };
