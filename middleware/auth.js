// middleware/auth.js
import jwt from "jsonwebtoken";

export default function auth(req, res, next) {
  // 1) خذ التوكن من Authorization أو من الكوكي
  let token = null;
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else if (req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) return res.status(401).json({ error: "Token manquant" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.sub || decoded.id || decoded._id || decoded.userId;
    if (!userId) return res.status(401).json({ error: "ID utilisateur manquant dans le token" });

    req.user = { id: userId, role: decoded.role };
    return next();
  } catch {
    return res.status(401).json({ error: "Token invalide ou expiré" });
  }
}

export function only(...roles) {
  return (req, res, next) => {
    if (!req.user?.role) return res.status(401).json({ error: "Non authentifié" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Accès refusé" });
    next();
  };
}
// middleware/auth.js
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Non authentifié" });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Non authentifié" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Accès réservé aux administrateurs" });
  }
  next();
}

