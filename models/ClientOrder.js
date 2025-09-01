import mongoose from "mongoose";
const { Schema, Types } = mongoose;

const ClientOrderSchema = new Schema(
  {
    user:       { type: Types.ObjectId, ref: "User", required: true },
    demandeId:  { type: Types.ObjectId, required: true },
    demandeType:{ type: String, enum: ["autre","compression","traction","torsion","fil","grille"], required: true },
    devisNumero:{ type: String, default: null },
    status:     { type: String, enum: ["confirmed", "cancelled"], default: "confirmed" },
  },
  { timestamps: true }
);

// Un client ne peut confirmer qu'une fois une même demande
ClientOrderSchema.index({ user: 1, demandeId: 1 }, { unique: true });

export default mongoose.model("ClientOrder", ClientOrderSchema);
