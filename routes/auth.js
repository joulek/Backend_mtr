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
    const user = await User.findOne({ email }).lean();
    if (!user) {
      return res.status(401).json({ success: false, message: "Email ou mot de passe invalide." });
    }

    const ok = await bcrypt.compare(password, user.password || "");
    if (!ok) {
      return res.status(401).json({ success: false, message: "Email ou mot de passe invalide." });
    }

    // 1) جهّز التوكن
    const token = jwt.sign(
      { id: user._id, role: user.role || "client" },
      process.env.JWT_SECRET,
      { expiresIn: rememberMe ? "30d" : "1d" }
    );

    // 2) حضّر الكوكيز
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000, // ms
    };

    // 3) حطّ الكوكيز
    res.cookie("token", token, cookieOpts);
    res.cookie("role", user.role || "client", { ...cookieOpts, httpOnly: false });

    // 4) رجّع body فيه token (مهم للبروكسي Next)
    const { password: _pw, resetPassword, ...safeUser } = user;
    return res.json({
      success: true,
      role: user.role || "client",
      token,                  // ⬅️ البروكسي يستعملها باش يركّب كوكيز محليًّا
      user: safeUser,
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
