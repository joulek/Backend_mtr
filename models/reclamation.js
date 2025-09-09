// models/reclamation.js
import mongoose from "mongoose";

const pieceJointeSchema = new mongoose.Schema(
  {
    filename: String,
    mimetype: String,
    data: Buffer,
  },
  { _id: false }
);

const commandeSchema = new mongoose.Schema(
  {
    typeDoc: {
      type: String,
      enum: ["facture", "bon_livraison", "bon_commande", "devis"],
      required: true,
    },
    numero: { type: String, required: true },
    dateLivraison: { type: Date },
    referenceProduit: { type: String },
    quantite: { type: Number, min: 0 },
  },
  { _id: false }
);

const reclamationSchema = new mongoose.Schema(
  {
    numero: { type: String, required: true, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    commande: { type: commandeSchema, default: {} },

    // ⬇️ pas d'enum pour accepter le texte libre quand "Autre"
    nature: { type: String, required: true },   // ex: "retard_livraison" ou "a"
    attente: { type: String, required: true },  // ex: "remplacement" ou "b"

    // optionnel (on le laisse إن لزم الأمر)
    description: { type: String },

    piecesJointes: { type: [pieceJointeSchema], default: [] },

    demandePdf: {
      data: { type: Buffer, select: false },
      contentType: { type: String, default: "application/pdf" },
      generatedAt: { type: Date },
    },
  },
  { timestamps: true }
);

export default mongoose.models.Reclamation ||
  mongoose.model("Reclamation", reclamationSchema);
