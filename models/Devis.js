// models/Devis.js
import mongoose from "mongoose";

/* ---------- Items (lignes du devis) ---------- */
const itemSchema = new mongoose.Schema(
  {
    reference: { type: String, trim: true },
    designation: { type: String, trim: true },
    unite: { type: String, default: "U" },
    quantite: { type: Number, required: true, default: 1 },
    puht: { type: Number, required: true },
    remisePct: { type: Number, default: 0 },
    tvaPct: { type: Number, default: 19 },
    totalHT: { type: Number },

    // ✅ N° de demande propre à cette ligne (multi-DDV)
    demandeNumero: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

/* ---------- Liens vers demandes associées (multi-DDV) ---------- */
const linkSchema = new mongoose.Schema(
  {
    id: { type: mongoose.Schema.Types.ObjectId, ref: "DemandeDevis" },
    numero: String,
    type: String,
  },
  { _id: false }
);

/* ---------- Devis ---------- */
const devisSchema = new mongoose.Schema(
  {
    numero: { type: String, unique: true, index: true }, // ex: DV2025-000123
    demandeId: { type: mongoose.Schema.Types.ObjectId, ref: "DemandeDevis" }, // lien principal (première demande)
    demandeNumero: String, // facilité de recherche / compat ancien

    client: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      nom: String,
      email: String,
      adresse: String,
      tel: String,
      codeTVA: String,
    },

    items: [itemSchema],

    totaux: {
      mtht: { type: Number, default: 0 },
      mtnetht: { type: Number, default: 0 },
      mttva: { type: Number, default: 0 },
      fodecPct: { type: Number, default: 1 },
      mfodec: { type: Number, default: 0 },
      timbre: { type: Number, default: 0 },
      mttc: { type: Number, default: 0 },
    },

    // 👇 méta multi-demandes
    meta: {
      demandes: [linkSchema], // toutes les DDV liées à ce devis
      demandeNumero: String,  // compat ancien si besoin
    },
  },
  { timestamps: true }
);

/* ---------- Index ---------- */
devisSchema.index({ createdAt: -1 }, { name: "devis_createdAt_-1" });
devisSchema.index({ demandeId: 1, createdAt: -1 }, { name: "devis_demandeId_createdAt" });
devisSchema.index({ "meta.demandes.id": 1, createdAt: -1 }, { name: "devis_meta_demandes_id_createdAt" });
devisSchema.index({ demandeNumero: 1, createdAt: -1 }, { name: "devis_demandeNumero_createdAt" });
devisSchema.index({ "meta.demandeNumero": 1, createdAt: -1 }, { name: "devis_meta_demandeNumero_createdAt" });
devisSchema.index({ "meta.demandes.numero": 1 }, { name: "devis_meta_demandes_numero_1" });
devisSchema.index({ "meta.demandes.type": 1, createdAt: -1 }, { name: "devis_meta_demandes_type_createdAt" });
devisSchema.index({ "client.nom": 1, createdAt: -1 }, { name: "devis_client_nom_createdAt" });

export default mongoose.model("Devis", devisSchema);
