// models/DevisCompression.js
import mongoose from "mongoose";
import { devisBase } from "./_devisBase.js";

const spec = new mongoose.Schema({
  d: { type: Number, required: true },   // diamètre du fil (d)
  DE: { type: Number, required: true },   // diamètre extérieur (DE)
  H: Number,                              // alésage (H)
  S: Number,                              // guide (S)
  DI: { type: Number, required: true },   // diamètre intérieur (DI)
  Lo: { type: Number, required: true },   // longueur libre (Lo)
  nbSpires: { type: Number, required: true },
  pas: Number,

  quantite: { type: Number, required: true },
  matiere: {
    type: String,
    enum: [
      "Fil ressort noir SH",
      "Fil ressort noir SM",
      "Fil ressort galvanisé",
      "Fil ressort inox",
    ],
    required: true,
  },
  enroulement: { type: String, enum: ["Enroulement gauche", "Enroulement droite"] },
  extremite: { type: String, enum: ["ERM", "EL", "ELM", "ERNM"] },
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


export default mongoose.model("DemandeDevisCompression", schema);
