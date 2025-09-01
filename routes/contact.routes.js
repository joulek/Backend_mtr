import { Router } from "express";
import { contactSend } from "../controllers/contact.controller.js";

const router = Router();

router.post("/", contactSend);

export default router;
