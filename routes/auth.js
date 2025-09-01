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
router.post("/login", async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body; // ← NEW

    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user) return res.status(400).json({ message: "Identifiants invalides" });

    const ok = await bcrypt.compare(password, user.passwordHash || "");
    if (!ok) return res.status(400).json({ message: "Identifiants invalides" });

    // Durée JWT selon rememberMe
    const jwtTtl = rememberMe ? "30d" : "1d";

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: jwtTtl }
    );

    // Base cookies
    const baseCookie = {
      httpOnly: true,
      sameSite: "lax",                              // "none" si domaines différents + HTTPS
      secure: process.env.NODE_ENV === "production",
      path: "/",
    };

    // Cookie du token
    // - session cookie si !rememberMe (pas de maxAge)
    // - 30 jours si rememberMe
    const tokenCookieOpts = rememberMe
      ? { ...baseCookie, maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 jours
      : baseCookie;

    res.cookie("token", token, tokenCookieOpts);

    // Cookie role (non-HttpOnly, utile côté front si tu l’utilises)
    const roleCookieOpts = {
      sameSite: tokenCookieOpts.sameSite,
      secure: tokenCookieOpts.secure,
      path: tokenCookieOpts.path,
      ...(rememberMe ? { maxAge: tokenCookieOpts.maxAge } : {}), // session si non coché
    };
    res.cookie("role", user.role, roleCookieOpts);

    // Nettoyage & dernière connexion
    const { passwordHash, ...safeUser } = user.toObject();
    user.lastLogin = new Date();
    await user.save();

    // Réponse (sans token, on s'appuie sur le cookie HttpOnly)
    res.json({
      success: true,
      role: user.role,
      user: safeUser,
    });

  } catch (err) {
    console.error("login ERROR:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});
router.post("/check-email", checkEmailExists);


/** POST /api/auth/logout : supprime les cookies */
router.post("/logout", (req, res) => {
  clearAuthCookies(res);
  res.json({ success: true, message: "Déconnecté" });
});

export default router;
