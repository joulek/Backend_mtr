// routes/devis.admin.routes.js
import { Router } from "express";
import auth, { only } from "../middleware/auth.js";
import {
  getAllDevisNumeros,
  getNextDevisNumberPreview,
  createFromDemande,
  getDevisByDemande,
  getDevisByDemandeClient,
  getByDemandeAdmin,
  adminPdfByNumero,            // 👈 add this
} from "../controllers/devis.controller.js";
import { listDevisCompact } from "../controllers/adminDevis.compact.controller.js";

const router = Router();

router.get("/devis/list", /*authAdmin,*/ listDevisCompact);

router.get("/client/by-demande/:demandeId", auth, getDevisByDemandeClient);
router.post("/admin/from-demande", createFromDemande);
router.get("/admin/next-number/preview", auth, only("admin"), getNextDevisNumberPreview);

router.get("/admin/by-demande/:id", getByDemandeAdmin);

// 👇 NEW: stream the PDF by devis number
router.get("/admin/pdf/:numero", adminPdfByNumero);

// utilities
router.get("/", getAllDevisNumeros);

export default router;
