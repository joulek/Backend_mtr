// models/DevisGrille.js
import mongoose from "mongoose";
import { devisBase } from "./_devisBase.js";

const spec = new mongoose.Schema({
  L:  { type: Number, required: true },    // longueur
  l:  { type: Number, required: true },    // largeur

  nbLong:  { type: Number, required: true }, // nb tiges longitudinales
  nbTrans: { type: Number, required: true }, // nb tiges transversales

  pas1: { type: Number, required: true },  // espacement longitudinal
  pas2: { type: Number, required: true },  // espacement transversal

  D2: { type: Number, required: true },    // diamètre du fil des tiges (D₂)
  D1: { type: Number, required: true },    // diamètre du fil du cadre (D₁)

  quantite: { type: Number, required: true },

  matiere: { type: String, enum: ["Acier galvanisé","Acier Noir"], required: true },
  finition: { type: String, enum: ["Peinture","Chromage","Galvanisation","Autre"], required: true },
}, { _id:false });

const schema = new mongoose.Schema({});
schema.add(devisBase);
schema.add({ 
  spec,
  demandePdf: {
    data: Buffer,
    contentType: String
  }
});

export default mongoose.model("DemandeDevisGrille", schema);
