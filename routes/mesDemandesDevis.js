// routes/mesDevis.js
import express from "express";
import mongoose from "mongoose";
// adapte ce chemin selon ton projet: "../middleware/auth.js" ou "../middlewares/auth.js"
import auth from "../middlewares/auth.js";

import DevisGrille from "../models/DevisGrille.js";
import DevisFilDresse from "../models/DevisFilDresse.js";
import DevisCompression from "../models/DevisCompression.js";
import DevisTraction from "../models/DevisTraction.js";
import DevisTorsion from "../models/DevisTorsion.js";
import DevisAutre from "../models/DevisAutre.js";
import Devis from "../models/Devis.js";

const router = express.Router();

/* -----------------------------------------------------------
 * Types de devis disponibles
 * --------------------------------------------------------- */
const TYPES = {
  grille:      { label: "Grille métallique",        Model: DevisGrille },
  fildresse:   { label: "Fil Dressé/coupé",         Model: DevisFilDresse },
  compression: { label: "Ressort de Compression",   Model: DevisCompression },
  traction:    { label: "Ressort de Traction",      Model: DevisTraction },
  torsion:     { label: "Ressort de Torsion",       Model: DevisTorsion },
  autre:       { label: "Autre types",              Model: DevisAutre },
};

const REF_FIELDS = [
  "ref","reference","numero","num","code","quoteRef","quoteNo","requestNumber",
];

const TEXT_FIELDS = [
  "subject","message","comments","description","notes",
  ...REF_FIELDS,
];

const modelFromSlug = (slug) => TYPES[slug]?.Model || null;

/* -----------------------------------------------------------
 * GET /api/mes-devis
 * -> liste paginée des devis du client connecté
 *    (préférence URL Cloudinary si disponible)
 * --------------------------------------------------------- */
