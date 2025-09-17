// models/Devis.js
import mongoose from "mongoose";

const itemSchema = new mongoose.Schema(
  {
    reference:   { type: String, trim: true },
    designation: { type: String, trim: true },
    unite:       { type: String, default: "U" },
    quantite:    { type: Number, required: true, default: 1, min: 0 },
    puht:        { type: Number, required: true, min: 0 },
    remisePct:   { type: Number, default: 0, min: 0, max: 100 },
    tvaPct:      { type: Number, default: 19, min: 0, max: 100 },
    totalHT:     { type: Number }, // سيُحسب آليًا
    // ✅ رقم طلب خاص بالسطر (لو المولتي-DDV)
    demandeNumero: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const linkSchema = new mongoose.Schema(
  {
    id:     { type: mongoose.Schema.Types.ObjectId, ref: "DemandeDevis" },
    numero: { type: String },
    type:   { type: String },
  },
  { _id: false }
);

const devisSchema = new mongoose.Schema(
  {
    numero:         { type: String, unique: true, index: true }, // ex: DV2025-000123
    demandeId:      { type: mongoose.Schema.Types.ObjectId, ref: "DemandeDevis" },
    demandeNumero:  { type: String },

    // (اختياري) حالة الdevis و صلاحيته
    status: { type: String, enum: ["draft","sent","accepted","rejected"], default: "draft", index: true },
    validUntil: { type: Date },

    client: {
      id:       { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
      nom:      String,
      email:    String,
      adresse:  String,
      tel:      String,
      codeTVA:  String,
    },

    items: [itemSchema],

    totaux: {
      mtht:     { type: Number, default: 0 },   // مجموع HT قبل remise globale
      mtnetht:  { type: Number, default: 0 },   // HT بعد remises السطور
      mttva:    { type: Number, default: 0 },   // TVA totale
      fodecPct: { type: Number, default: 1 },   // %FODEC (TN) — بدّل إذا يلزم
      mfodec:   { type: Number, default: 0 },   // قيمة FODEC
      timbre:   { type: Number, default: 0 },   // طابع جبائي
      mttc:     { type: Number, default: 0 },   // TTC النهائي
    },

    meta: {
      demandes:       [linkSchema],
      demandeNumero:  String,
    },
  },
  { timestamps: true }
);

/* ----------------- Helpers ----------------- */
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/** يحسب totals من السطور */
devisSchema.methods.recalcTotals = function () {
  let mtht = 0;
  let mtnetht = 0;
  let mttva = 0;

  // احسب totalHT لكل سطر
  this.items = (this.items || []).map((it) => {
    const q     = Number(it.quantite || 0);
    const pu    = Number(it.puht || 0);
    const rem   = Math.min(Math.max(Number(it.remisePct || 0), 0), 100) / 100;
    const tva   = Math.min(Math.max(Number(it.tvaPct    || 0), 0), 100) / 100;

    const lineGross = q * pu;            // HT قبل remise
    const lineNet   = lineGross * (1 - rem);
    const lineTVA   = lineNet * tva;

    it.totalHT = round2(lineNet);

    mtht    += lineGross;
    mtnetht += lineNet;
    mttva   += lineTVA;
    return it;
  });

  // FODEC (اختياري): % من NET HT
  const fodecPct = Number(this.totaux?.fodecPct ?? 0) / 100;
  const mfodec   = mtnetht * fodecPct;

  const timbre   = Number(this.totaux?.timbre ?? 0);

  // TTC
  const mttc = mtnetht + mttva + mfodec + timbre;

  this.totaux.mtht    = round2(mtht);
  this.totaux.mtnetht = round2(mtnetht);
  this.totaux.mttva   = round2(mttva);
  this.totaux.mfodec  = round2(mfodec);
  this.totaux.mttc    = round2(mttc);
};

/* احسب totals قبل validate/save */
devisSchema.pre("validate", function (next) {
  try {
    this.recalcTotals();
    next();
  } catch (e) { next(e); }
});

/* ---------- Index إضافية ---------- */
devisSchema.index({ createdAt: -1 }, { name: "devis_createdAt_-1" });
devisSchema.index({ demandeId: 1, createdAt: -1 }, { name: "devis_demandeId_createdAt" });
devisSchema.index({ "meta.demandes.id": 1, createdAt: -1 }, { name: "devis_meta_demandes_id_createdAt" });
devisSchema.index({ demandeNumero: 1, createdAt: -1 }, { name: "devis_demandeNumero_createdAt" });
devisSchema.index({ "meta.demandeNumero": 1, createdAt: -1 }, { name: "devis_meta_demandeNumero_createdAt" });
devisSchema.index({ "meta.demandes.numero": 1 }, { name: "devis_meta_demandes_numero_1" });
devisSchema.index({ "meta.demandes.type": 1, createdAt: -1 }, { name: "devis_meta_demandes_type_createdAt" });
devisSchema.index({ "client.nom": 1, createdAt: -1 }, { name: "devis_client_nom_createdAt" });
// للفلترة سريعًا حسب العميل وتاريخ الإنشاء
devisSchema.index({ "client.id": 1, createdAt: -1 }, { name: "devis_clientId_createdAt" });

export default mongoose.model("Devis", devisSchema);
