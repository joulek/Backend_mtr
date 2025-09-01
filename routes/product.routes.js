// MTR_Backend/routes/product.routes.js
import { Router } from "express";
import { upload } from "../middleware/upload.js";
import {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  getProductsByCategory                // ⬅️ import

} from "../controllers/product.controller.js";
const router = Router();

router.get("/", getProducts);
router.get("/by-category/:categoryId", getProductsByCategory); // ⬅️ NEW


router.post("/", upload.array("images", 20), createProduct);
router.get("/:id", getProductById);
router.put("/:id", upload.array("images", 20), updateProduct); // maj avec images
router.delete("/:id", deleteProduct);


export default router;
