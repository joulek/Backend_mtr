// routes/mesDevis.js
import express from "express";
import mongoose from "mongoose";
import auth from "../middleware/auth.js";

import DevisGrille from "../models/DevisGrille.js";
import DevisFilDresse from "../models/DevisFilDresse.js";
import DevisCompression from "../models/DevisCompression.js";
import DevisTraction from "../models/DevisTraction.js";
import DevisTorsion from "../models/DevisTorsion.js";
import DevisAutre from "../models/DevisAutre.js";

const router = express.Router();

/* -----------------------------------------------------------
 * Types de devis disponibles
 * --------------------------------------------------------- */
const TYPES = {
  grille:      { label: "Grille métallique",      Model: DevisGrille },
  fildresse:   { label: "Fil Dressé/coupé",  Model: DevisFilDresse },
  compression: { label: "Ressort de Compression", Model: DevisCompression },
  traction:    { label: "Ressort de Traction",    Model: DevisTraction },
  torsion:     { label: "Ressort de Torsion",     Model: DevisTorsion },
  autre:       { label: "Autre types",       Model: DevisAutre },
};

const REF_FIELDS = [
  "ref", "reference", "numero", "num", "code", "quoteRef", "quoteNo", "requestNumber",
];

const TEXT_FIELDS = [
  "subject", "message", "comments", "description", "notes",
  ...REF_FIELDS,
];

const modelFromSlug = (slug) => TYPES[slug]?.Model || null;

const pickRef = (doc) => {
  for (const k of REF_FIELDS) if (doc?.[k]) return doc[k];
  return null;
};

