// routes/devisAutre.routes.js
import { Router } from "express";
import multer from "multer";
import auth, { only } from "../middlewares/auth.js";
import DevisAutre from "../models/DevisAutre.js";
import { createDevisAutre } from "../controllers/devisAutre.controller.js";

const router = Router();

// ✅ limits + فلترة أنواع الملفات الشائعة فقط
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 4 }, // 10MB, max 4
  fileFilter: (_req, file, cb) => {
    const ok = [
      "application/pdf",
      "image/png", "image/jpeg", "image/webp",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/zip", "application/x-zip-compressed"
    ].includes(file.mimetype);
    cb(ok ? null : new Error("Type de fichier non autorisé"), ok);
  }
});

function toBuffer(maybe) {
  if (!maybe) return null;
  if (Buffer.isBuffer(maybe)) return maybe;
  if (maybe?.type === "Buffer" && Array.isArray(maybe?.data)) return Buffer.from(maybe.data);
  if (maybe?.buffer && Buffer.isBuffer(maybe.buffer)) return Buffer.from(maybe.buffer);
  try { return Buffer.from(maybe); } catch { return null; }
}

// 🔎 GET /paginated
router.get("/paginated", auth, only("admin"), async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize || "10", 10) || 10));
    const q = String(req.query.q || "").trim();
    const regex = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

    const pipeline = [
      { $sort: { createdAt: -1, _id: -1 } },
      { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "u" } },
      { $unwind: { path: "$u", preserveNullAndEmptyArrays: true } },
      { $addFields: { clientFull: { $trim: { input: { $concat: [{ $ifNull: ["$u.prenom",""] }, " ", { $ifNull: ["$u.nom",""] }] } } } } },
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
                  { $match: { $expr: { $and: [ { $eq: ["$demande","$$demandeId"] }, { $eq: ["$kind","autre"] } ] } } },
                  { $project: { _id: 0, numero: 1, pdf: 1 } }
                ],
                as: "devis"
              }
            },
            { $addFields: { devis: { $arrayElemAt: ["$devis", 0] } } },
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

    const [out = { items: [], total: 0 }] = await DevisAutre.aggregate(pipeline).allowDiskUse(true);
    res.json({ success: true, ...out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message || "Erreur serveur" });
  }
});

// 📄 PDF
router.get("/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const row = await DevisAutre.findById(req.params.id).select("demandePdf numero").lean();
    if (!row) return res.status(404).json({ success: false, message: "Demande introuvable" });

    const buf = toBuffer(row?.demandePdf?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "PDF introuvable" });

    res.setHeader("Content-Type", row?.demandePdf?.contentType || "application/pdf");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    // ✅ ملف باسم مرتب
    const safeNum = (row?.numero || row?._id || "").toString().replace(/[^a-zA-Z0-9_-]/g, "");
    res.setHeader("Content-Disposition", `inline; filename="devis-autre-${safeNum}.pdf"`);
    res.end(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Erreur lecture PDF" });
  }
});

// 📎 Document by index
router.get("/:id/document/:index", auth, only("admin"), async (req, res) => {
  try {
    const idx = Number(req.params.index);
    if (!Number.isInteger(idx) || idx < 0) {
      return res.status(400).json({ success: false, message: "Index invalide" });
    }

    const row = await DevisAutre.findById(req.params.id).select("documents numero").lean();
    if (!row || !Array.isArray(row.documents)) {
      return res.status(404).json({ success: false, message: "Demande introuvable" });
    }

    const doc = row.documents[idx];
    if (!doc) return res.status(404).json({ success: false, message: "Document inexistant" });

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

// 📨 création
router.post("/", auth, only("client"), upload.array("docs"), createDevisAutre);

export default router;
