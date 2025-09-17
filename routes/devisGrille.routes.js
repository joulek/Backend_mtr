// routes/devisGrille.routes.js
import { Router } from "express";
import auth, { only } from "../middlewares/auth.js";
import DevisGrille from "../models/DevisGrille.js";
import { createDevisGrille } from "../controllers/devisGrille.controller.js";
import { cloudinaryUploadArray } from "../middlewares/upload.js"; // ✅ Cloudinary

const router = Router();

/**
 * GET /api/devis/grille/paginated?q=&page=&pageSize=
 * - pagination + recherche (numero/nom/prenom)
 * - lookup vers devis(kind:"grille")
 * - projection légère (pas de binaire)
 */
router.get("/paginated", auth, only("admin"), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "10", 10)));
    const q = (req.query.q || "").trim();
    const regex = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

    const pipeline = [
      { $sort: { createdAt: -1, _id: -1 } },
      { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "u" } },
      { $unwind: { path: "$u", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          clientFull: {
            $trim: { input: { $concat: [{ $ifNull: ["$u.prenom",""] }, " ", { $ifNull: ["$u.nom",""] }] } }
          }
        }
      },
      ...(regex ? [{ $match: { $or: [{ numero: regex }, { clientFull: regex }] } }] : []),
      {
        $facet: {
          data: [
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize },
            {
              $lookup: {
                from: "devis",
                let: { demandeId: "$_id" },
                pipeline: [
                  { $match: { $expr: { $and: [ { $eq: ["$demande","$$demandeId"] }, { $eq: ["$kind","grille"] } ] } } },
                  { $project: { _id: 0, numero: 1, pdf: 1 } }
                ],
                as: "devis"
              }
            },
            { $addFields: { devis: { $arrayElemAt: ["$devis", 0] } } },
            // flag PDF basé sur l'URL
            { $addFields: { hasDemandePdf: { $gt: [ { $strLenCP: { $ifNull: ["$demandePdf.url", ""] } }, 0 ] } } },
            // documents légers
            {
              $project: {
                numero: 1,
                createdAt: 1,
                hasDemandePdf: 1,
                documents: {
                  $map: {
                    input: { $ifNull: ["$documents", []] },
                    as: "d",
                    in: { filename: "$$d.filename", size: "$$d.size", url: "$$d.url" }
                  }
                },
                user: { _id: "$u._id", prenom: "$u.prenom", nom: "$u.nom" },
                devis: 1
              }
            }
          ],
          total: [{ $count: "count" }]
        }
      },
      { $project: { items: "$data", total: { $ifNull: [{ $arrayElemAt: ["$total.count", 0] }, 0] } } }
    ];

    const [out = { items: [], total: 0 }] = await DevisGrille.aggregate(pipeline).allowDiskUse(true);
    res.json({ success: true, ...out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message || "Erreur serveur" });
  }
});

/** GET /api/devis/grille/:id/pdf — redirection vers l'URL Cloudinary */
router.get("/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const row = await DevisGrille.findById(req.params.id).select("demandePdf numero").lean();
    const url = row?.demandePdf?.url;
    if (!url) return res.status(404).json({ success: false, message: "PDF introuvable" });
    res.redirect(302, url);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Erreur lecture PDF" });
  }
});

/** GET /api/devis/grille/:id/document/:index — redirection vers URL Cloudinary */
router.get("/:id/document/:index", auth, only("admin"), async (req, res) => {
  try {
    const idx = Number(req.params.index);
    const row = await DevisGrille.findById(req.params.id).select("documents numero").lean();
    const doc = Array.isArray(row?.documents) ? row.documents[idx] : null;
    const url = doc?.url;
    if (!url) return res.status(404).json({ success: false, message: "Document introuvable" });
    res.redirect(302, url);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Erreur lecture document" });
  }
});

/** POST /api/devis/grille
 *  - mware Cloudinary uploade `docs` vers dossier `devis/grille_docs`
 *  - req.files: buffers (pour email)
 *  - req.cloudinaryFiles: { url, public_id, bytes, format }
 */
router.post(
  "/",
  auth,
  only("client"),
  ...cloudinaryUploadArray("docs", "devis/grille_docs"),
  createDevisGrille
);

export default router;
