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

// ✅ PDF stocké sur Cloudinary
const demandePdfSchema = new mongoose.Schema({
  filename:    { type: String, trim: true },
  contentType: { type: String, trim: true }, // application/pdf
  size:        { type: Number },
  url:         { type: String, trim: true }, // secure_url
  public_id:   { type: String, trim: true }, // pour destroy si besoin
}, { _id: false });

const schema = new mongoose.Schema({});
schema.add(devisBase);
schema.add({ spec, demandePdf: demandePdfSchema });

schema.set("toJSON", {
  transform: (_doc, ret) => {
    if (Array.isArray(ret.documents)) {
      // on suppose que devisBase.documents = { filename, mimetype, size, url, public_id }
      ret.documents = ret.documents.map(d => ({
        filename: d.filename, mimetype: d.mimetype, size: d.size, url: d.url
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

export default mongoose.model("DemandeDevisTraction", schema);
