// models/_devisBase.js
import mongoose from "mongoose";

export const devisBase = new mongoose.Schema({
  numero: { type: String, required: true, unique: true, index: true }, // ✅ DV2500016
  user:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type:   { type: String, enum: ["compression","traction","torsion","fil","grille","autre"], required: true, index: true },

documents: [{
  filename: String,
  mimetype: String,
  data: Buffer   // Contenu du fichier
}]

,
  exigences: String,
  remarques: String,
}, { timestamps: true });
