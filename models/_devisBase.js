// models/_devisBase.js
import mongoose from "mongoose";

export const devisBase = new mongoose.Schema({
  numero: { type: String, required: true, unique: true, index: true },
  user:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type:   { type: String, enum: ["compression","traction","torsion","fil","grille","autre"], required: true, index: true },

  // ✅ fichiers Cloudinary (plus de Buffer)
  documents: [{
    filename:  String,
    mimetype:  String,
    size:      Number,  // bytes
    url:       String,  // secure_url
    public_id: String,  // pour delete si besoin
  }],

  exigences: String,
  remarques: String,
}, { timestamps: true });
