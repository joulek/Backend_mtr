// controllers/category.controller.js
import Category from "../models/category.js";
import fs from "fs";
import path from "path";

// -- Helpers fichiers --------------------------------------------------------
const toPublicUrl = (file) => (file?.filename ? `/uploads/${file.filename}` : null);

const removeLocalFileByUrl = (url) => {
  try {
    if (!url) return;
    const abs = path.join(process.cwd(), url.replace(/^\//, "")); // enlève le "/" initial
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (e) {
    // on évite de casser la requête si la suppression échoue
    console.warn("Suppression fichier échouée:", e?.message);
  }
};

// ➕ Créer une catégorie
export const createCategory = async (req, res) => {
  try {
    const { label, en, alt_fr, alt_en } = req.body;

    const imageUrl = toPublicUrl(req.file); // req.file fourni par upload.single("image")

    const newCategory = new Category({
      label,
      translations: {
        fr: label,
        en: en || label,
      },
      image: imageUrl
        ? {
            url: imageUrl,
            alt_fr: alt_fr || label || "",
            alt_en: alt_en || en || label || "",
          }
        : undefined,
    });

    await newCategory.save();
    res.json({ success: true, category: newCategory });
  } catch (err) {
    console.error("Erreur création catégorie:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// 📋 Lire toutes les catégories
export const getCategories = async (req, res) => {
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

    // On récupère l'ancienne catégorie pour gérer le remplacement/suppression du fichier
    const prev = await Category.findById(id);
    if (!prev) return res.status(404).json({ message: "Catégorie non trouvée" });

    const nextTranslations = {
      fr: label,
      en: en || label,
    };

    const nextData = {
      label,
      translations: nextTranslations,
    };

    const newFileUrl = toPublicUrl(req.file);

    // Cas 1 : un nouveau fichier arrive → on remplace l'image
    if (newFileUrl) {
      nextData.image = {
        url: newFileUrl,
        alt_fr: alt_fr ?? prev.image?.alt_fr ?? label ?? "",
        alt_en: alt_en ?? prev.image?.alt_en ?? en ?? label ?? "",
      };
    } else if (removeImage === "true" || removeImage === true) {
      // Cas 2 : on demande explicitement de retirer l'image
      nextData.image = undefined;
    } else if (alt_fr !== undefined || alt_en !== undefined) {
      // Cas 3 : on ne change pas le fichier mais on met à jour les alts si fournis
      if (prev.image?.url) {
        nextData.image = {
          url: prev.image.url,
          alt_fr: alt_fr ?? prev.image.alt_fr ?? "",
          alt_en: alt_en ?? prev.image.alt_en ?? "",
        };
      }
    }

    const updated = await Category.findByIdAndUpdate(id, nextData, { new: true });

    if (!updated) return res.status(404).json({ message: "Catégorie non trouvée" });

    // Si un nouveau fichier a été uploadé, on supprime l'ancien fichier local
    if (newFileUrl && prev.image?.url && prev.image.url !== newFileUrl) {
      removeLocalFileByUrl(prev.image.url);
    }

    // Si on a retiré l'image, supprimer l'ancien fichier
    if ((removeImage === "true" || removeImage === true) && prev.image?.url) {
      removeLocalFileByUrl(prev.image.url);
    }

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

    // Supprime aussi le fichier image local si présent
    if (deleted.image?.url) {
      removeLocalFileByUrl(deleted.image.url);
    }

    res.json({ success: true, message: "Catégorie supprimée" });
  } catch (err) {
    console.error("Erreur suppression catégorie:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
