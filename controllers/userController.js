// controllers/userController.js
import User from "../models/User.js";
// controllers/adminUsers.controller.js
import crypto from "crypto";
import bcrypt from "bcryptjs";
const ttlHours = 48; // lien valable 48h
import { makeTransport } from "../utils/mailer.js";
import { normalizeAccountType, sha256 } from "./_auth.helpers.js";

const ttlInviteHours = 48;    // lien d’invitation valable 48h
const ttlCodeMinutes = 10;    // code 6 chiffres valable 10 min
/** Récupérer l'utilisateur connecté */
export const me = async (req, res) => {
  // ⚠️ lire l'id depuis req.user.id (middleware auth)
  const user = await User.findById(req.user?.id);
  if (!user)
    return res.status(404).json({ message: "Utilisateur introuvable" });
  res.json(user.toJSON());
};

/** Modifier le profil de l'utilisateur connecté */
export const updateMe = async (req, res) => {
  try {
    const allowed = [
      "nom",
      "prenom",
      "numTel",
      "adresse",
      "personal",
      "company",
    ];
    const payload = {};
    for (const key of allowed) {
      if (key in req.body) payload[key] = req.body[key];
    }

    // ⚠️ lire l'id depuis req.user.id (middleware auth)
    const user = await User.findByIdAndUpdate(req.user?.id, payload, {
      new: true,
    });
    if (!user)
      return res.status(404).json({ message: "Utilisateur introuvable" });
    res.json(user.toJSON());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/** Liste des utilisateurs (admin) */
export const listUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users.map((u) => u.toJSON()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// controllers/admin.users.controller.js


/* ================== INVITER UN UTILISATEUR (lien) ================== */
export const inviteUser = async (req, res) => {
  try {
    let {
      nom, prenom, email, numTel, adresse,
      accountType = "personnel",
      role = "client",
      personal,
      company,
    } = req.body || {};

    if (!email) return res.status(400).json({ success:false, message:"email est obligatoire" });

    const exists = await User.findOne({ email }).lean();
    if (exists) return res.status(409).json({ success:false, message:"Utilisateur existe déjà" });

    accountType = normalizeAccountType(accountType);

    // ⚠️ ton pre-validate exige nom+prenom pour role=client
    if (role === "client" && (!nom || !prenom)) {
      return res.status(400).json({ success:false, message:"Nom et prénom requis pour un client." });
    }

    // on ne met PAS passwordHash au départ
    const user = await User.create({
      nom, prenom, email, numTel, adresse,
      accountType, role, personal, company,
      passwordHash: undefined,
    });

    // Génère un token hex (pour un lien), stocke seulement le hash
    const rawToken = crypto.randomBytes(24).toString("hex");
    const codeHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + ttlInviteHours * 3600 * 1000);

    user.passwordReset = { codeHash, expiresAt, usedAt: null, attempts: 0, lastSentAt: new Date() };
    await user.save();

    const appUrl = process.env.APP_FRONT_URL || "http://localhost:3000";
    const locale = "fr";
    const setPwdLink = `${appUrl}/${locale}/set-password?uid=${user._id}&token=${rawToken}`;

    // Envoi mail
    let emailResult = { sent:false };
    try {
      const transport = makeTransport();
      const from = process.env.MAIL_FROM || process.env.SMTP_USER;

      await transport.sendMail({
        from,
        to: email,
        subject: "Activez votre compte MTR Industry",
        html: `
          <p>Bonjour <b>${prenom || ""} ${nom || ""}</b>,</p>
          <p>Un administrateur vous a créé un compte sur <b>MTR Industry</b>.</p>
          <p>Cliquez sur ce bouton pour définir votre mot de passe (valable ${ttlInviteHours}h) :</p>
          <p><a href="${setPwdLink}" style="display:inline-block;background:#0B1E3A;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">Définir mon mot de passe</a></p>
          <p>Si le bouton ne s'affiche pas, copiez/collez ce lien :</p>
          <p><code>${setPwdLink}</code></p>
        `,
        text: `Bonjour ${prenom || ""} ${nom || ""},
Un administrateur vous a créé un compte sur MTR Industry.
Définissez votre mot de passe (valable ${ttlInviteHours}h) :
${setPwdLink}
`,
      });
      emailResult.sent = true;
    } catch (e) {
      console.error("inviteUser mail error:", e?.response || e?.message || e);
      emailResult = { sent:false, error: e?.message || "SMTP error" };
    }

    return res.status(201).json({ success:true, userId: user._id, setPwdLink, email: emailResult });
  } catch (e) {
    console.error("inviteUser:", e);
    return res.status(500).json({ success:false, message:"Erreur serveur" });
  }
};

/* ============= DÉFINIR LE MOT DE PASSE (à partir du lien) ============= */
export const setPassword = async (req, res) => {
  try {
    const { uid, token, password } = req.body || {};
    if (!uid || !token || !password)
      return res.status(400).json({ success:false, message:"Paramètres manquants." });
    if (String(password).length < 6)
      return res.status(400).json({ success:false, message:"Mot de passe trop court." });

    // récupérer subfields masqués
    const user = await User.findById(uid).select("+passwordReset.codeHash +passwordReset.expiresAt +passwordReset.usedAt +passwordReset.attempts");
    if (!user) return res.status(404).json({ success:false, message:"Utilisateur introuvable." });

    const pr = user.passwordReset || {};
    if (!pr.codeHash || !pr.expiresAt) return res.status(400).json({ success:false, message:"Lien invalide." });
    if (pr.usedAt) return res.status(400).json({ success:false, message:"Lien déjà utilisé." });
    if (pr.expiresAt.getTime() < Date.now()) return res.status(400).json({ success:false, message:"Lien expiré." });

    if (sha256(token) !== pr.codeHash) {
      await User.updateOne({ _id: user._id }, { $inc: { "passwordReset.attempts": 1 } });
      return res.status(400).json({ success:false, message:"Lien invalide." });
    }

    const hash = await bcrypt.hash(password, 12);
    user.passwordHash = hash;
    user.passwordReset = { ...pr.toObject?.() ?? pr, usedAt: new Date() };
    await user.save();

    return res.json({ success:true, message:"Mot de passe défini." });
  } catch (e) {
    console.error("setPassword:", e);
    return res.status(500).json({ success:false, message:"Erreur serveur" });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success:false, message:"Paramètres manquants." });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ success:false, message:"Mot de passe trop court." });
    }

    // utilisateur authentifié via middleware auth -> req.user.id
    const user = await User.findById(req.user?.id).select("+passwordHash");
    if (!user) return res.status(404).json({ success:false, message:"Utilisateur introuvable." });

    // vérifier l'ancien mot de passe
    const ok = await bcrypt.compare(currentPassword, user.passwordHash || "");
    if (!ok) return res.status(400).json({ success:false, message:"Mot de passe actuel invalide." });

    // enregistrer le nouveau mot de passe
    const hash = await bcrypt.hash(newPassword, 12);
    user.passwordHash = hash;

    // Optionnel: invalider un éventuel reset token non utilisé
    if (user.passwordReset) {
      user.passwordReset.usedAt = new Date();
    }

    await user.save();
    return res.json({ success:true, message:"Mot de passe modifié." });
  } catch (e) {
    console.error("changePassword:", e);
    return res.status(500).json({ success:false, message:"Erreur serveur" });
  }
};