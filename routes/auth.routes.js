// routes/auth.routes.js
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import auth from "../middleware/auth.js";

import {
  registerClient,
  registerAdmin,
  requestPasswordReset,
  resetPasswordWithCode,
  setPassword,
  checkEmailExists,
  setAuthCookies,   // <- utilisé au login
  clearAuthCookies, // <- utilisé au logout
} from "../controllers/authController.js";

const router = Router();

/* ----------------- Public: register / reset / check email ----------------- */
router.post("/register-client", registerClient);
router.post("/register-admin", registerAdmin);
router.post("/forgot-password", requestPasswordReset);
router.post("/reset-password", resetPasswordWithCode);
router.post("/set-password", setPassword);
router.post("/check-email", checkEmailExists);

/* --------------------------------- Login ---------------------------------- */
router.post("/login", async (req, res) => {
  try {
    const { email = "", password = "", rememberMe = false } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email ou mot de passe manquant." });
    }

    // récupère les champs sensibles même si select:false dans le schema
    const user = await User.findOne({ email }).select("+passwordHash +role").lean();
    if (!user) {
      return res.status(401).json({ success: false, message: "Email ou mot de passe invalide." });
    }

    const ok = await bcrypt.compare(password, user.passwordHash || "");
    if (!ok) {
      return res.status(401).json({ success: false, message: "Email ou mot de passe invalide." });
    }

    if (!process.env.JWT_SECRET) {
      // pour éviter un 500 silencieux
      return res.status(500).json({ success: false, message: "JWT_SECRET non configuré" });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role || "client" },
      process.env.JWT_SECRET,
      { expiresIn: rememberMe ? "30d" : "1d" }
    );

    // Pose les cookies HTTP-only (dans ton controller → SameSite=None + Secure)
    setAuthCookies(res, {
      token,
      role: user.role || "client",
      remember: !!rememberMe,
    });

    const { passwordHash, ...safe } = user;
    return res.json({ success: true, role: user.role || "client", user: safe });
  } catch (err) {
    console.error("LOGIN 500:", err);
    return res.status(500).json({ success: false, message: "Erreur interne" });
  }
});

/* -------------------------------- Logout ---------------------------------- */
router.post("/logout", (req, res) => {
  clearAuthCookies(res);
  res.json({ success: true, message: "Déconnecté" });
});

/* -------------------------------- WhoAmI ---------------------------------- */
router.get("/whoami", auth, (req, res) => {
  res.json({ id: req.user.id, role: req.user.role });
});

export default router;
