// models/category.js
import mongoose from "mongoose";

const imageSchema = new mongoose.Schema(
  {
    url:       { type: String, trim: true, required: true }, // secure_url Cloudinary
    public_id: { type: String, trim: true, required: true }, // identifiant Cloudinary (pour destroy)
    format:    { type: String, trim: true },                 // jpg, png, webp...
    bytes:     { type: Number },                             // taille
    alt_fr:    { type: String, trim: true },
    alt_en:    { type: String, trim: true },
  },
  { _id: false }
);

const categorySchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true },
  translations: {
    fr: {
      type: String,
      required: true,
      default: function () { return this.label; },
    },
    en: { type: String },
  },
  image: imageSchema,          // une seule image (Cloudinary)
  // images: { type: [imageSchema], default: [] }, // si tu veux plusieurs
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Category", categorySchema);
