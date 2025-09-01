// routes/devis.admin.routes.js
import { Router } from "express";
import auth, { only } from "../middleware/auth.js";
import {
  getAllDevisNumeros,
  getNextDevisNumberPreview,
  createFromDemande,
  getDevisByDemande,
  getDevisByDemandeClient,getByDemandeAdmin
} from "../controllers/devis.controller.js";
import { listDevisCompact } from "../controllers/adminDevis.compact.controller.js";
const router = Router();

router.get("/devis/list", /*authAdmin,*/ listDevisCompact);

router.get("/client/by-demande/:demandeId", auth, getDevisByDemandeClient);

router.post("/admin/from-demande", createFromDemande);
router.get("/admin/next-number/preview", auth, only("admin"), getNextDevisNumberPreview);

// ✅ Endpoints attendus par le Front

router.get("/admin/by-demande/:id", getByDemandeAdmin);
// Utilitaires numéros (optionnels mais utiles)
router.get("/", getAllDevisNumeros);


export default router;
