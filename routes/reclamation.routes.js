// routes/reclamation.routes.js
import { Router } from "express";
import mongoose from "mongoose";

// ⚠️ Respecte la casse exacte de ton fichier modèle
import Reclamation from "../models/reclamation.js";

// Si tes controllers existent déjà, on les garde
import {
  adminListReclamations,
  createReclamation,
  streamReclamationDocument,
  streamReclamationPdf,
} from "../controllers/reclamation.controller.js";

// ⚠️ Dans ton projet, c'était souvent "middlewares/auth.js"
import  auth , { requireAdmin } from "../middleware/auth.js";

const router = Router();

/* ------------------------------------------------------------------ */
/*  IMPORTANT : Ordre des routes → d’abord les chemins spécifiques     */
/*  puis les dynamiques '/:id'                                         */
/* ------------------------------------------------------------------ */

/** [CLIENT] Mes réclamations (liste, sans buffer PDF) */
/** [CLIENT] Mes réclamations rapides avec cursor pagination */
// routes/reclamation.routes.js (extrait)
router.get("/me", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const cursor = (req.query.cursor || "").trim();

    // ✔️ On inclut maintenant les champs attendus par le front
    //    - champs racine (numero, nature, attente, status, createdAt, updatedAt)
    //    - champs imbriqués: commande.typeDoc, commande.numero
    //    - état du PDF: demandePdf.generatedAt
    const PROJECTION = [
      "numero",
      "nature",
      "attente",
      "status",
      "createdAt",
      "updatedAt",
      "commande.typeDoc",
      "commande.numero",
      "demandePdf.generatedAt",
    ].join(" ");

    const filter = { user: userId };
    if (cursor && mongoose.isValidObjectId(cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const rows = await Reclamation.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .select(PROJECTION)
      .lean();

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? String(items[items.length - 1]._id) : null;

    res.json({ success: true, items, nextCursor });
  } catch (err) {
    console.error("GET /reclamations/me error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});



/** [CLIENT] Créer une réclamation */
router.post("/", auth, createReclamation);

/** [ADMIN] Liste admin */
router.get("/admin", auth, requireAdmin, adminListReclamations);

/** [ADMIN] PDF d’une réclamation (stream) */
router.get("/admin/:id/pdf", auth, requireAdmin, streamReclamationPdf);

/** [ADMIN] Pièce jointe d’une réclamation (stream) */
router.get("/admin/:id/document/:index", auth, requireAdmin, streamReclamationDocument);

/* ------------------------------------------------------------------ */
/*  Routes dynamiques client (après /me et /admin*)                    */
/* ------------------------------------------------------------------ */

/** [CLIENT] Détail d’une réclamation (sans buffer PDF) */
router.get("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "id invalide" });
    }
    const item = await Reclamation.findOne({ _id: id, user: req.user.id })
      .select("-demandePdf.data")
      .lean();
    if (!item) return res.status(404).json({ success: false, message: "Introuvable" });
    res.json({ success: true, item });
  } catch (err) {
    console.error("GET /reclamations/:id error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

/** [CLIENT] PDF de la réclamation (inclure le buffer) */
router.get("/:id/pdf", auth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "id invalide" });
    }

    // Inclure le buffer via +select
    const rec = await Reclamation.findOne({ _id: id, user: req.user.id })
      .select("+demandePdf.data demandePdf.contentType demandePdf.generatedAt");

    if (!rec) {
      return res.status(404).json({ success: false, message: "Réclamation introuvable" });
    }
    if (!rec.demandePdf?.data?.length) {
      return res.status(404).json({ success: false, message: "PDF indisponible" });
    }

    res.setHeader("Content-Type", rec.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="reclamation-${rec._id}.pdf"`);
    return res.send(rec.demandePdf.data);
  } catch (err) {
    console.error("GET /reclamations/:id/pdf error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

export default router;
