// models/DevisAutre.js
import mongoose from "mongoose";
import { devisBase } from "./_devisBase.js";

// ---------- Sous-schema spécifique au formulaire "Autre article" ----------
const specSchema = new mongoose.Schema(
  {
    titre: { type: String, trim: true },
    designation: { type: String, required: true, trim: true },
    dimensions:  { type: String, trim: true },
    quantite:    { type: Number, required: true, min: 1 },
    matiere:     { type: String, trim: true },
    matiereAutre:{ type: String, trim: true },
    description: { type: String, trim: true }
  },
  { _id: false }
);

specSchema.path("matiere").validate(function () {
  return Boolean(this.matiere || this.matiereAutre);
}, "Le champ matière est requis.");

specSchema.pre("validate", function (next) {
  if ((!this.matiere || /^autre$/i.test(this.matiere)) && this.matiereAutre) {
    this.matiere = this.matiereAutre.trim();
  }
  if (!this.titre) {
    this.titre = this.designation?.trim()
      || (this.matiere ? `Article (${this.matiere})` : "Article");
  }
  next();
});

// ---------- PDF généré côté backend (accusé/demande) ----------
// ⚡ Version Cloudinary (plus de Buffer en DB)
const demandePdfSchema = new mongoose.Schema(
  {
    filename:    { type: String, trim: true },
    contentType: { type: String, trim: true },   // "application/pdf"
    size:        { type: Number },
    url:         { type: String, trim: true },   // secure_url Cloudinary
    public_id:   { type: String, trim: true },   // pour suppression si besoin
  },
  { _id: false }
);

// ---------- Schéma principal ----------
const schema = new mongoose.Schema({});
schema.add(devisBase);
schema.add({
  spec: specSchema,
  demandePdf: demandePdfSchema
});

// (facultatif) alléger les réponses JSON
schema.set("toJSON", {
  transform: (_doc, ret) => {
    if (Array.isArray(ret.documents)) {
      // on suppose que devisBase.documents contient désormais { filename, mimetype, size, url, public_id }
      ret.documents = ret.documents.map(f => ({
        filename: f.filename, mimetype: f.mimetype, size: f.size, url: f.url
      }));
    }
    if (ret.demandePdf) {
      ret.demandePdf = {
        filename: ret.demandePdf.filename,
        contentType: ret.demandePdf.contentType,
        size: ret.demandePdf.size,
        url: ret.demandePdf.url
      };
    }
    return ret;
  }
});

export default mongoose.model("DemandeDevisAutre", schema);