function normalizeItem(req, doc, slug, label) {
  // On sait que le PDF existe si le buffer est présent OU si on a au moins le contentType
  const hasPdf = !!(doc?.demandePdf?.data?.length || doc?.demandePdf?.contentType);

  // URLs stables d'accès aux ressources
  const base = `${req.protocol}://${req.get("host")}/api/mes-devis/${slug}/${doc._id}`;
  const pdfUrl = hasPdf ? `${base}/pdf` : null;

  // Convertit les pièces jointes -> urls par _id (sans envoyer les buffers)
  const files = Array.isArray(doc.documents)
    ? doc.documents.map((d) => ({
        _id: String(d._id),
        name: d.filename || `document-${d._id}`,
        url: `${base}/doc/${d._id}`,
      }))
    : [];

  return {
    _id: String(doc._id),
    type: slug,
    typeLabel: label,
    ref: pickRef(doc),
    hasPdf,
    pdfUrl,
    files,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/* -----------------------------------------------------------
 * GET /api/mes-devis
 * -> liste paginée des devis du client connecté
 * --------------------------------------------------------- */
// routes/mesDevis.js  — استبدل بلوك GET /api/mes-devis بهذا

router.get("/mes-devis", auth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "10", 10)));
    const q = (req.query.q || "").trim();

    const oid = mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : null;
    const who = oid || userId;

    // حقول المرجع المحتملة (نستعمل coalesce داخل الـ$project)
    const REF_FIELDS = [
      "ref","reference","numero","num","code","quoteRef","quoteNo","requestNumber",
    ];

    // حقول البحث النصي المحتملة
    const TEXT_FIELDS = [
      "subject","message","comments","description","notes",
      ...REF_FIELDS
    ];

    // regex للبحث (اختياري)
    const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

    // نبني pipeline قياسي لموديل واحد (يُعاد استعماله في unionWith)
    const perModelPipe = (slug) => ([
      // اجمع owner: coalesce (user, userId, client, createdBy, owner)
      { $addFields: {
          __owner: {
            $ifNull: [
              "$user",
              { $ifNull: ["$userId",
                { $ifNull: ["$client",
                  { $ifNull: ["$createdBy", "$owner"] }
                ]}
              ]}
            ]
          }
        }
      },
      { $match: { __owner: who } },

      // تصفية بحث نصي خفيف (على الحقول النصية إن توفّرت)
      ...(rx ? [{
        $match: {
          $or: TEXT_FIELDS.map(f => ({ [f]: { $regex: rx, $options: "i" } }))
        }
      }] : []),

      // hasPdf (يكفي contentType)، احتفظ فقط بالميتا
      { $project: {
          createdAt: 1, updatedAt: 1,
          documents: { _id: 1, filename: 1, mimetype: 1 }, // بدون data
          "demandePdf.contentType": 1,
          // مرجع مدموج (أول قيمة non-null)
          __ref: {
            $ifNull: [
              "$ref","$reference","$numero","$num","$code","$quoteRef","$quoteNo","$requestNumber", null
            ]
          }
        }
      },

      // طبّق شكل موحّد للعناصر
      { $addFields: {
          _type: slug,
          _hasPdf: { $toBool: "$demandePdf.contentType" }
        }
      }
    ]);

    // الكلكشن الأساسي + unionWith لبقية الأنواع
    // نختار أي موديل كـ"أساس". هنا: DevisGrille (ينجم يكون أي واحد).
    const baseSlug = "grille";
    const unionSlugs = Object.keys(TYPES).filter(s => s !== baseSlug);

    const pipeline = [
      ...perModelPipe(baseSlug),

      // unionWith لكل موديل
      ...unionSlugs.flatMap(slug => ([
        { $unionWith: {
            coll: mongoose.model(TYPES[slug].Model.modelName).collection.name,
            pipeline: perModelPipe(slug)
          }
        }
      ])),

      // sort عام
      { $sort: { createdAt: -1 } },

      // pagination + total
      { $facet: {
          total: [{ $count: "n" }],
          items: [
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize }
          ]
        }
      },
      { $project: {
          items: 1,
          total: { $ifNull: [{ $arrayElemAt: ["$total.n", 0] }, 0] }
        }
      }
    ];

    // شغّل التجميعة على أي موديل (لازم نفس الداتابيز)
    const baseModel = TYPES[baseSlug].Model;
    const aggResult = await baseModel.aggregate(pipeline).allowDiskUse(true);
    const { items = [], total = 0 } = aggResult[0] || {};

    // صيّغ العناصر للـAPI (إضافة روابط)
    const ORIGIN = `${req.protocol}://${req.get("host")}`;
    const cooked = items.map((it) => {
      const slug = it._type;
      const label = TYPES[slug]?.label || slug;
      const base = `${ORIGIN}/api/mes-devis/${slug}/${it._id}`;

      return {
        _id: String(it._id),
        type: slug,
        typeLabel: label,
        ref: it.__ref || null,
        hasPdf: !!it._hasPdf,
        pdfUrl: it._hasPdf ? `${base}/pdf` : null,
        files: Array.isArray(it.documents)
          ? it.documents.map(d => ({
              _id: String(d._id),
              name: d.filename || `document-${d._id}`,
              url: `${base}/doc/${d._id}`,
            }))
          : [],
        createdAt: it.createdAt,
        updatedAt: it.updatedAt
      };
    });

    res.json({ items: cooked, total, page, pageSize });
  } catch (err) {
    console.error("GET /api/mes-devis error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* -----------------------------------------------------------
 * GET /api/mes-devis/:type/:id/pdf
 * -> stream du PDF "demandePdf"
 * --------------------------------------------------------- */
router.get("/mes-devis/:type/:id/pdf", auth, async (req, res) => {
  const { type, id } = req.params;
  try {
    const Model = modelFromSlug(type);
    if (!Model) return res.status(404).json({ message: "Type inconnu" });

    const row = await Model.findById(id).select("demandePdf").lean();
    const data = row?.demandePdf?.data;
    const ct = row?.demandePdf?.contentType || "application/pdf";
    if (!data || (!Buffer.isBuffer(data) && !data.buffer)) {
      return res.status(404).json({ message: "PDF introuvable" });
    }

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer);
    res.setHeader("Content-Type", ct);
    res.setHeader("Content-Disposition", `inline; filename="devis-${id}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error("GET /api/mes-devis/:type/:id/pdf error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* -----------------------------------------------------------
 * GET /api/mes-devis/:type/:id/doc/:docId
 * -> stream d'une pièce jointe "documents"
 * --------------------------------------------------------- */
router.get("/mes-devis/:type/:id/doc/:docId", auth, async (req, res) => {
  const { type, id, docId } = req.params;
  try {
    const Model = modelFromSlug(type);
    if (!Model) return res.status(404).json({ message: "Type inconnu" });

    const row = await Model.findById(id).select("documents").lean();
    const doc = row?.documents?.find((d) => String(d._id) === String(docId));
    if (!doc) return res.status(404).json({ message: "Document introuvable" });

    const data = doc.data;
    if (!data) return res.status(404).json({ message: "Document vide" });

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer);
    res.setHeader("Content-Type", doc.mimetype || "application/octet-stream");
    const filename = doc.filename || `document-${docId}`;
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    console.error("GET /api/mes-devis/:type/:id/doc/:docId error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