router.get("/mes-devis", auth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "10", 10)));
    const q = (req.query.q || "").trim();

    const oid = mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : null;
    const who = oid || userId;
    const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

    // pipeline commun pour chaque modèle
    const perModelPipe = (slug) => ([
      // owner coalesce
      {
        $addFields: {
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

      ...(rx ? [{
        $match: {
          $or: TEXT_FIELDS.map((f) => ({ [f]: { $regex: rx, $options: "i" } }))
        }
      }] : []),

      // garder méta + URL Cloudinary si présente
      {
        $project: {
          createdAt: 1,
          updatedAt: 1,
          // demandePdf.* pour décider: url (cloudinary) OU buffer/contentType
          "demandePdf.url": 1,
          "demandePdf.contentType": 1,
          // documents avec url si présente
          documents: {
            $map: {
              input: { $ifNull: ["$documents", []] },
              as: "d",
              in: {
                _id: "$$d._id",
                filename: "$$d.filename",
                mimetype: "$$d.mimetype",
                url: "$$d.url"
              }
            }
          },
          // ref unifiée
          __ref: {
            $ifNull: [
              "$ref","$reference","$numero","$num","$code","$quoteRef","$quoteNo","$requestNumber", null
            ]
          }
        }
      },

      // flags internes
      {
        $addFields: {
          _type: slug,
          _hasPdf: {
            $or: [
              { $toBool: "$demandePdf.url" },
              { $toBool: "$demandePdf.contentType" }
            ]
          }
        }
      }
    ]);

    const baseSlug = "grille";
    const unionSlugs = Object.keys(TYPES).filter((s) => s !== baseSlug);

    const pipeline = [
      ...perModelPipe(baseSlug),
      ...unionSlugs.flatMap((slug) => ([
        {
          $unionWith: {
            coll: mongoose.model(TYPES[slug].Model.modelName).collection.name,
            pipeline: perModelPipe(slug),
          }
        }
      ])),
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          total: [{ $count: "n" }],
          items: [
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize }
          ]
        }
      },
      {
        $project: {
          items: 1,
          total: { $ifNull: [{ $arrayElemAt: ["$total.n", 0] }, 0] }
        }
      }
    ];

    const baseModel = TYPES[baseSlug].Model;
    const aggResult = await baseModel.aggregate(pipeline).allowDiskUse(true);
    const { items = [], total = 0 } = aggResult[0] || {};

    const ORIGIN = `${req.protocol}://${req.get("host")}`;

    const cooked = items.map((it) => {
      const slug = it._type;
      const label = TYPES[slug]?.label || slug;
      const base = `${ORIGIN}/api/mes-devis/${slug}/${it._id}`;

      // préférer URL Cloudinary si dispo
      const pdfUrl = it?.demandePdf?.url
        ? it.demandePdf.url
        : (it._hasPdf ? `${base}/pdf` : null);

      const files = Array.isArray(it.documents)
        ? it.documents.map((d) => ({
            _id: String(d._id),
            name: d.filename || `document-${d._id}`,
            url: d.url || `${base}/doc/${d._id}`, // cloudinary si présent sinon fallback backend
          }))
        : [];

      return {
        _id: String(it._id),
        type: slug,
        typeLabel: label,
        ref: it.__ref || null,
        hasPdf: !!it._hasPdf,
        pdfUrl,
        files,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
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
 * -> redirige 302 vers Cloudinary si url, sinon stream buffer
 * --------------------------------------------------------- */
router.get("/mes-devis/:type/:id/pdf", auth, async (req, res) => {
  const { type, id } = req.params;
  try {
    const Model = modelFromSlug(type);
    if (!Model) return res.status(404).json({ message: "Type inconnu" });

    const row = await Model.findById(id).select("demandePdf").lean();
    if (!row) return res.status(404).json({ message: "PDF introuvable" });

    if (row?.demandePdf?.url) {
      return res.redirect(302, row.demandePdf.url);
    }

    const data = row?.demandePdf?.data;
    const ct = row?.demandePdf?.contentType || "application/pdf";
    if (!data || (!Buffer.isBuffer(data) && !data.buffer)) {
      return res.status(404).json({ message: "PDF introuvable" });
    }

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer);
    const safeName = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
    res.setHeader("Content-Type", ct);
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Content-Disposition", `attachment; filename="devis-${safeName}.pdf"`);
    res.end(buf);
  } catch (err) {
    console.error("GET /api/mes-devis/:type/:id/pdf error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* -----------------------------------------------------------
 * GET /api/mes-devis/:type/:id/doc/:docId
 * -> redirige 302 vers Cloudinary si url, sinon stream buffer
 * --------------------------------------------------------- */
router.get("/mes-devis/:type/:id/doc/:docId", auth, async (req, res) => {
  const { type, id, docId } = req.params;
  try {
    const Model = modelFromSlug(type);
    if (!Model) return res.status(404).json({ message: "Type inconnu" });

    const row = await Model.findById(id).select("documents").lean();
    if (!row || !Array.isArray(row.documents)) {
      return res.status(404).json({ message: "Document introuvable" });
    }

    const doc = row.documents.find((d) => String(d._id) === String(docId));
    if (!doc) return res.status(404).json({ message: "Document inexistant" });

    if (doc?.url) {
      return res.redirect(302, doc.url);
    }

    const data = doc.data;
    if (!data) return res.status(404).json({ message: "Document vide" });

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer);
    const safeName = String(doc.filename || `document-${docId}`).replace(/["]/g, "");
    res.setHeader("Content-Type", doc.mimetype || "application/octet-stream");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.end(buf);
  } catch (err) {
    console.error("GET /api/mes-devis/:type/:id/doc/:docId error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* -----------------------------------------------------------
 * GET /api/devis/client/by-demande/:demandeId
 * -> renvoie le devis commercial lié (numero, pdf url/public_id)
 * --------------------------------------------------------- */
router.get("/devis/client/by-demande/:demandeId", auth, async (req, res) => {
  try {
    const { demandeId } = req.params;

    const filter = {
      demande: mongoose.isValidObjectId(demandeId)
        ? new mongoose.Types.ObjectId(demandeId)
        : demandeId,
    };

    // si ton schéma utilise "client" (souvent pour les devis commerciaux)
    // sinon remplace par { user: req.user.id }
    filter.client = req.user.id;

    const dv = await Devis.findOne(filter)
      .select("numero devisPdfUrl pdf kind")
      .lean();

    if (!dv) return res.status(404).json({ success: true, exists: false });

    const pdfUrl = dv.devisPdfUrl || dv?.pdf?.url || null;
    const publicId = dv?.pdf?.public_id || null;

    return res.json({
      success: true,
      exists: true,
      devis: { numero: dv.numero || null, kind: dv.kind || null },
      pdf: pdfUrl,
      public_id: publicId,
    });
  } catch (e) {
    console.error("GET /api/devis/client/by-demande error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

export default router;
