// models/Article.js
import mongoose from "mongoose";
const { Schema } = mongoose;

const articleSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true, immutable: true },
    designation: { type: String, required: true, trim: true },
    prixHT: { type: Number, required: true, min: 0 },
    type: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    numeroDevis: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.models.Article ||
  mongoose.model("Article", articleSchema);
