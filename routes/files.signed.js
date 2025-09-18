// routes/files.signed.js (exemple)
import express from "express";
import auth from "../middlewares/auth.js";
import { v2 as cloudinary } from "cloudinary";

const router = express.Router();

/**
 * GET /api/files/signed?public_id=...&rt=raw&filename=monfichier.pdf
 * Retourne une URL signée Cloudinary (valable ~5 min) pour assets "authenticated"
 */
router.get("/files/signed", auth, async (req, res) => {
  try {
    const public_id = req.query.public_id;
    const rt = req.query.rt || "raw";       // raw pour PDF, image pour jpg/png
    const filename = req.query.filename || "document.pdf";

    if (!public_id) return res.status(400).json({ message: "public_id manquant" });

    // expire dans 5 minutes
    const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;

    const signedUrl = cloudinary.url(public_id, {
      resource_type: rt,          // 'raw' pour PDF
      type: "authenticated",      // IMPORTANT si tes assets sont protégés
      sign_url: true,
      expires_at: expiresAt,
      secure: true,
      attachment: filename,       // force le téléchargement (Content-Disposition)
    });

    return res.json({ url: signedUrl, expiresAt });
  } catch (e) {
    console.error("signed url error:", e);
    res.status(500).json({ message: "Erreur signature URL" });
  }
});

export default router;
