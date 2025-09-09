// controllers/authController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import nodemailer from "nodemailer";
// controllers/auth.controller.js
import mongoose from "mongoose";
const NEUTRAL = "Si un compte existe, un email a été envoyé.";
const COOLDOWN_MS = 60 * 1000; // anti-spam envoi code (60s)
/** Utilitaire commun pour poser les cookies */
// controllers/authController.js
// controllers/authController.js
export function clearAuthCookies(res) {
  const isProd = process.env.NODE_ENV === "production";
  const common = {
    path: "/",
    sameSite: "lax",      // مع proxy (same-origin) كافي
    secure: isProd,       // لازم true على Render/HTTPS
  };
  res.clearCookie("token", common);
  res.clearCookie("role", common);
}

export function setAuthCookies(res, { token, role, remember }) {
  const isProd = process.env.NODE_ENV === "production";
  const base = {
    path: "/",
    sameSite: "lax",      // لو قررت تلغي proxy وتخلي cross-site: بدّلها إلى "none"
    secure: isProd,
  };

  const withAge = remember ? { ...base, maxAge: 30 * 24 * 60 * 60 * 1000 } : base;

  // توكن محمي بالـ HTTP-only
  res.cookie("token", token, { ...withAge, httpOnly: true });
  // دور المستخدم (اختياري) غير محمي (علشان تستعمله في الواجهة بسهولة)
  res.cookie("role", role || "client", { ...withAge, httpOnly: false });
}

export const registerClient = async (req, res) => {
  try {
    let {
      email,
      password,
      nom,
      prenom,
      numTel,
      adresse,
      accountType,      // "personnel" | "societe"
      personal,         // ex: { cin, posteActuel }
      company,          // ex: { matriculeFiscal, nomSociete, posteActuel }
    } = req.body;

    // normalisation
    accountType = (accountType || "").toString().trim().toLowerCase();
    nom = (nom || "").trim();
    prenom = (prenom || "").trim();
    email = (email || "").trim();
    numTel = (numTel || "").trim();
    adresse = (adresse || "").trim();

    // validations de base
    if (!email || !password || !nom || !prenom) {
      return res.status(400).json({ message: "Champs requis: email, password, nom, prenom" });
    }
    if (!["personnel", "societe"].includes(accountType)) {
      return res.status(400).json({ message: "Le type de compte est obligatoire (personnel ou societe)" });
    }

    // validations spécifiques
    if (accountType === "personnel") {
      if (!personal || typeof personal !== "object") {
        return res.status(400).json({ message: "Données 'personal' manquantes" });
      }
      // coercion
      if (personal.cin != null) personal.cin = Number(personal.cin);
      personal.posteActuel = (personal.posteActuel || "").trim();
      if (!personal.cin || !personal.posteActuel) {
        return res.status(400).json({ message: "CIN et poste actuel sont requis pour un compte personnel" });
      }
    } else {
      if (!company || typeof company !== "object") {
        return res.status(400).json({ message: "Données 'company' manquantes" });
      }
      company.matriculeFiscal = (company.matriculeFiscal || company.matriculeFiscale || "").trim();
      company.nomSociete = (company.nomSociete || "").trim();
      company.posteActuel = (company.posteActuel || "").trim();
      if (!company.matriculeFiscal || !company.nomSociete || !company.posteActuel) {
        return res.status(400).json({ message: "Matricule fiscal, Nom société et Poste actuel sont requis pour un compte société" });
      }
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: "Email déjà utilisé" });

    const passwordHash = await bcrypt.hash(password, 10);

    const doc = {
      role: "client",
      accountType,
      email,
      passwordHash,
      nom,
      prenom,
      numTel,
      adresse,
    };
    if (accountType === "personnel") doc.personal = personal;
    if (accountType === "societe") doc.company = company;

    const user = await User.create(doc);

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    setAuthCookies(res, { token, role: user.role });
    res.status(201).json({ success: true, user: user.toJSON(), role: user.role });
  } catch (e) {
    console.error("registerClient ERROR:", e);
    if (e.code === 11000 && e.keyPattern?.email) {
      return res.status(400).json({ message: "Email déjà utilisé" });
    }
    res.status(500).json({ message: "Erreur serveur" });
  }
};


