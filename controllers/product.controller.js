// controllers/products.controller.js
import Product from "../models/Product.js";
import { v2 as cloudinary } from "cloudinary";

/* ------------------------------------------------------------------ */
/* Helpers Cloudinary                                                  */
/* ------------------------------------------------------------------ */

/**
 * À partir d'une URL Cloudinary, essaie d'extraire public_id et resource_type.
 * On suppose une url de type:
 *  https://res.cloudinary.com/<cloud>/image/upload/v1699999999/folder/sub/filename.ext
 *  https://res.cloudinary.com/<cloud>/raw/upload/v1699999999/devis/DEVIS-1234.pdf
 *
 * Retourne { public_id, resource_type } ou null si non Cloudinary.
 */
function extractCloudinaryInfo(url) {
  if (typeof url !== "string") return null;
  // Doit contenir /upload/
  const upIdx = url.indexOf("/upload/");
  if (upIdx === -1) return null;

  // Déterminer resource_type à partir du segment avant /upload/
  // .../<resource_type>/upload/...
  // si absent, fallback "image"
  const before = url.slice(0, upIdx);
  const segs = before.split("/").filter(Boolean);
  const resource_type = segs[segs.length - 1] || "image";

  // partie après /upload/
  const after = url.slice(upIdx + "/upload/".length); // ex: v169.../folder/x/y.ext
  const parts = after.split("/").filter(Boolean);

  // Retirer un éventuel segment de version type v123456789
  if (parts[0] && /^v\d+$/.test(parts[0])) parts.shift();

  if (!parts.length) return null;

  // Dernier segment = "filename.ext" -> enlever extension
  const last = parts.pop(); // filename.ext
  const dot = last.lastIndexOf(".");
  const base = dot !== -1 ? last.slice(0, dot) : last;

  // public_id = le reste joiné + base
  const public_id = parts.length ? `${parts.join("/")}/${base}` : base;

  return { public_id, resource_type };
}

/** Détruire un asset Cloudinary à partir de son URL (best-effort). */
async function destroyFromUrl(url) {
  const info = extractCloudinaryInfo(url);
  if (!info) return;
  try {
    await cloudinary.uploader.destroy(info.public_id, { resource_type: info.resource_type });
  } catch (e) {
    // on n'échoue pas la requête pour autant
    console.warn("Cloudinary destroy failed for", url, e?.message);
  }
}

/* ------------------------------------------------------------------ */
/* CREATE PRODUCT                                                      */
/* ------------------------------------------------------------------ */

export const createProduct = async (req, res) => {
  try {
    const { name_fr, name_en, description_fr, description_en, category } = req.body;

    // Images venant de Cloudinary via ton middlewares (req.cloudinaryFiles)
    // On ne stocke que les URLs pour rester 100% compatible avec ton schéma actuel (Array<String>)
    const images = (req.cloudinaryFiles || []).map((f) => f.url);

    const product = await Product.create({
      name_fr,
      name_en,
      description_fr,
      description_en,
      category,  // ObjectId attendu
      images,    // Array<String> d'URLs Cloudinary
    });

    const populated = await product.populate("category");
    res.status(201).json(populated);
  } catch (err) {
    console.error("createProduct ERROR:", err);
    res.status(500).json({ message: "Error creating product", error: err.message });
  }
};

/* ------------------------------------------------------------------ */
/* GET ALL PRODUCTS                                                    */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* GET PRODUCT BY ID                                                   */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* UPDATE PRODUCT                                                      */
/* ------------------------------------------------------------------ */
/**
 * Scénarios supportés :
 *  - Mise à jour de champs texte/category.
 *  - Ajout d’images (append) via multipart (req.cloudinaryFiles).
 *  - Remplacement complet des images via { replaceImages: true } + nouveaux fichiers.
 *  - Suppression ciblée via { removeImages: [url1, url2] } (et détruit sur Cloudinary).
 */
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name_fr,
      name_en,
      description_fr,
      description_en,
      category,
      replaceImages, // "true"/true -> remplace complètement
    } = req.body;

    // removeImages peut venir en JSON (array) ou en multipart (string|array)
    let { removeImages } = req.body;
    if (typeof removeImages === "string") {
      try { removeImages = JSON.parse(removeImages); }
      catch { removeImages = [removeImages]; }
    }
    if (!Array.isArray(removeImages)) removeImages = [];

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    // Mise à jour champs simples
    if (name_fr !== undefined) product.name_fr = name_fr;
    if (name_en !== undefined) product.name_en = name_en;
    if (description_fr !== undefined) product.description_fr = description_fr;
    if (description_en !== undefined) product.description_en = description_en;
    if (category) product.category = category;

    // Nouvelles images uploadées pendant cette requête
    const uploadedUrls = (req.cloudinaryFiles || []).map((f) => f.url);

    if (replaceImages === true || replaceImages === "true") {
      // 1) Détruire toutes les anciennes images Cloudinary
      await Promise.all((product.images || []).map((url) => destroyFromUrl(url)));
      // 2) Remplacer par les nouvelles
      product.images = uploadedUrls;
    } else {
      // Suppression ciblée demandée : on détruit aussi côté Cloudinary
      if (removeImages.length) {
        // Détruire côté Cloudinary (best-effort)
        await Promise.all(removeImages.map((url) => destroyFromUrl(url)));
        // Puis retirer du tableau
        const setToRemove = new Set(removeImages);
        product.images = (product.images || []).filter((url) => !setToRemove.has(url));
      }
      // Ajout des nouvelles (append)
      if (uploadedUrls.length) product.images.push(...uploadedUrls);
    }

    await product.save();
    const populated = await product.populate("category");
    res.json(populated);
  } catch (err) {
    console.error("updateProduct ERROR:", err);
    res.status(500).json({ message: "Error updating product", error: err.message });
  }
};

/* ------------------------------------------------------------------ */
/* DELETE PRODUCT                                                      */
/* ------------------------------------------------------------------ */

export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findByIdAndDelete(id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    // supprimer les assets Cloudinary liés (best-effort)
    await Promise.all((product.images || []).map((url) => destroyFromUrl(url)));

    res.json({ success: true, message: "Product deleted" });
  } catch (err) {
    console.error("deleteProduct ERROR:", err);
    res.status(500).json({ message: "Error deleting product", error: err.message });
  }
};

/* ------------------------------------------------------------------ */
/* GET /api/products/by-category/:categoryId                          */
/* ------------------------------------------------------------------ */

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
