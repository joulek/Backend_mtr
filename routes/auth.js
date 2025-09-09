// routes/auth.js
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import auth from "../middleware/auth.js"; // middleware d'authentification
import { clearAuthCookies } from "../controllers/authController.js";
import { checkEmailExists } from "../controllers/authController.js";


const router = Router();

/** POST /api/auth/login : pose les cookies HTTP-only */
router.get("/whoami", auth, (req, res) => {
  res.json({ id: req.user.id, role: req.user.role });
});
/** POST /api/auth/login */
router.post("/login", async (req, res) => {
  try {
    const { email = "", password = "", rememberMe = false } = req.body || {};

    // نجيبو الحقول الحسّاسة وقت اللوجين (حتى لو schema عامل select:false)
    const user = await User.findOne({ email })
      .select("+passwordHash +password +role")
      .lean();

    if (!user) {
      return res.status(401).json({ success: false, message: "Email ou mot de passe invalide." });
    }

    // نقارن ضد passwordHash (أو password القديم كان موجود)
    const ok = await bcrypt.compare(password, user.passwordHash || user.password || "");
    if (!ok) {
      return res.status(401).json({ success: false, message: "Email ou mot de passe invalide." });
    }

    // نولّد JWT
    const token = jwt.sign(
      { id: user._id, role: user.role || "client" },
      process.env.JWT_SECRET,
      { expiresIn: rememberMe ? "30d" : "1d" }
    );

    // نحطّ الكوكيز (HTTP-only) – sameSite:"lax" يخدم مليح مع proxy (same-origin)
    setAuthCookies(res, {
      token,
      role: user.role || "client",
      remember: !!rememberMe,
    });

    const { password: _pw, passwordHash: _ph, ...safe } = user;
    return res.json({
      success: true,
      role: user.role || "client",
      user: safe,
    });
  } catch (err) {
    console.error("login ERROR:", err);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.post("/check-email", checkEmailExists);


/** POST /api/auth/logout : supprime les cookies */
router.post("/logout", (req, res) => {
  clearAuthCookies(res);
  res.json({ success: true, message: "Déconnecté" });
});
export default router;
