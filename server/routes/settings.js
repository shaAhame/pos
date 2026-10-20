const router = require("express").Router();
const { query } = require("../lib/db");
const { Joi, validate, text, percent } = require("../lib/validate");
const { requireRole } = require("../middleware/auth");
const { getSettings, clearSettingsCache } = require("../lib/settings");
const { snake } = require("../lib/util");

router.get("/", async (req, res) => res.json(await getSettings()));

const isValidTz = (tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };

router.put(
  "/",
  requireRole("owner"),
  validate(Joi.object({
    shopName: text(120).min(1), address: text(300).allow(""), phone: text(60).allow(""),
    email: Joi.string().trim().email().allow("").max(200), receiptFooter: text(300).allow(""),
    currency: text(10).min(1), defaultTaxRate: percent, maxCashierDiscount: percent,
    timezone: text(60).custom((v, h) => (isValidTz(v) ? v : h.message("Unknown timezone"))),
  }).min(1)),
  async (req, res) => {
    const keys = Object.keys(req.body);
    const sets = keys.map((k, i) => `${snake(k)} = $${i + 1}`);
    await query(`update settings set ${sets.join(", ")}, updated_at = now() where id = 1`, keys.map((k) => req.body[k]));
    clearSettingsCache();
    res.json(await getSettings());
  }
);

module.exports = router;
