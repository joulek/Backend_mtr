// models/DevisTorsion.js
import mongoose from "mongoose";
import { devisBase } from "./_devisBase.js";

const spec = new mongoose.Schema({
  d: { type: Number, required: true },
  De: { type: Number, required: true },        // diamètre extérieur (De)
  Lc: { type: Number, required: true },        // longueur du corps
  angle: { type: Number, required: true },     // angle entre les branches (°)
  nbSpires: { type: Number, required: true },

  L1: { type: Number, required: true },        // longueur branche 1
  L2: { type: Number, required: true },        // longueur branche 2

  quantite: { type: Number, required: true },
  matiere: {
    type: String,
    enum: [
      "Fil ressort noir SH",
      "Fil ressort noir SM",
      "Fil ressort galvanisé",
      "Fil ressort inox",
    ],
    required: true
  },
  enroulement: {
    type: String,
    enum: ["Enroulement gauche", "Enroulement droite"],
    required: true
  },
}, { _id: false });

const schema = new mongoose.Schema({});
schema.add(devisBase);
schema.add({
  spec,
  demandePdf: {
    data: Buffer,
    contentType: String
  }
});

export default mongoose.model("DemandeDevisTorsion", schema);
