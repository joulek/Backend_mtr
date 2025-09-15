// middleware/auth.js
import jwt from "jsonwebtoken";

export default function auth(req, res, next) {
  try {
    const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const token = req.cookies?.token || bearer; // ✅ cookie d'abord, sinon header
    if (!token) return res.status(401).json({ message: "Non authentifié" });
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "JWT_SECRET non configuré" });
    }
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id, role: payload.role || "client" };
    next();
  } catch {
    return res.status(401).json({ message: "Session invalide" });
  }
}

export function only(...roles) {
  return (req, res, next) => {
    if (!req.user?.role) return res.status(401).json({ error: "Non authentifié" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Accès refusé" });
    next();
  };
}
