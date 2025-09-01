// routes/dashboard.routes.js
import { Router } from "express";
import { dashboardOverview } from "../controllers/dashboard.controller.js";
import auth, { only } from "../middleware/auth.js"; // <-- vérifie bien le chemin: middleware/auth.js

const router = Router();

// GET /api/dashboard/overview?from=...&to=...&minOrders=3&limit=10
router.get("/overview", auth, only("admin"), dashboardOverview);

// (optionnel) route de debug pour voir le rôle détecté
router.get("/whoami", auth, (req, res) => res.json(req.user));

export default router;
