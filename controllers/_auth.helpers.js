// controllers/_auth.helpers.js
import crypto from "crypto";

export function normalizeAccountType(v = "personnel") {
  const s = String(v).trim().toLowerCase();
  if (["societe", "société", "soci\u00E9t\u00E9"].includes(s)) return "societe";
  return "personnel";
}

export function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}
