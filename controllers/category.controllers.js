// controllers/category.controller.js
import Category from "../models/category.js";
import { v2 as cloudinary } from "cloudinary";

/* ----------------------- Helpers Cloudinary ----------------------- */

// extraire public_id & resource_type depuis une URL Cloudinary
function extractCloudinaryInfo(url) {
  if (typeof url !== "string") return null;
  const upIdx = url.indexOf("/upload/");
  if (upIdx === -1) return null;

  // .../<resource_type>/upload/...
  const before = url.slice(0, upIdx);
  const segs = before.split("/").filter(Boolean);
  const resource_type = segs[segs.length - 1] || "image";

  let after = url.slice(upIdx + "/upload/".length); // v1234/.../file.ext
  const parts = after.split("/").filter(Boolean);
  if (parts[0] && /^v\d+$/.test(parts[0])) parts.shift();

  if (!parts.length) return null;
  const last = parts.pop(); // file.ext
  const dot = last.lastIndexOf(".");
  const base = dot !== -1 ? last.slice(0, dot) : last;
  const public_id = parts.length ? `${parts.join("/")}/${base}` : base;

  return { public_id, resource_type };
}

async function destroyFromUrl(url) {
  const info = extractCloudinaryInfo(url);
  if (!info) return;
  try {
    await cloudinary.uploader.destroy(info.public_id, { resource_type: info.resource_type });
  } catch (e) {
    console.warn("Cloudinary destroy failed:", e?.message);
  }
}

/* ----------------------- Controllers ------------------------------ */

// ➕ Créer une catégorie
export const createCategory = async (req, res) => {
  try {
    const { label, en, alt_fr, alt_en } = req.body;

    // Le middleware Cloudinary met les fichiers dans req.cloudinaryFiles
    const f = (req.cloudinaryFiles && req.cloudinaryFiles[0]) || null;

    const newCategory = await Category.create({
      label,
      translations: { fr: label, en: en || label },
      image: f
        ? {
            url: f.url,
            public_id: f.public_id,
            format: f.format,
            bytes: f.bytes,
            alt_fr: alt_fr || label || "",
            alt_en: alt_en || en || label || "",
          }
        : undefined,
    });

    res.json({ success: true, category: newCategory });
  } catch (err) {
    console.error("Erreur création catégorie:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// 📋 Lire toutes les catégories
export const getCategories = async (_req, res) => {
  try {
    const categories = await Category.find();
    res.json({ success: true, categories });
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// ✏️ Modifier une catégorie
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { label, en, alt_fr, alt_en, removeImage } = req.body;

    const prev = await Category.findById(id);
    if (!prev) return res.status(404).json({ message: "Catégorie non trouvée" });

    const nextTranslations = { fr: label, en: en || label };
    const nextData = { label, translations: nextTranslations };

    const f = (req.cloudinaryFiles && req.cloudinaryFiles[0]) || null;

    // Cas 1 : nouvelle image uploadée
    if (f) {
      // détruire l'ancienne si présente
      if (prev.image?.url) await destroyFromUrl(prev.image.url);

      nextData.image = {
        url: f.url,
        public_id: f.public_id,
        format: f.format,
        bytes: f.bytes,
        alt_fr: alt_fr ?? prev.image?.alt_fr ?? label ?? "",
        alt_en: alt_en ?? prev.image?.alt_en ?? en ?? label ?? "",
      };
    }
    // Cas 2 : suppression explicite
    else if (removeImage === "true" || removeImage === true) {
      if (prev.image?.url) await destroyFromUrl(prev.image.url);
      nextData.image = undefined;
    }
    // Cas 3 : maj des alt sans changer de fichier
    else if (alt_fr !== undefined || alt_en !== undefined) {
      if (prev.image?.url) {
        nextData.image = {
          url: prev.image.url,
          public_id: prev.image.public_id,
          format: prev.image.format,
          bytes: prev.image.bytes,
          alt_fr: alt_fr ?? prev.image.alt_fr ?? "",
          alt_en: alt_en ?? prev.image.alt_en ?? "",
        };
      }
    }

    const updated = await Category.findByIdAndUpdate(id, nextData, { new: true });
    if (!updated) return res.status(404).json({ message: "Catégorie non trouvée" });

    res.json({ success: true, category: updated });
  } catch (err) {
    console.error("Erreur update catégorie:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// ❌ Supprimer une catégorie
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Category.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: "Catégorie non trouvée" });

    if (deleted.image?.url) await destroyFromUrl(deleted.image.url);

    res.json({ success: true, message: "Catégorie supprimée" });
  } catch (err) {
    console.error("Erreur suppression catégorie:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
