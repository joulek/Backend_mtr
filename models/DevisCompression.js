// models/DevisCompression.js
import mongoose from "mongoose";
import { devisBase } from "./_devisBase.js";

const spec = new mongoose.Schema({
  d: { type: Number, required: true },
  DE: { type: Number, required: true },
  H: Number,
  S: Number,
  DI: { type: Number, required: true },
  Lo: { type: Number, required: true },
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

// ⚡ PDF Cloudinary (plus de Buffer)
const demandePdfSchema = new mongoose.Schema({
  filename:    { type: String, trim: true },
  contentType: { type: String, trim: true },  // application/pdf
  size:        { type: Number },
  url:         { type: String, trim: true },  // secure_url Cloudinary
  public_id:   { type: String, trim: true },  // pour suppression si besoin
}, { _id: false });

const schema = new mongoose.Schema({});
schema.add(devisBase);
schema.add({
  spec,
  demandePdf: demandePdfSchema,
});

// alléger les réponses
schema.set("toJSON", {
  transform: (_doc, ret) => {
    if (Array.isArray(ret.documents)) {
      // on suppose que devisBase.documents contient { filename, mimetype, size, url, public_id }
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

export default mongoose.model("DemandeDevisCompression", schema);
