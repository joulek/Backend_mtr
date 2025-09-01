// utils/numbering.js
import Counter from "../models/Counter.js";

/**
 * Donne un aperçu du prochain numéro de devis (sans incrémenter).
 */
export async function previewDevisNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2); // ex: "25"
  const key = `devis-${yy}`;

  const c = await Counter.findOne({ key });
  const next = ((c?.seq ?? 0) + 1);
  return `DV${yy}${String(next).padStart(5, "0")}`;
}
export async function nextDevisNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const key = `devis-${yy}`;

  const doc = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return `DV${yy}${String(doc.seq).padStart(5, "0")}`;
}