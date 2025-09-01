// controllers/products.controller.js
import fs from "fs";
import path from "path";
import Product from "../models/Product.js";

// Si tu as centralisé ces constantes dans un fichier upload.js, importe-les.
// Sinon adapte le chemin ici :
const UPLOAD_PUBLIC_URL = "/uploads";
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

/** Util : fabrique une URL publique absolue à partir d'un filename multer */
function toPublicUrl(req, filename) {
  const host = `${req.protocol}://${req.get("host")}`;
  return `${host}${UPLOAD_PUBLIC_URL}/${filename}`;
}

/** Util : supprime un fichier si présent (best effort) */
function safeUnlinkByPublicUrl(publicUrl) {
  try {
    // publicUrl = http://host/uploads/xxx.png  -> on ne garde que la partie "uploads/xxx.png"
    const idx = publicUrl.indexOf(UPLOAD_PUBLIC_URL + "/");
    if (idx === -1) return;
    const rel = publicUrl.slice(idx + UPLOAD_PUBLIC_URL.length + 1); // xxx.png
    const abs = path.join(UPLOAD_DIR, rel);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {}
}

/** CREATE PRODUCT */
export const createProduct = async (req, res) => {
  try {
    const { name_fr, name_en, description_fr, description_en, category } = req.body;

    // fichiers uploadés par multer
    const images = (req.files || []).map((f) => toPublicUrl(req, f.filename));

    const product = await Product.create({
      name_fr,
      name_en,
      description_fr,
      description_en,
      category,            // ObjectId attendu
      images,              // URLs publiques absolues
    });

    const populated = await product.populate("category");
    res.status(201).json(populated);
  } catch (err) {
    console.error("createProduct ERROR:", err);
    res.status(500).json({ message: "Error creating product", error: err.message });
  }
};

/** GET ALL PRODUCTS (avec populate + tri desc) */
export const getProducts = async (req, res) => {
  try {
    const products = await Product.find()
      .populate("category")
      .sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    console.error("getProducts ERROR:", err);
    res.status(500).json({ message: "Error fetching products", error: err.message });
  }
};

/** GET PRODUCT BY ID */
export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id).populate("category");
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (err) {
    console.error("getProductById ERROR:", err);
    res.status(500).json({ message: "Error fetching product", error: err.message });
  }
};

/**
 * UPDATE PRODUCT
 * Scénarios supportés :
 *  - Mise à jour de champs texte/category.
 *  - Ajout d’images (append) via multipart (req.files).
 *  - Remplacement complet des images via body JSON { replaceImages: true } + nouveaux fichiers.
 *  - Suppression ciblée via body (JSON ou multipart) { removeImages: [url1, url2] }.
 */
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // Récup des champs (multipart ou JSON)
    const {
      name_fr,
      name_en,
      description_fr,
      description_en,
      category,
      replaceImages,         // "true"/true -> remplace complètement
    } = req.body;

    // removeImages peut arriver en JSON (array) ou en multipart (string|array)
    let { removeImages } = req.body;
    if (typeof removeImages === "string") {
      try { removeImages = JSON.parse(removeImages); } catch { removeImages = [removeImages]; }
    }
    if (!Array.isArray(removeImages)) removeImages = [];

    // fichiers ajoutés par multer
    const uploaded = (req.files || []).map((f) => toPublicUrl(req, f.filename));

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    // Mise à jour champs simples
    if (name_fr !== undefined) product.name_fr = name_fr;
    if (name_en !== undefined) product.name_en = name_en;
    if (description_fr !== undefined) product.description_fr = description_fr;
    if (description_en !== undefined) product.description_en = description_en;
    if (category) product.category = category;

    // Gestion des images :
    if (replaceImages === true || replaceImages === "true") {
      // Supprimer toutes les anciennes images du disque
      for (const url of product.images) safeUnlinkByPublicUrl(url);
      // Puis on ne garde que les nouvelles uploadées
      product.images = uploaded;
    } else {
      // Suppression ciblée demandée
      if (removeImages.length) {
        const toKeep = [];
        for (const url of product.images) {
          if (removeImages.includes(url)) {
            safeUnlinkByPublicUrl(url);
          } else {
            toKeep.push(url);
          }
        }
        product.images = toKeep;
      }
      // Ajout des nouvelles
      if (uploaded.length) product.images.push(...uploaded);
    }

    await product.save();
    const populated = await product.populate("category");
    res.json(populated);
  } catch (err) {
    console.error("updateProduct ERROR:", err);
    res.status(500).json({ message: "Error updating product", error: err.message });
  }
};

/** DELETE PRODUCT (+ suppression fichiers) */
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findByIdAndDelete(id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    // on supprime les fichiers physiques
    for (const url of product.images || []) safeUnlinkByPublicUrl(url);

    res.json({ success: true, message: "Product deleted" });
  } catch (err) {
    console.error("deleteProduct ERROR:", err);
    res.status(500).json({ message: "Error deleting product", error: err.message });
  }
};

// ➕ GET /api/products/by-category/:categoryId
export const getProductsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const prods = await Product.find({ category: categoryId })
      .populate("category")
      .sort({ createdAt: -1 });
    res.json(prods);
  } catch (err) {
    console.error("getProductsByCategory ERROR:", err);
    res.status(500).json({ message: "Error fetching products by category", error: err.message });
  }
};
