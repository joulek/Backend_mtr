// models/DevisAutre.js
import mongoose from "mongoose";
import { devisBase } from "./_devisBase.js";

// ---------- Sous-schema spécifique au formulaire "Autre article" ----------
const specSchema = new mongoose.Schema(
  {
    // Gardé pour compat (anciens enregistrements)
    titre: { type: String, trim: true },

    // Champs du formulaire
    designation: { type: String, required: true, trim: true }, // "Désignation / Référence *"
    dimensions:  { type: String, trim: true },                  // "Dimensions principales"
    quantite:    { type: Number, required: true, min: 1 },      // "Quantité *"

    // Matière sélectionnée (ou normalisée) — source de vérité
    matiere:     { type: String, trim: true },                  // "Matière *" OU valeur libre recopiée

    // Nouveau : texte libre quand l'utilisateur choisit "Autre" côté UI
    matiereAutre:{ type: String, trim: true },                  // "Autre matière (précisez)"

    description: { type: String, trim: true }                   // "Description de l'article"
  },
  { _id: false }
);

// Au moins l'un des deux champs matière doit être présent
specSchema.path("matiere").validate(function () {
  // `this` est le sous-doc spec
  return Boolean(this.matiere || this.matiereAutre);
}, "Le champ matière est requis.");

// Normalisation avant validation : si matiere est vide ou vaut "Autre", on copie matiereAutre
specSchema.pre("validate", function (next) {
  if ((!this.matiere || /^autre$/i.test(this.matiere)) && this.matiereAutre) {
    this.matiere = this.matiereAutre.trim();
  }
  // Renseigner un titre par défaut si absent
  if (!this.titre) {
    this.titre = this.designation?.trim()
      || (this.matiere ? `Article (${this.matiere})` : "Article");
  }
  next();
});

// ---------- PDF généré côté backend (accusé/demande) ----------
const demandePdfSchema = new mongoose.Schema(
  {
    filename:    { type: String, trim: true },
    contentType: { type: String, trim: true },
    size:        { type: Number },
    data:        Buffer
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

// (facultatif) alléger les réponses JSON en masquant les buffers
schema.set("toJSON", {
  transform: (_doc, ret) => {
    if (Array.isArray(ret.documents)) {
      ret.documents = ret.documents.map(f => ({
        filename: f.filename, mimetype: f.mimetype, size: f.size
      }));
    }
    if (ret.demandePdf) {
      ret.demandePdf = {
        filename: ret.demandePdf.filename,
        contentType: ret.demandePdf.contentType,
        size: ret.demandePdf.size
      };
    }
    return ret;
  }
});

export default mongoose.model("DemandeDevisAutre", schema);
