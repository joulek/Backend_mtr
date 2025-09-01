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

const schema = new mongoose.Schema({});
schema.add(devisBase);
schema.add({ 
  spec,
  demandePdf: {
    data: Buffer,
    contentType: String
  }
});

export default mongoose.model("DemandeDevisFilDresse", schema);
