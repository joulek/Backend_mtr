// routes/devisFil.routes.js
import { Router } from "express";
import multer from "multer";
import auth, { only } from "../middleware/auth.js";

import DevisFilDresse from "../models/DevisFilDresse.js"; // ← بدّل الاسم إذا موديلك مختلف
import { createDevisFilDresse } from "../controllers/devisFilDresse.controller.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

function toBuffer(maybe) {
  if (!maybe) return null;
  if (Buffer.isBuffer(maybe)) return maybe;
  if (maybe?.type === "Buffer" && Array.isArray(maybe?.data)) return Buffer.from(maybe.data);
  if (maybe?.buffer && Buffer.isBuffer(maybe.buffer)) return Buffer.from(maybe.buffer);
  try { return Buffer.from(maybe); } catch { return null; }
}

/**
 * GET /api/devis/fil/paginated?q=&page=&pageSize=
 * - pagination + search (numero أو nom/prenom)
 * - batch $lookup للـ devis (kind ∈ ["fil","fil_dresse_coupe"]) لتفادي N+1
 * - يرجّع فقط البيانات الخفيفة + فلاغ hasDemandePdf
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
          clientFull: { $trim: { input: { $concat: [{ $ifNull:["$u.prenom",""] }," ",{ $ifNull:["$u.nom",""] }] } } }
        }
      },
      ...(regex ? [{ $match: { $or: [{ numero: regex }, { clientFull: regex }] } }] : []),
      {
        $facet: {
          data: [
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize },

            // 🔎 لو الكولكشن متاع الفواتير اسمو غير "devis" بدّلو تحت
            {
              $lookup: {
                from: "devis",
                let: { demandeId: "$_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ["$demande", "$$demandeId"] }, // بدّل إذا تربط بالـ numero
                          { $in: ["$kind", ["fil", "fil_dresse_coupe"]] }
                        ]
                      }
                    }
                  },
                  { $project: { _id: 0, numero: 1, pdf: 1 } }
                ],
                as: "devis"
              }
            },
            { $addFields: { devis: { $arrayElemAt: ["$devis", 0] } } },

            // فلاغ PDF + حجم المرفقات محسوب (بدون إرجاع الـ binary)
            {
              $addFields: {
                hasDemandePdf: {
                  $and: [
                    { $ne: ["$demandePdf", null] },
                    { $gt: [{ $binarySize: { $ifNull: ["$demandePdf.data", []] } }, 0] }
                  ]
                }
              }
            },
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
                      size: {
                        $cond: [
                          { $gt: [{ $ifNull: ["$$d.data", null] }, null] },
                          { $binarySize: "$$d.data" },
                          0
                        ]
                      }
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

    const [out = { items: [], total: 0 }] = await DevisFilDresse.aggregate(pipeline).allowDiskUse(true);
    res.json({ success: true, ...out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message || "Erreur serveur" });
  }
});

/** GET /api/devis/fil/:id/pdf */
router.get("/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const row = await DevisFilDresse.findById(req.params.id).select("demandePdf numero").lean();
    const buf = toBuffer(row?.demandePdf?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "PDF introuvable" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Content-Disposition", `inline; filename="devis-fil-${row?.numero || row?._id}.pdf"`);
    res.end(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Erreur lecture PDF" });
  }
});

/** GET /api/devis/fil/:id/document/:index */
router.get("/:id/document/:index", auth, only("admin"), async (req, res) => {
  try {
    const idx = Number(req.params.index);
    const row = await DevisFilDresse.findById(req.params.id).select("documents numero").lean();
    const doc = Array.isArray(row?.documents) ? row.documents[idx] : null;
    const buf = toBuffer(doc?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "Document introuvable" });

    const name = (doc?.filename || `document-${idx + 1}`).replace(/["]/g, "");
    res.setHeader("Content-Type", doc?.mimetype || "application/octet-stream");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    res.end(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Erreur lecture document" });
  }
});

/** POST /api/devis/fil  (client) */
router.post("/", auth, only("client"), upload.array("docs"), createDevisFilDresse);

export default router;
