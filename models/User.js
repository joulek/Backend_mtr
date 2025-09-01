import mongoose from "mongoose";
import crypto from "crypto";

const personalSchema = new mongoose.Schema(
  {
    cin: { type: Number, trim: true },
    posteActuel: { type: String, trim: true }
  },
  { _id: false }
);

const companySchema = new mongoose.Schema(
  {
    matriculeFiscal: { type: String, trim: true },
    nomSociete: { type: String, trim: true },
    posteActuel: { type: String, trim: true }
  },
  { _id: false }
);

const passwordResetSchema = new mongoose.Schema(
  {
    // ⚠️ On passe de token → code chiffré
    codeHash: { type: String, select: false, index: true },
    expiresAt: { type: Date, select: false, index: true },
    usedAt: { type: Date, select: false },
    attempts: { type: Number, select: false, default: 0 },
    lastSentAt: { type: Date, select: false }
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    accountType: { type: String, enum: ["personnel", "societe"], required: true, index: true },
    role: { type: String, enum: ["admin", "client"], default: "client", index: true },

    // Identité
    nom: { type: String, trim: true },
    prenom: { type: String, trim: true },

    // Contact
    email: { type: String, trim: true, unique: true, index: true, required: true },
    numTel: { type: String, trim: true },
    adresse: { type: String, trim: true },

    // Auth
    passwordHash: { type: String, select: false },

    // Détails
    personal: personalSchema,
    company: companySchema,

    // 🔐 Reset password par CODE
    passwordReset: { type: passwordResetSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// ----- toJSON: on masque ce qu'il faut -----
userSchema.methods.toJSON = function () {
  const obj = this.toObject({ getters: true, virtuals: false });
  delete obj.passwordHash;
  delete obj.passwordReset;
  delete obj.__v;
  return obj;
};

// Règle métier exemple (inchangée)
userSchema.pre("validate", function (next) {
  if (this.role === "client") {
    if (!this.nom || !this.prenom) {
      return next(new Error("Nom et prénom sont obligatoires pour un client"));
    }
  }
  next();
});

// ====== Helpers Reset via CODE ======
/** Génère un code numérique à 6 chiffres (par défaut), stocke son hash + expiration */
userSchema.methods.createPasswordResetCode = function (ttlMinutes = 10, length = 6) {
  let rawCode = "";
  for (let i = 0; i < length; i++) {
    rawCode += crypto.randomInt(0, 10).toString();
  }
  const codeHash = crypto.createHash("sha256").update(rawCode).digest("hex");
  this.passwordReset = {
    codeHash,
    expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
    usedAt: null,
    attempts: 0,
    lastSentAt: new Date()
  };
  return rawCode; // à envoyer par email
};

/** Vérifie le code */
userSchema.methods.verifyPasswordResetCode = function (code) {
  if (!this.passwordReset?.codeHash || !this.passwordReset?.expiresAt) return "bad";
  if (Date.now() > this.passwordReset.expiresAt.getTime()) return "expired";
  const hash = crypto.createHash("sha256").update(String(code || "")).digest("hex");
  return hash === this.passwordReset.codeHash ? "ok" : "bad";
};

/** Invalide le code (après usage ou expiration) */
userSchema.methods.clearPasswordResetState = function () {
  this.passwordReset = {};
};

export default mongoose.model("User", userSchema);
