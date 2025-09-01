import path from "path";
import fs from "fs";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import { makeTransport } from "../utils/mailer.js";

import DemandeAutre from "../models/DevisAutre.js";
import DemandeCompression from "../models/DevisCompression.js";
import DemandeTraction from "../models/DevisTraction.js";
import DemandeTorsion from "../models/DevisTorsion.js";
import DemandeFilDresse from "../models/DevisFilDresse.js";
import DemandeGrille from "../models/DevisGrille.js";
import ClientOrder from "../models/ClientOrder.js"; // <— NEW
import User from "../models/User.js";               // <— pour compléter email/tel si besoin

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ORIGIN = process.env.PUBLIC_BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;

const DEMANDE_MODELS = [
  { type: "autre",       Model: DemandeAutre },
  { type: "compression", Model: DemandeCompression },
  { type: "traction",    Model: DemandeTraction },
  { type: "torsion",     Model: DemandeTorsion },
  { type: "fil",         Model: DemandeFilDresse },
  { type: "grille",      Model: DemandeGrille },
];

async function findOwnedDemande(demandeId, userId) {
  for (const { type, Model } of DEMANDE_MODELS) {
    const doc = await Model.findById(demandeId).populate("user");
    if (doc && String(doc.user?._id) === String(userId)) return { type, doc };
  }
  return null;
}

function buildAttachmentFromPdfInfo(devisNumero, devisPdf) {
  if (devisNumero) {
    const filename = `${devisNumero}.pdf`;
    const localPath = path.resolve(process.cwd(), "storage", "devis", filename);
    if (fs.existsSync(localPath)) return { filename, path: localPath };
  }
  if (devisPdf) {
    const filename = `${devisNumero || "devis"}.pdf`;
    return { filename, path: devisPdf };
  }
  return null;
}

/** POST /api/order/client/commander */
function isValidEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export async function placeClientOrder(req, res) {
  try {
    const { demandeId, devisNumero, devisPdf, demandeNumero, note = "" } = req.body || {};
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ success:false, message:"Non authentifié" });
    if (!demandeId) return res.status(400).json({ success:false, message:"demandeId manquant" });

    const owned = await findOwnedDemande(demandeId, userId);
    if (!owned) return res.status(403).json({ success:false, message:"Accès interdit" });
    const { type, doc: demande } = owned;

    await ClientOrder.findOneAndUpdate(
      { user: userId, demandeId },
      { $set: { status: "confirmed", demandeType: type, devisNumero: devisNumero || null } },
      { upsert: true, new: true }
    );

    const dbUser = await User.findById(userId).select("prenom nom email tel numTel").lean().catch(() => null);
    const uEmail  = (req.user?.email  || dbUser?.email  || "").trim();
    const uTel    = (req.user?.tel    || dbUser?.tel    || dbUser?.numTel || "").trim();
    const uPrenom = (req.user?.prenom || dbUser?.prenom || "").trim();
    const uNom    = (req.user?.nom    || dbUser?.nom    || "").trim();
    const clientDisplay = (uPrenom || uNom) ? `${uPrenom} ${uNom}`.trim() : (uEmail || "Client");

    const subject = `Commande confirmée – ${devisNumero ? `Devis ${devisNumero}` : `Demande ${demandeNumero || demande.numero || demandeId}`}`;
    const devisAttachment = buildAttachmentFromPdfInfo(devisNumero, devisPdf);
    const devisLink = devisPdf || (devisNumero ? `${ORIGIN}/files/devis/${devisNumero}.pdf` : null);

    const lines = [
      `Bonjour,`,
      ``,
      `Un client confirme une commande :`,
      `• Client : ${clientDisplay}`,
      `• Email : ${uEmail || "-"}`,
      `• Téléphone : ${uTel || "-"}`,
      `• N° Demande : ${demandeNumero || demande.numero || demandeId}`,
      devisNumero ? `• N° Devis : ${devisNumero}` : null,
      devisLink ? `• Lien PDF devis : ${devisLink}` : null,
      `• Type : ${type}`,
      note ? `• Note : ${note}` : null,
      ``,
      `Merci.`,
    ].filter(Boolean);

    // 🔹 MINIMAL FIX: destinataires propres
    const adminToRaw = (process.env.ADMIN_EMAIL || "").trim();
    const adminTo = isValidEmail(adminToRaw) ? adminToRaw : "joulekyosr123@gmail.com"; // fallback si ENV absent/mal saisi
    const cc = isValidEmail(uEmail) ? [uEmail] : undefined;

    const transport = makeTransport();
    transport.sendMail({
          from: cc,
          to: adminTo, // admin en T                 // client en CC (si email valide)
          subject,
          text: lines.join("\n"),
          attachments: devisAttachment ? [devisAttachment] : [],
      });

    return res.json({ success:true, message:"Commande confirmée" });
  } catch (err) {
    console.error("placeClientOrder error:", err);
    return res.status(500).json({ success:false, message:"Erreur envoi commande" });
  }
}


/** GET /api/order/client/status?ids=ID1,ID2,... => { map: { [demandeId]: boolean } } */
export async function getClientOrderStatus(req, res) {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ success:false, message:"Non authentifié" });

    const ids = String(req.query.ids || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    if (!ids.length) return res.json({ success:true, map: {} });

    const objIds = ids.map((s) => new mongoose.Types.ObjectId(s));
    const rows = await ClientOrder.find({ user: userId, demandeId: { $in: objIds } })
      .select("demandeId status")
      .lean();

    const map = {};
    for (const id of ids) map[id] = false;
    for (const r of rows) map[String(r.demandeId)] = r.status === "confirmed";

    return res.json({ success:true, map });
  } catch (err) {
    console.error("getClientOrderStatus error:", err);
    return res.status(500).json({ success:false, message:"Erreur serveur" });
  }
}
