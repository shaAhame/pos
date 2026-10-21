const jwt = require("jsonwebtoken");
const { query } = require("../lib/db");

const ROLE_RANK = { cashier: 1, manager: 2, owner: 3 };

const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, process.env.JWTPRIVATEKEY, {
    expiresIn: process.env.TOKEN_TTL || "12h",
  });

// Requires "Authorization: Bearer <token>" for an active user. Sets req.user.
const requireAuth = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Login required" });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWTPRIVATEKEY);
  } catch {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  // Look the user up every time so deactivated users and role changes take effect immediately.
  const { rows } = await query(
    "select id, first_name, last_name, email, role, active, location_id from users where id = $1",
    [payload.sub]
  );
  const u = rows[0];
  if (!u || !u.active) return res.status(401).json({ message: "Your account is disabled. Ask the owner." });
  req.user = { id: u.id, firstName: u.first_name, lastName: u.last_name, email: u.email, role: u.role, locationId: u.location_id };
  next();
};

// requireRole("manager") lets managers and owners through.
const requireRole = (minRole) => (req, res, next) => {
  if (!req.user || ROLE_RANK[req.user.role] < ROLE_RANK[minRole]) {
    return res.status(403).json({ message: "You don't have permission to do this" });
  }
  next();
};

const atLeast = (user, role) => ROLE_RANK[user.role] >= ROLE_RANK[role];

module.exports = { requireAuth, requireRole, signToken, atLeast, ROLE_RANK };
