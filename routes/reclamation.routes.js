// routes/reclamation.routes.js
import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";

// modèle (casse مهمة)
import Reclamation from "../models/reclamation.js";

// controllers
import {
  adminListReclamations,
  createReclamation,
  streamReclamationDocument,
  streamReclamationPdf,
} from "../controllers/reclamation.controller.js";

// auth
import auth, { requireAdmin } from "../middlewares/auth.js";

const router = Router();

/* ------------------- Multer (mémoire) ------------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,               // نفس قواعد الكنترولر
    fileSize: 5 * 1024 * 1024,
  },
});

/* ------------------------------------------------------------------ */
/*  Routes spécifiques أولاً                                           */
/* ------------------------------------------------------------------ */

/** [CLIENT] Mes réclamations (cursor pagination, خفيف) */
router.get("/me", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const cursor = (req.query.cursor || "").trim();

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

/** [CLIENT] Créer une réclamation (+ upload fichiers) */
router.post("/", auth, upload.array("piecesJointes"), createReclamation);

/** [ADMIN] Liste admin */
router.get("/admin", auth, requireAdmin, adminListReclamations);

/** [ADMIN] PDF d’une réclamation (stream) */
router.get("/admin/:id/pdf", auth, requireAdmin, streamReclamationPdf);

/** [ADMIN] Pièce jointe (stream) */
router.get("/admin/:id/document/:index", auth, requireAdmin, streamReclamationDocument);

/* ------------------------------------------------------------------ */
/*  Routes dynamiques (بعد /me و /admin*)                              */
/* ------------------------------------------------------------------ */

/** [CLIENT] Détail d’une réclamation (بدون buffer PDF) */
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

/** [CLIENT] PDF de la réclamation (stream) */
router.get("/:id/pdf", auth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "id invalide" });
    }

    // +select للبافر
    const rec = await Reclamation.findOne({ _id: id, user: req.user.id })
      .select("+demandePdf.data demandePdf.contentType demandePdf.generatedAt");

    if (!rec) return res.status(404).json({ success: false, message: "Réclamation introuvable" });
    if (!rec.demandePdf?.data?.length) {
      return res.status(404).json({ success: false, message: "PDF indisponible" });
    }

    const buf = Buffer.isBuffer(rec.demandePdf.data)
      ? rec.demandePdf.data
      : Buffer.from(rec.demandePdf.data.buffer);

    res.setHeader("Content-Type", rec.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Content-Disposition", `inline; filename="reclamation-${id}.pdf"`);
    return res.end(buf);
  } catch (err) {
    console.error("GET /reclamations/:id/pdf error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

export default router;
