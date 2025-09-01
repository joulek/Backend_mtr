// models/DevisTraction.js
import mongoose from "mongoose";
import { devisBase } from "./_devisBase.js";

const spec = new mongoose.Schema({
  d: { type: Number, required: true },
  De: { type: Number, required: true },
  Lo: { type: Number, required: true },
  nbSpires: { type: Number, required: true },

  quantite: { type: Number, required: true },
  matiere: {
    type: String,
    enum: [
      "Fil ressort noir SM",
      "Fil ressort noir SH",
      "Fil ressort galvanisé",
      "Fil ressort inox",
    ],
    required: true,
  },
  enroulement: {
    type: String,
    enum: ["Enroulement gauche", "Enroulement droite"],
    required: true
  },

  positionAnneaux: {
    type: String,
    enum: ["0°", "90°", "180°", "270°"],
    required: true
  },
  typeAccrochage: {
    type: String,
    enum: [
      "Anneau Allemand", "Double Anneau Allemand", "Anneau tangent", "Anneau allongé",
      "Boucle Anglaise", "Anneau tournant", "Conification avec vis"
    ],
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

export default mongoose.model("DemandeDevisTraction", schema);
