// models/DevisFilDresse.js
import mongoose from "mongoose";
import { devisBase } from "./_devisBase.js";

const spec = new mongoose.Schema({
  longueurValeur: { type: Number, required: true },
  longueurUnite:  { type: String, enum: ["mm","m"], required: true },
  diametre:       { type: Number, required: true },

  quantiteValeur: { type: Number, required: true },
  quantiteUnite:  { type: String, enum: ["pieces","kg"], required: true },

  matiere: { type: String, enum: ["Acier galvanisé","Acier Noir","Acier ressort","Acier inoxydable"], required: true },
}, { _id:false });

// ✅ demandePdf Cloudinary (ما عادش Buffer)
const demandePdfSchema = new mongoose.Schema({
  filename:    { type: String, trim: true },
  contentType: { type: String, trim: true },   // application/pdf
  size:        { type: Number },
  url:         { type: String, trim: true },   // secure_url Cloudinary
  public_id:   { type: String, trim: true },   // destroy إذا لزم
}, { _id:false });

const schema = new mongoose.Schema({});
schema.add(devisBase);
schema.add({
  spec,
  demandePdf: demandePdfSchema,
});

// تخفيف الردود
schema.set("toJSON", {
  transform: (_doc, ret) => {
    if (Array.isArray(ret.documents)) {
      // نفترض devisBase.documents فيه { filename, mimetype, size, url, public_id }
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

export default mongoose.model("DemandeDevisFilDresse", schema);
