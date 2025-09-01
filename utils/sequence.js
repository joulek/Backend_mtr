// utils/sequence.js
import Counter from "../models/Counter.js";

/** nextNumber("R", 2025, 5) => R25 + 00001 => R2500001 */
export async function nextNumber(prefix, year, width = 5, bucket = "reclamation") {
  const key = `${bucket}:${year}`; // ex: "reclamation:2025"
  const c = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  ).lean();
  const yy = String(year).slice(-2);
  const padded = String(c.seq).padStart(width, "0");
  return `${prefix}${yy}${padded}`;
}

/** Retente en cas d’E11000 sur l’index unique "numero" */
export async function withUniqueRetry(fn, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (err?.code === 11000 && /numero_1/.test(err?.message || "")) { lastErr = err; continue; }
      throw err;
    }
  }
  throw lastErr || new Error("Unique retry failed");
}
