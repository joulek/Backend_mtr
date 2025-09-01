// models/Reclamation.js
import mongoose from "mongoose";

const reclamationSchema = new mongoose.Schema({
  numero: { type: String, required: true, unique: true, index: true }, // ex: REC2500001
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true, 
    index: true 
  },

  // 📦 Informations sur la commande
  commande: {
    typeDoc: { 
      type: String, 
      enum: ["facture", "bon_livraison", "bon_commande", "devis"], 
      required: true 
    },
    numero: { type: String, required: true },
    dateLivraison: { type: Date },
    referenceProduit: { type: String },
    quantite: { type: Number, min: 0 },
  },

  // 📋 Nature de la réclamation
  nature: {
    type: String,
    enum: [
      "produit_non_conforme",   // dimensions, matière, finition
      "deterioration_transport",
      "erreur_quantite",
      "retard_livraison",
      "defaut_fonctionnel",
      "autre"
    ],
    required: true
  },
  description: { type: String }, // explication libre

  // 📎 Pièces jointes (ex: photos)
  piecesJointes: [{
    filename: String,
    mimetype: String,
    data: Buffer
  }],

  // ✅ Attente du client
  attente: {
    type: String,
    enum: ["remplacement", "reparation", "remboursement", "autre"],
    required: true
  },
   // 🆕 PDF de la réclamation (stocké après génération)
  demandePdf: {
    data: { type: Buffer, select: false },        // select:false pour éviter de charger des gros buffers sur les listes
    contentType: { type: String, default: "application/pdf" },
    generatedAt: { type: Date }
  },
}, { timestamps: true });

export default mongoose.models.Reclamation || mongoose.model("Reclamation", reclamationSchema);
