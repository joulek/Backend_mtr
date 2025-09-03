// controllers/article.controller.js
import mongoose from "mongoose";
import Article from "../models/Article.js";
import Counter from "../models/Counter.js";

const VAT_RATE = 0.20;

// Utilitaire: prochain numéro ART-<seq>
async function getNextRef() {
  const counter = await Counter.findOneAndUpdate(
    { _id: "article" },
    { $inc: { seq: 1 }, $setOnInsert: { key: "article" } },
    { new: true, upsert: true }
  );
  return `ART-${counter.seq}`;
}

// GET /articles
export const getArticles = async (_req, res) => {
  try {
    const articles = await Article.find({})
      .collation({ locale: "en", numericOrdering: true }) // ← IMPORTANT
      .sort({ reference: 1 })
      .populate({ path: "type", select: "name_fr name_en" })
      .lean();

    const data = articles.map(a => ({
      ...a,
      prixTTC: a.prixHT != null ? Number((a.prixHT * 1.20).toFixed(4)) : null,
      typeName: a.type?.name_fr || "",
      isArchived: !!a.archived,
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error("getArticles error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};


// GET /articles/:id
export const getArticleById = async (req, res) => {
  try {
    const article = await Article.findById(req.params.id)
      .populate({ path: "type", select: "name_fr name_en" })
      .lean();
    if (!article) {
      return res.status(404).json({ success: false, message: "Article introuvable" });
    }

    article.prixTTC = Number((article.prixHT * (1 + VAT_RATE)).toFixed(4));
    article.typeName = article.type?.name_fr || "";

    res.json({ success: true, data: article });
  } catch (err) {
    console.error("getArticleById error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};

// GET /articles/by-demande?numero=DDV2500148  (si tu en as besoin)
export const getArticleByDemande = async (req, res) => {
  try {
    const numeroRaw = (req.query.numero || "").toString().trim();
    const numero = numeroRaw.toUpperCase();
    if (!numero) {
      return res.status(400).json({ success: false, message: "Numéro manquant" });
    }

    const article = await Article.findOne({ numeroDevis: numero })
      .sort({ updatedAt: -1 })
      .populate({ path: "type", select: "name_fr name_en" })
      .lean();

    if (!article) {
      return res.status(404).json({
        success: false,
        message: "Article introuvable pour ce numéro de devis",
      });
    }

    article.prixTTC = Number((article.prixHT * (1 + VAT_RATE)).toFixed(4));
    article.typeName = article.type?.name_fr || "";

    res.json({ success: true, item: article });
  } catch (e) {
    console.error("getArticleByDemande error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};

// POST /articles
export const createArticle = async (req, res) => {
  try {
    const { designation, prixHT, type, numeroDevis } = req.body;
    if (!type) return res.status(400).json({ success: false, message: "Type requis" });
    if (prixHT === undefined || Number(prixHT) < 0)
      return res.status(400).json({ success: false, message: "prixHT invalide" });

    // Générer reference auto
    const reference = await getNextRef();

    // Auto-remplir la désignation si absente avec le nom du Product
    let finalDesignation = (designation || "").trim();
    if (!finalDesignation) {
      const Product = mongoose.model("Product");
      const product = await Product.findById(type).lean();
      if (product?.name_fr) finalDesignation = product.name_fr;
    }
    if (!finalDesignation) {
      return res.status(400).json({ success: false, message: "Désignation requise" });
    }

    const article = await Article.create({
      reference,
      designation: finalDesignation,
      prixHT: Number(prixHT),
      type,
      numeroDevis: (numeroDevis || "").trim()
    });

    res.status(201).json({ success: true, data: article });
  } catch (err) {
    console.error("createArticle error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};


// PATCH /articles/:id  (modifier sans jamais toucher à "reference")
export const updateArticle = async (req, res) => {
  try {
    if ("reference" in req.body) delete req.body.reference;

    const current = await Article.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ success: false, message: "Article introuvable" });
    if (current.archived) {
      return res.status(400).json({ success: false, message: "Article archivé : modification non autorisée" });
    }

    const { designation, prixHT, type, numeroDevis } = req.body;
    const payload = {};
    if (designation !== undefined) payload.designation = String(designation || "").trim();
    if (prixHT !== undefined) {
      const n = Number(prixHT);
      if (Number.isNaN(n) || n < 0) return res.status(400).json({ success: false, message: "prixHT invalide" });
      payload.prixHT = n;
    }
    if (type !== undefined) payload.type = type;
    if (numeroDevis !== undefined) payload.numeroDevis = String(numeroDevis || "").trim();

    const updated = await Article.findByIdAndUpdate(
      req.params.id,
      { $set: payload },
      { new: true, runValidators: true }
    ).populate({ path: "type", select: "name_fr name_en" }).lean();

    updated.prixTTC = Number((updated.prixHT * (1 + VAT_RATE)).toFixed(4));
    updated.typeName = updated.type?.name_fr || "";

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("updateArticle error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};


// DELETE /articles/:id (supprime l'article — on NE TOUCHE PAS au compteur)
export const deleteArticle = async (req, res) => {
  try {
    const doc = await Article.findByIdAndUpdate(
      req.params.id,
      { $set: { archived: true, designation: "", prixHT: null, type: null, numeroDevis: "" } },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Article introuvable" });

    // On NE touche PAS au compteur : la référence reste “réservée”.
    res.json({
      success: true,
      message: "Article archivé. La référence est conservée et visible dans la liste.",
      data: { _id: doc._id, reference: doc.reference }
    });
  } catch (err) {
    console.error("deleteArticle error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};
