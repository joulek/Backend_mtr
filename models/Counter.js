// models/Counter.js
import mongoose from "mongoose";

const counterSchema = new mongoose.Schema({
  _id: { type: String },     // ex: "devis:2025"
  seq: { type: Number, default: 0 },
  key: { type: String, unique: true, index: true }, // ex: "devis-25"
}, { versionKey: false });

export default mongoose.models.Counter || mongoose.model("Counter", counterSchema);
