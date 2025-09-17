// models/DevisTorsion.js
import mongoose from "mongoose";
import { devisBase } from "./_devisBase.js";

const spec = new mongoose.Schema({
  d: { type: Number, required: true },
  De: { type: Number, required: true },
  Lc: { type: Number, required: true },
  angle: { type: Number, required: true },
  nbSpires: { type: Number, required: true },
  L1: { type: Number, required: true },
  L2: { type: Number, required: true },
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

// ✅ PDF stocké sur Cloudinary
const demandePdfSchema = new mongoose.Schema({
  filename:    { type: String, trim: true },
  contentType: { type: String, trim: true }, // application/pdf
  size:        { type: Number },
  url:         { type: String, trim: true }, // secure_url
  public_id:   { type: String, trim: true }, // pour destroy
}, { _id: false });

const schema = new mongoose.Schema({});
schema.add(devisBase);
schema.add({
  spec,
  demandePdf: demandePdfSchema,
});

schema.set("toJSON", {
  transform: (_doc, ret) => {
    if (Array.isArray(ret.documents)) {
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

export default mongoose.model("DemandeDevisTorsion", schema);
