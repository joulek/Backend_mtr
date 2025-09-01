import express from "express";
import {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
} from "../controllers/category.controllers.js";
const router = express.Router();
import { upload } from "../middleware/upload.js"; // ton multer configuréi
router.post("/", upload.single("image"), createCategory);
router.get("/", getCategories);
router.put("/:id", upload.single("image"), updateCategory); // << important
router.delete("/:id", deleteCategory);

export default router;
