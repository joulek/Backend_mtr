// routes/devisTraction.routes.js
import { Router } from "express";
import multer from "multer";
import auth, { only } from "../middleware/auth.js";
import { createDevisTraction } from "../controllers/devisTraction.controller.js";
const storage = multer.memoryStorage();
const upload = multer({ storage });

const router = Router();

router.post(
  "/", // <-- route relative
  auth,
  only("client"),
  upload.array("docs"), // <-- parse tous les champs et fichiers
  createDevisTraction
);

export default router;