/** Inscription admin (pose cookies) */
export const registerAdmin = async (req, res) => {
  try {
    const { email, password, nom, prenom } = req.body;
    if (!email || !password) return res.status(400).json({ message: "email & password obligatoires" });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: "Email déjà utilisé" });

    const passwordHash = await bcrypt.hash(password, 10);

    // Pour ne pas casser la contrainte `required: true` sur accountType
    const user = await User.create({
      role: "admin",
      accountType: "personnel",       // valeur par défaut côté admin
      email,
      passwordHash,
      nom: nom || "Admin",
      prenom: prenom || "",
    });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    setAuthCookies(res, { token, role: user.role });

    res.status(201).json({ success: true, user: user.toJSON(), role: user.role });
  } catch (e) {
    console.error("registerAdmin ERROR:", e);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/** (Optionnel) endpoint de debug pour vérifier cookies */
export const whoami = async (req, res) => {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ message: "Non authentifié" });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ message: "Session invalide" });
    res.json({ success: true, user: user.toJSON() });
  } catch (e) {
    res.status(401).json({ message: "Session invalide" });
  }
};
// routes/auth.js


// 🚀 Ex-forgot: envoie un CODE (pas de lien)
export const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body ?? {};
    if (!email) return res.status(400).json({ message: "Email requis" });

    const user = await User.findOne({ email }).select(
      "+passwordReset.codeHash +passwordReset.expiresAt +passwordReset.lastSentAt"
    );
    // réponse neutre pour ne pas leak l'existence du compte
    if (!user) return res.json({ message: NEUTRAL });

    // anti-spam (cooldown)
    const last = user.passwordReset?.lastSentAt?.getTime?.() || 0;
    if (Date.now() - last < COOLDOWN_MS) {
      return res.json({ message: NEUTRAL });
    }

    // crée un code 6 chiffres valide 10 minutes
    const rawCode = user.createPasswordResetCode(10, 6);
    await user.save();

    // ⚠️ on garde ton transporteur nodemailer
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const pretty = String(rawCode).replace(/(\d{3})(\d{3})/, "$1 $2");
    const fullName = [user.prenom, user.nom].filter(Boolean).join(" ") || "client";
    const subject = "Code de réinitialisation";

    // design identique à l'email de contact + CODE CENTRÉ
    const html = `<!doctype html>
<html>
  <head>
    <meta charSet="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${subject}</title>
  </head>
  <body style="margin:0;background:#F5F7FB;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Apple Color Emoji','Segoe UI Emoji';color:#111827;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;background:#F5F7FB;margin:0;padding:24px 16px;border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:0;margin:0;">

          <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                 style="width:680px;max-width:100%;border-collapse:collapse;">

            <!-- Bande TOP -->
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="background:#0B2239;color:#FFFFFF;text-align:center;
                               padding:14px 20px;font-weight:800;font-size:14px;letter-spacing:.3px;
                               border-radius:8px;box-sizing:border-box;width:100%;">
                      MTR – Manufacture Tunisienne des ressorts
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>

            <!-- Carte contenu -->
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                       style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;border-collapse:separate;box-sizing:border-box;">
                  <tr>
                    <td style="padding:24px;">
                      <h1 style="margin:0 0 12px 0;font-size:18px;line-height:1.35;color:#002147;">
                        Code de réinitialisation
                      </h1>

                      <p style="margin:0 0 8px 0;">Bonjour ${fullName},</p>
                      <p style="margin:0 0 16px 0;">Voici votre <strong>code de réinitialisation</strong>&nbsp;:</p>

                      <!-- 🔥 CODE CENTRÉ, compatible Gmail/Outlook -->
                      <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:12px auto;">
                        <tr>
                          <td style="padding:0;text-align:center;">
                            <div style="font-weight:800;font-size:28px;letter-spacing:8px;line-height:1.2;
                                        padding:14px 16px;border:1px dashed #d1d5db;border-radius:10px;
                                        display:inline-block;">
                              ${pretty}
                            </div>
                          </td>
                        </tr>
                      </table>

                      <p style="margin:16px 0 0 0;">Ce code est valable <strong>10 minutes</strong>.</p>
                      <p style="margin:8px 0 0 0;color:#374151;">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>

            <!-- Bande BOTTOM -->
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="background:#0B2239;color:#FFFFFF;text-align:center;
                               padding:14px 20px;font-weight:800;font-size:14px;letter-spacing:.3px;
                               border-radius:8px;box-sizing:border-box;width:100%;">&nbsp;</td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    await transporter.sendMail({
      to: user.email,
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      subject,
      html,
    });

    return res.json({ message: NEUTRAL });
  } catch (err) {
    console.error("requestPasswordReset (code):", err);
    return res.status(500).json({ message: "Erreur serveur" });
  }
};


// 🚀 Nouveau: vérifie le CODE et change le mot de passe
export const resetPasswordWithCode = async (req, res) => {
  try {
    const { email, code, password } = req.body ?? {};
    if (!email || !code || !password) {
      return res.status(400).json({ message: "Champs requis: email, code, password" });
    }

    const user = await User.findOne({ email }).select("+passwordHash +passwordReset.codeHash +passwordReset.expiresAt +passwordReset.usedAt +passwordReset.attempts");
    if (!user) {
      // neutre envers un attaquant; message “OK” si valide etc.
      return res.json({ message: "Mot de passe réinitialisé si le code était valide." });
    }

    // limite tentatives
    if ((user.passwordReset?.attempts || 0) >= 5) {
      user.clearPasswordResetState();
      await user.save();
      return res.status(429).json({ message: "Trop de tentatives. Redemandez un nouveau code." });
    }

    const status = user.verifyPasswordResetCode(code);
    if (status === "expired") {
      user.clearPasswordResetState();
      await user.save();
      return res.status(400).json({ message: "Code expiré. Redemandez un nouveau code." });
    }
    if (status !== "ok") {
      user.passwordReset.attempts = (user.passwordReset.attempts || 0) + 1;
      await user.save();
      return res.status(400).json({ message: "Code invalide." });
    }

    // OK: changer le mot de passe
    user.passwordHash = await bcrypt.hash(password, 10);
    user.clearPasswordResetState();
    await user.save();

    return res.json({ message: "Mot de passe réinitialisé avec succès." });
  } catch (err) {
    console.error("resetPasswordWithCode:", err);
    return res.status(500).json({ message: "Erreur serveur" });
  }
};

// (Optionnel) Ancienne version par token – dépréciée
export const resetPassword = async (req, res) => {
  return res.status(410).json({ message: "Ce flux est obsolète. Utilisez le reset par code." });
};

// controllers/authController.js
export const checkEmailExists = async (req, res) => {
  try {
    const { email } = req.body ?? {};
    if (!email) return res.status(400).json({ exists: false, message: "Email requis" });
    const user = await User.findOne({ email }).select("_id");
    return res.json({ exists: !!user });
  } catch (e) {
    return res.status(500).json({ exists: false, message: "Erreur serveur" });
  }
};


// POST /api/auth/set-password
export const setPassword = async (req, res) => {
  try {
    const { uid, token, password } = req.body || {};

    // 0) validations d'entrée
    if (!uid || !token || !password) {
      console.warn("[setPassword] missing fields:", { uid: !!uid, token: !!token, password: !!password });
      return res.status(400).json({ success: false, message: "Lien invalide" });
    }
    if (!mongoose.isValidObjectId(uid)) {
      console.warn("[setPassword] invalid uid:", uid);
      return res.status(400).json({ success: false, message: "Lien invalide" });
    }

    // 1) récupérer user + resetPassword
    const user = await User.findById(uid).lean(); // lean pour lecture rapide
    if (!user || !user.resetPassword) {
      console.warn("[setPassword] user/resetPassword not found:", { uid, hasUser: !!user });
      return res.status(400).json({ success: false, message: "Lien invalide" });
    }

    const { token: savedToken, expireAt } = user.resetPassword;

    // 2) vérifier token
    if (token !== savedToken) {
      console.warn("[setPassword] token mismatch:", { uid, token, savedToken });
      return res.status(400).json({ success: false, message: "Lien expiré ou invalide" });
    }

    // 3) vérifier expiration
    if (new Date(expireAt).getTime() < Date.now()) {
      console.warn("[setPassword] token expired:", { uid, expireAt });
      return res.status(400).json({ success: false, message: "Lien expiré ou invalide" });
    }

    // 4) mettre à jour le password et effacer le resetPassword
    const hash = await bcrypt.hash(password, 10);
    await User.findByIdAndUpdate(
      uid,
      { $set: { password: hash }, $unset: { resetPassword: 1 } },
      { new: true }
    );

    return res.json({ success: true, message: "Mot de passe défini avec succès" });
  } catch (err) {
    console.error("setPassword error:", err);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};