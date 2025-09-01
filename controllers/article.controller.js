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
      .populate({ path: "type", select: "name_fr name_en" })
      .sort({ reference: 1 })
      .lean();

    const data = articles.map(a => ({
      ...a,
      prixTTC: Number((a.prixHT * (1 + VAT_RATE)).toFixed(4)),
      typeName: a.type?.name_fr || ""  // pratique côté front
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

// PUT /articles/:id
export const updateArticle = async (req, res) => {
  try {
    const { designation, prixHT, type, numeroDevis } = req.body;

    const update = {};
    if (designation !== undefined) update.designation = (designation || "").trim();
    if (prixHT !== undefined) update.prixHT = Number(prixHT);
    if (type !== undefined) update.type = type;
    if (numeroDevis !== undefined) update.numeroDevis = (numeroDevis || "").trim();

    // Empêcher la modification de reference ici (on la garde immuable)
    // si tu veux l'autoriser, ajoute: if (reference) update.reference = reference;

    const article = await Article.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true }
    ).populate({ path: "type", select: "name_fr name_en" });

    if (!article) {
      return res.status(404).json({ success: false, message: "Article introuvable" });
    }

    res.json({ success: true, data: article });
  } catch (err) {
    console.error("updateArticle error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};

// DELETE /articles/:id
export const deleteArticle = async (req, res) => {
  try {
    const article = await Article.findByIdAndDelete(req.params.id);
    if (!article) {
      return res.status(404).json({ success: false, message: "Article introuvable" });
    }
    res.json({ success: true, message: "Article supprimé avec succès" });
  } catch (err) {
    console.error("deleteArticle error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};
