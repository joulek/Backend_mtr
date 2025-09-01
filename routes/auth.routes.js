// routes/auth.routes.js
import { Router } from "express";
import { registerClient, registerAdmin,requestPasswordReset,resetPasswordWithCode,setPassword } from "../controllers/authController.js";

const router = Router();

// POST /api/auth/register-client
router.post("/register-client", registerClient);

// POST /api/auth/register-admin
router.post("/register-admin", registerAdmin);
router.post("/forgot-password", requestPasswordReset);
router.post("/reset-password", resetPasswordWithCode);
router.post("/set-password", setPassword);
export default router;