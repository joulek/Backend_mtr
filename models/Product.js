// models/Product.js
import mongoose from "mongoose";
const { Schema } = mongoose;

const productSchema = new Schema(
  {
    // FR + EN
    name_fr:        { type: String, required: true, trim: true },
    name_en:        { type: String, trim: true, default: "" },
    description_fr: { type: String, trim: true, default: "" },
    description_en: { type: String, trim: true, default: "" },

    images: [{ type: String }], // URLs

    // Relation catégorie
    category: { type: Schema.Types.ObjectId, ref: "Category", required: true }
  },
  { timestamps: true }
);

// (optionnel) pour la recherche full-text
productSchema.index({
  name_fr: "text",
  name_en: "text",
  description_fr: "text",
  description_en: "text"
});

export default mongoose.model("Product", productSchema);
