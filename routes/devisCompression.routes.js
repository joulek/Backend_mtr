// routes/devisCompression.routes.js
import { Router } from "express";
import multer from "multer";
import auth, { only } from "../middleware/auth.js";

import { createDevisCompression } from "../controllers/devisCompression.controller.js";
import DevisCompression from "../models/DevisCompression.js";
// إذا عندك Model للـ devis (الفواتير) ومحتاجو في مكان آخر، يبقى التجميع هنا كافي عبر $lookup

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * GET /api/devis/compression/paginated?q=&page=&pageSize=
 * - Pagination + search (numero أو اسم/لقب)
 * - Batch-lookup للـ devis (تفادي N+1)
 * - لا نرجّعش بيانات binary (خفيف)
 */
router.get("/paginated", auth, only("admin"), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "10", 10)));
    const q = (req.query.q || "").trim();
    const regex = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

    const pipeline = [
      { $sort: { createdAt: -1, _id: -1 } },

      // Join user
      { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "u" } },
      { $unwind: { path: "$u", preserveNullAndEmptyArrays: true } },

      // Full name للبحث
      {
        $addFields: {
          clientFull: {
            $trim: {
              input: { $concat: [{ $ifNull: ["$u.prenom", ""] }, " ", { $ifNull: ["$u.nom", ""] }] }
            }
          }
        }
      },

      // فلترة اختيارية
      ...(regex ? [{ $match: { $or: [{ numero: regex }, { clientFull: regex }] } }] : []),

      {
        $facet: {
          data: [
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize },

            // 🔎 batch-lookup للـ devis (بدّل from: "devis" إذا اسم الكولكشن مختلف)
            {
              $lookup: {
                from: "devis",
                let: { demandeId: "$_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ["$demande", "$$demandeId"] }, // بدّل حسب الربط عندك إذا بالـ numero
                          { $eq: ["$kind", "compression"] }
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

            // hasDemandePdf + حجم الملفات محسوب (بدون إرجاع الـ binary)
            { $addFields: { hasDemandePdf: { $ne: ["$demandePdf", null] } } },

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

      {
        $project: {
          items: "$data",
          total: { $ifNull: [{ $arrayElemAt: ["$total.count", 0] }, 0] }
        }
      }
    ];

    const [resAgg = { items: [], total: 0 }] = await DevisCompression.aggregate(pipeline).allowDiskUse(true);
    res.json({ success: true, ...resAgg });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message || "Erreur serveur" });
  }
});

/**
 * GET /api/devis/compression/:id/pdf
 * - فتح/تنزيل الـ PDF المخزّن في demandePdf
 */
// routes/devisCompression.routes.js (جزء القراءة فقط)

function toBuffer(maybe) {
  if (!maybe) return null;
  if (Buffer.isBuffer(maybe)) return maybe;
  // حالة lean(): { type: 'Buffer', data: [...] }
  if (maybe?.type === "Buffer" && Array.isArray(maybe?.data)) return Buffer.from(maybe.data);
  if (maybe?.buffer && Buffer.isBuffer(maybe.buffer)) return Buffer.from(maybe.buffer);
  try { return Buffer.from(maybe); } catch { return null; }
}

// GET /api/devis/compression/:id/pdf
router.get("/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const row = await DevisCompression.findById(req.params.id)
      .select("demandePdf numero")
      .lean();

    const buf = toBuffer(row?.demandePdf?.data);
    if (!buf || !buf.length) {
      return res.status(404).json({ success: false, message: "PDF introuvable" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Content-Disposition", `inline; filename="devis-compression-${row?.numero || row?._id}.pdf"`);
    res.end(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Erreur lecture PDF" });
  }
});

// GET /api/devis/compression/:id/document/:index
router.get("/:id/document/:index", auth, only("admin"), async (req, res) => {
  try {
    const idx = Number(req.params.index);
    const row = await DevisCompression.findById(req.params.id)
      .select("documents numero")
      .lean();

    const doc = Array.isArray(row?.documents) ? row.documents[idx] : null;
    const buf = toBuffer(doc?.data);
    if (!buf || !buf.length) {
      return res.status(404).json({ success: false, message: "Document introuvable" });
    }

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

/**
 * POST /api/devis/compression
 * - إنشاء demande (client)
 */
router.post("/", auth, only("client"), upload.array("docs"), createDevisCompression);

export default router;
