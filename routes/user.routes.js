// routes/user.routes.js
import { Router } from "express";
import requireAdmin from "../middleware/auth.js"; // doit mettre req.user = { id, role }
import { me, updateMe, listUsers,inviteUser,setPassword,changePassword } from "../controllers/userController.js";
import auth from "../middleware/auth.js"; // middleware d'authentification
const router = Router();

// Profil utilisateur connecté
router.get("/me", auth, me);

// Mise à jour du profil
router.patch("/me", auth, updateMe);

// Liste des utilisateurs (admin seulement)
router.get(
  "/",
  auth,
  (req, res, next) => {
    // ⚠️ lire le rôle depuis req.user.role (et pas req.userRole)
    if (req.user?.role !== "admin") {
      return res.status(403).json({ error: "Accès refusé" });
    }
    next();
  },
  listUsers
);
router.post("/invite", requireAdmin, inviteUser);
router.post("/set-password", setPassword);
router.post("/change-password", auth, changePassword);



export default router; // ✅ important
