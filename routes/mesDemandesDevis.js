// routes/mesDevis.js
import express from "express";
import mongoose from "mongoose";
import auth from "../middlewares/auth.js";

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
  grille:      { label: "Grille métallique",        Model: DevisGrille },
  fildresse:   { label: "Fil dressé/coupé",         Model: DevisFilDresse },
  compression: { label: "Ressort de Compression",   Model: DevisCompression },
  traction:    { label: "Ressort de Traction",      Model: DevisTraction },
  torsion:     { label: "Ressort de Torsion",       Model: DevisTorsion },
  autre:       { label: "Autre article",            Model: DevisAutre },
};

const REF_FIELDS = [
  "ref","reference","numero","num","code","quoteRef","quoteNo","requestNumber",
];

const TEXT_FIELDS = [
  "subject","message","comments","description","notes",
  ...REF_FIELDS,
];

const modelFromSlug = (slug) => TYPES[slug]?.Model || null;

const pickRef = (doc) => {
  for (const k of REF_FIELDS) if (doc?.[k]) return doc[k];
  return null;
};

/* -----------------------------------------------------------
 * GET /api/mes-devis
 * -> liste paginée des devis du client connecté
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

    // pipeline par modèle, commun à toutes les collections
    const perModelPipe = (slug) => ([
      // coalesce owner
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

      // filtre texte optionnel
      ...(rx ? [{
        $match: {
          $or: TEXT_FIELDS.map((f) => ({ [f]: { $regex: rx, $options: "i" } }))
        }
      }] : []),

      // on garde la méta + les URLs Cloudinary si présentes
      {
        $project: {
          createdAt: 1,
          updatedAt: 1,
          // PDF (nouveau: on expose aussi l'URL Cloudinary)
          "demandePdf.contentType": 1,
          "demandePdf.url": 1,
          // documents: conserver _id/filename/mimetype + URL si dispo
          documents: {
            $map: {
              input: { $ifNull: ["$documents", []] },
              as: "d",
              in: {
                _id: "$$d._id",
                filename: "$$d.filename",
                mimetype: "$$d.mimetype",
                url: "$$d.url",
              }
            }
          },
          // référence "fusionnée"
          __ref: {
            $ifNull: [
              "$ref","$reference","$numero","$num","$code","$quoteRef","$quoteNo","$requestNumber", null
            ]
          }
        }
      },

      // marquage type + hasPdf = (url Cloudinary OU contentType)
      {
        $addFields: {
          _type: slug,
          _hasPdf: { $or: [ { $toBool: "$demandePdf.url" }, { $toBool: "$demandePdf.contentType" } ] }
        }
      }
    ]);

    // on choisit une collection de base et on unionWith les autres
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

    // mise en forme API (préférence Cloudinary, fallback routes /pdf + /doc)
    const ORIGIN = `${req.protocol}://${req.get("host")}`;
    const cooked = items.map((it) => {
      const slug = it._type;
      const label = TYPES[slug]?.label || slug;
      const base = `${ORIGIN}/api/mes-devis/${slug}/${it._id}`;

      const pdfUrl =
        it?.demandePdf?.url
          ? it.demandePdf.url           // ✅ Cloudinary en priorité
          : (it._hasPdf ? `${base}/pdf` : null); // fallback buffer

      const files = Array.isArray(it.documents)
        ? it.documents.map((d) => ({
            _id: String(d._id),
            name: d.filename || `document-${d._id}`,
            url: d.url || `${base}/doc/${d._id}`, // ✅ Cloudinary si présent sinon route fallback
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
 * -> ouvre le PDF : redirige vers Cloudinary si url, sinon stream le buffer
 * --------------------------------------------------------- */
router.get("/mes-devis/:type/:id/pdf", auth, async (req, res) => {
  const { type, id } = req.params;
  try {
    const Model = modelFromSlug(type);
    if (!Model) return res.status(404).json({ message: "Type inconnu" });

    const row = await Model.findById(id).select("demandePdf").lean();
    if (!row) return res.status(404).json({ message: "PDF introuvable" });

    // ✅ si URL Cloudinary dispo → redirection 302
    if (row?.demandePdf?.url) {
      return res.redirect(row.demandePdf.url);
    }

    // sinon fallback: buffer
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
 * -> ouvre une pièce jointe : redirige vers Cloudinary si url, sinon stream buffer
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

    // ✅ si URL Cloudinary → redirection 302
    if (doc?.url) {
      return res.redirect(doc.url);
    }

    // sinon fallback: buffer
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
router.get("/devis/client/by-demande/:demandeId", auth, async (req, res) => {
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

export default router;
