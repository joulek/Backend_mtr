// middleware/auth.js
import jwt from "jsonwebtoken";

/**
 * Middleware principal : lit le cookie "token", vérifie le JWT,
 * et attache { id, role } à req.user.
 */
export default function auth(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return res.status(401).json({ message: "Non authentifié" });
    }
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "JWT_SECRET non configuré" });
    }
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id, role: payload.role || "client" };
    next();
  } catch (e) {
    return res.status(401).json({ message: "Session invalide" });
  }
}

/** Exige simplement une session valide (après auth) */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Non authentifié" });
  }
  next();
}

/** Exige le rôle admin (après auth) */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Non authentifié" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Accès réservé aux administrateurs" });
  }
  next();
}

/**
 * Limiteur de rôles générique
 *   ex: router.get("/...", auth, only("admin", "manager"), handler)
 */
export function only(...roles) {
  return (req, res, next) => {
    if (!req.user?.role) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Accès refusé" });
    }
    next();
  };
}
