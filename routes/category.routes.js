// routes/category.routes.js
import express from "express";
import {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
} from "../controllers/category.controller.js";

// ⚠️ on utilise le middleware Cloudinary (pas l'ancien upload disque)
import { cloudinaryUploadArray } from "../middlewares/upload.js";
import auth from "../middleware/auth.js"; // si tu veux protéger

const router = express.Router();

// create avec une image unique: champ "image"
router.post(
  "/",
  auth,
  ...cloudinaryUploadArray("image", "categories"),
  createCategory
);

router.get("/", getCategories);

router.put(
  "/:id",
  auth,
  ...cloudinaryUploadArray("image", "categories"), // on accepte un nouveau fichier optionnel
  updateCategory
);

router.delete("/:id", auth, deleteCategory);

export default router;
