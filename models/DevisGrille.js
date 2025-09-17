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
  matiere:  { type: String, enum: ["Acier galvanisé","Acier Noir"], required: true },
  finition: { type: String, enum: ["Peinture","Chromage","Galvanisation","Autre"], required: true },
}, { _id:false });

// ✅ PDF stocké sur Cloudinary (pas de Buffer en BDD)
const demandePdfSchema = new mongoose.Schema({
  filename:    { type: String, trim: true },
  contentType: { type: String, trim: true }, // application/pdf
  size:        { type: Number },
  url:         { type: String, trim: true }, // secure_url Cloudinary
  public_id:   { type: String, trim: true }, // pour destroy si besoin
}, { _id:false });

const schema = new mongoose.Schema({});
schema.add(devisBase);
schema.add({
  spec,
  demandePdf: demandePdfSchema,
});

// alléger les réponses JSON
schema.set("toJSON", {
  transform: (_doc, ret) => {
    if (Array.isArray(ret.documents)) {
      // on suppose que devisBase.documents = { filename, mimetype, size, url, public_id }
      ret.documents = ret.documents.map(d => ({
        filename: d.filename,
        mimetype: d.mimetype,
        size: d.size,
        url: d.url,
      }));
    }
    if (ret.demandePdf) {
      ret.demandePdf = {
        filename: ret.demandePdf.filename,
        contentType: ret.demandePdf.contentType,
        size: ret.demandePdf.size,
        url: ret.demandePdf.url,
      };
    }
    return ret;
  }
});

export default mongoose.model("DemandeDevisGrille", schema);
