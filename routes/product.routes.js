// MTR_Backend/routes/product.routes.js
import { Router } from "express";
import auth from "../middlewares/auth.js";
import {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  getProductsByCategory
} from "../controllers/product.controller.js"; // ⚠️ vérifie bien le nom du fichier (products.controller.js)

// ✅ on importe le middlewares Cloudinary qu’on a créé
import { cloudinaryUploadArray } from "../middlewares/upload.js";

const router = Router();

router.get("/", getProducts);
router.get("/by-category/:categoryId", getProductsByCategory);

// CREATE avec images Cloudinary
router.post(
  "/",
  auth,
  ...cloudinaryUploadArray("images", "products"), // champ `images` côté frontend
  createProduct
);

// GET by id
router.get("/:id", getProductById);

// UPDATE avec images Cloudinary
router.put(
  "/:id",
  auth,
  ...cloudinaryUploadArray("images", "products"),
  updateProduct
);

// DELETE
router.delete("/:id", auth, deleteProduct);

export default router;
