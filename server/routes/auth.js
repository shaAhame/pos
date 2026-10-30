const router = require("express").Router();
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const passwordComplexity = require("joi-password-complexity");
const { query } = require("../lib/db");
const { Joi, validate } = require("../lib/validate");
const { requireAuth, signToken } = require("../middleware/auth");
const { fail } = require("../lib/errors");
const { platformEnabled } = require("../lib/setup");
const { effectiveFeatures } = require("../lib/features");

const SALT = () => Number(process.env.SALT) || 10;
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10); // same timing whether or not the email exists
const strongPassword = passwordComplexity({ min: 8, max: 72, lowerCase: 1, upperCase: 1, numeric: 1, symbol: 0, requirementCount: 3 }).label("Password");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many login attempts. Wait 15 minutes and try again." },
});

const meShape = (u, business) => ({
  _id: u.id, firstName: u.firstName ?? u.first_name, lastName: u.lastName ?? u.last_name, email: u.email,
  role: u.role, locationId: u.locationId ?? u.location_id ?? null, hasApprovalPin: !!u.hasApprovalPin,
  business,
});

// Is this a brand-new platform with no MacQuad admin yet?
router.get("/status", async (req, res) => {
  if (!platformEnabled()) return res.json({ needsPlatformSetup: false, platform: false });
  const { rows } = await query("select exists(select 1 from platform_users) as admins");
  res.json({ needsPlatformSetup: !rows[0].admins, platform: true });
});

router.post(
  "/login",
  loginLimiter,
  validate(Joi.object({ email: Joi.string().trim().email().required(), password: Joi.string().required() })),
  async (req, res) => {
    const { rows } = await query(
      `select u.*, b.name as biz_name, b.type as biz_type, b.status as biz_status, b.features as biz_features
         from users u join businesses b on b.id = u.business_id where lower(u.email) = lower($1)`,
      [req.body.email]
    );
    const u = rows[0];
    const ok = await bcrypt.compare(req.body.password, u ? u.password : DUMMY_HASH);
    if (!u || !ok) fail(401, "Invalid email or password");
    if (!u.active) fail(403, "Your account is disabled. Ask the owner.");
    if (u.biz_status !== "active") fail(403, "This business account is suspended. Please contact your POS provider.", { code: "BUSINESS_SUSPENDED" });
    res.json({
      token: signToken(u),
      user: meShape({ ...u, hasApprovalPin: !!u.approval_pin }, { _id: u.business_id, name: u.biz_name, type: u.biz_type, features: effectiveFeatures(u.biz_type, u.biz_features) }),
    });
  }
);

router.get("/me", requireAuth, async (req, res) => {
  const { rows } = await query("select approval_pin is not null as has from users where id = $1", [req.user.id]);
  res.json(meShape({ ...req.user, hasApprovalPin: rows[0].has }, req.business));
});

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

// Managers and owners set a short PIN used to approve big discounts at a cashier's till.
router.post(
  "/approval-pin",
  requireAuth,
  validate(Joi.object({ currentPassword: Joi.string().required(), pin: Joi.string().pattern(/^\d{4,8}$/).message("PIN must be 4 to 8 digits").required() })),
  async (req, res) => {
    if (req.user.role === "cashier") fail(403, "Only managers and owners approve discounts");
    const { rows } = await query("select password from users where id = $1", [req.user.id]);
    if (!(await bcrypt.compare(req.body.currentPassword, rows[0].password))) fail(400, "Password is wrong");
    await query("update users set approval_pin = $2 where id = $1", [req.user.id, await bcrypt.hash(req.body.pin, SALT())]);
    res.json({ message: "Approval PIN saved" });
  }
);

module.exports = { router, strongPassword, SALT, loginLimiter };
