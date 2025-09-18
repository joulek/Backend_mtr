// routes/devisAutre.routes.js
import { Router } from "express";
import auth, { only } from "../middlewares/auth.js";
import DevisAutre from "../models/DevisAutre.js";
import { createDevisAutre } from "../controllers/devisAutre.controller.js";
import { cloudinaryUploadArray } from "../middlewares/upload.js"; // ⚡ nouveau middlewares

const router = Router();

/**
 * GET /api/devis/autre/paginated?q=&page=&pageSize=
 * - pagination + recherche (numero/nom/prenom)
 * - lookup vers "devis" kind:"autre"
 * - projection légère, plus de $binarySize (on n'a plus de buffers)
 */
router.get("/paginated", auth, only("admin"), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "10", 10)));
    const q = (req.query.q || "").trim();
    const regex = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

    const pipeline = [
      { $sort: { createdAt: -1, _id: -1 } },

      // join user
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

            // lookup vers devis(kind:"autre")
            {
              $lookup: {
                from: "devis",
                let: { demandeId: "$_id" },
                pipeline: [
                  { $match: { $expr: { $and: [ { $eq: ["$demande","$$demandeId"] }, { $eq: ["$kind","autre"] } ] } } },
                  { $project: { _id: 0, numero: 1, pdf: 1 } }
                ],
                as: "devis"
              }
            },
            { $addFields: { devis: { $arrayElemAt: ["$devis", 0] } } },

            // hasDemandePdf flag (basé sur l'URL, plus de binaire)
            {
              $addFields: {
                hasDemandePdf: {
                  $gt: [ { $strLenCP: { $ifNull: ["$demandePdf.url", ""] } }, 0 ]
                }
              }
            },

            // documents (on renvoie nom/size/url)
            {
              $project: {
                numero: 1,
                createdAt: 1,
                hasDemandePdf: 1,
                documents: {
                  $map: {
                    input: { $ifNull: ["$documents", []] },
                    as: "d",
                    in: {
                      filename: "$$d.filename",
                      size: "$$d.size",
                      url: "$$d.url"
                    }
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

    const [out = { items: [], total: 0 }] = await DevisAutre.aggregate(pipeline).allowDiskUse(true);
    res.json({ success: true, ...out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message || "Erreur serveur" });
  }
});

/** GET /api/devis/autre/:id/pdf — redirection vers Cloudinary */
router.get("/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const row = await DevisAutre.findById(req.params.id).select("demandePdf numero").lean();
    const url = row?.demandePdf?.url;
    if (!url) return res.status(404).json({ success: false, message: "PDF introuvable" });
    // 302 vers l'URL Cloudinary (le navigateur affichera en inline)
    res.redirect(302, url);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Erreur lecture PDF" });
  }
});

/** GET /api/devis/autre/:id/document/:index — redirection vers l'URL Cloudinary */
router.get("/:id/document/:index", auth, only("admin"), async (req, res) => {
  try {
    const idx = Number(req.params.index);
    const row = await DevisAutre.findById(req.params.id).select("documents numero").lean();
    const doc = Array.isArray(row?.documents) ? row.documents[idx] : null;
    const url = doc?.url;
    if (!url) return res.status(404).json({ success: false, message: "Document introuvable" });
    res.redirect(302, url);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Erreur lecture document" });
  }
});

/** POST /api/devis/autre (client)
 *  - middlewares Cloudinary uploade les fichiers dans "devis/autre_docs"
 *  - req.files        : buffers mémoire (pour mail)
 *  - req.cloudinaryFiles : { url, public_id, bytes, format }
 */

router.get("/client/by-demande/:demandeId", auth, async (req, res) => {
  try {
    const { demandeId } = req.params;

    // adapte le critère à ton schéma : ici on suppose que "demandeId" est stocké
    // et qu'on a le champ devisPdfUrl (Cloudinary) + numero.
    const dv = await Devis.findOne({ demandeId, user: req.user.id })
      .select("numero devisPdfUrl")
      .lean();

    if (!dv) return res.status(404).json({ success: true, exists: false });

    // dv.devisPdfUrl : mets le bon champ (ex: dv.pdf.url si tu stockes un objet)
    if (!dv.devisPdfUrl) {
      return res.json({ success: true, exists: true, devis: { numero: dv.numero || null }, pdf: null });
    }

    return res.json({
      success: true,
      exists: true,
      devis: { numero: dv.numero || null },
      pdf: dv.devisPdfUrl, // URL Cloudinary publique
    });
  } catch (e) {
    console.error("GET /api/devis/client/by-demande error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.post(
  "/",
  auth,
  only("client"),
  ...cloudinaryUploadArray("docs", "devis/autre_docs"),
  createDevisAutre
);

export default router;
