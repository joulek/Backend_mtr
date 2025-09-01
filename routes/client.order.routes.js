// routes/client.order.routes.js
import { Router } from "express";
import auth, { only } from "../middleware/auth.js"; // ✅ default + named
import { placeClientOrder, getClientOrderStatus } from "../controllers/order.controller.js";

const router = Router();

// GET /api/order/client/status
router.get("/client/status", auth, only("client"), getClientOrderStatus);

// POST /api/order/client/commander
router.post("/client/commander", auth, only("client"), placeClientOrder);

export default router;
