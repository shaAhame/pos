const jwt = require("jsonwebtoken");
const { query } = require("../lib/db");
const { effectiveFeatures } = require("../lib/features");

const ROLE_RANK = { cashier: 1, manager: 2, owner: 3 };

const signToken = (user) =>
  jwt.sign({ sub: user.id, scope: "shop" }, process.env.JWTPRIVATEKEY, { expiresIn: process.env.TOKEN_TTL || "12h" });
const signPlatformToken = (admin) =>
  jwt.sign({ sub: admin.id, scope: "platform" }, process.env.JWTPRIVATEKEY, { expiresIn: process.env.PLATFORM_TOKEN_TTL || "8h" });

const bearer = (req) => {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
};
const verify = (token) => { try { return jwt.verify(token, process.env.JWTPRIVATEKEY); } catch { return null; } };

// Shop staff. Sets req.user and req.biz (business id). Looked up every time, so disabling a
// user, changing a role or suspending a business takes effect immediately.
const requireAuth = async (req, res, next) => {
  const token = bearer(req);
  if (!token) return res.status(401).json({ message: "Login required" });
  const payload = verify(token);
  if (!payload || payload.scope === "platform") return res.status(401).json({ message: "Session expired. Please log in again." });
  const { rows } = await query(
    `select u.id, u.first_name, u.last_name, u.email, u.role, u.active, u.location_id, u.business_id,
            b.name as biz_name, b.type as biz_type, b.status as biz_status, b.features as biz_features
       from users u join businesses b on b.id = u.business_id where u.id = $1`,
    [payload.sub]
  );
  const u = rows[0];
  if (!u || !u.active) return res.status(401).json({ message: "Your account is disabled. Ask the owner." });
  if (u.biz_status !== "active") return res.status(403).json({ message: "This business account is suspended. Please contact your POS provider.", code: "BUSINESS_SUSPENDED" });
  req.biz = u.business_id;
  req.business = { _id: u.business_id, name: u.biz_name, type: u.biz_type, features: effectiveFeatures(u.biz_type, u.biz_features) };
  req.user = { id: u.id, firstName: u.first_name, lastName: u.last_name, email: u.email, role: u.role, locationId: u.location_id };
  next();
};

const requireRole = (minRole) => (req, res, next) => {
  if (!req.user || ROLE_RANK[req.user.role] < ROLE_RANK[minRole]) {
    return res.status(403).json({ message: "You don't have permission to do this" });
  }
  next();
};

const requireFeature = (name) => (req, res, next) => {
  if (!req.business?.features?.[name]) return res.status(403).json({ message: "This feature isn't switched on for your business", code: "FEATURE_OFF" });
  next();
};

const atLeast = (user, role) => ROLE_RANK[user.role] >= ROLE_RANK[role];

// MacQuad platform admins.
const requirePlatform = async (req, res, next) => {
  const payload = verify(bearer(req) || "");
  if (!payload || payload.scope !== "platform") return res.status(401).json({ message: "Platform login required" });
  const { rows } = await query("select id, name, email, active from platform_users where id = $1", [payload.sub]);
  if (!rows[0] || !rows[0].active) return res.status(401).json({ message: "Platform login required" });
  req.admin = rows[0];
  next();
};

module.exports = { requireAuth, requireRole, requireFeature, requirePlatform, signToken, signPlatformToken, atLeast, ROLE_RANK };
