import mongoose from "mongoose";

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, trim: true, required: true }, // ex: '/uploads/categories/xxx.jpg' ou URL complète
    alt_fr: { type: String, trim: true },
    alt_en: { type: String, trim: true },
  },
  { _id: false }
);

const categorySchema = new mongoose.Schema({
  label: {
    type: String,
    required: true,
    trim: true,
  },
  translations: {
    fr: {
      type: String,
      required: true,
      default: function () {
        return this.label;
      },
    },
    en: { type: String },
  },
  image: imageSchema, // une seule image pour la catégorie
  // 👉 Si tu veux plusieurs images, utilise plutôt:
  // images: { type: [imageSchema], default: [] },

  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Category", categorySchema);
