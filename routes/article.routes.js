import { Router } from "express";
import {
  getArticles,
  getArticleById,
  createArticle,
  updateArticle,
  deleteArticle,
  getArticleByDemande
} from "../controllers/article.controller.js";

const router = Router();
router.get("/by-demande", getArticleByDemande);
router.get("/", getArticles);
router.post("/", createArticle);
router.put("/:id", updateArticle);
router.delete("/:id", deleteArticle);
export default router;
