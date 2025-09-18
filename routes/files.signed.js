// routes/files.proxy.js
import { Router } from "express";
import { v2 as cloudinary } from "cloudinary";
import auth from "../middlewares/auth.js";
import fetch from "node-fetch"; // npm i node-fetch@2

const router = Router();

/**
 * GET /api/files/download?public_id=...&rt=raw|image&filename=...
 * - Ne révèle PAS l'URL Cloudinary
 * - Stream côté serveur vers le client (Content-Disposition: attachment)
 */
router.get("/files/download", auth, async (req, res) => {
  try {
    const public_id = String(req.query.public_id || "");
    const rt = (req.query.rt === "image" ? "image" : "raw"); // PDF => raw
    const filename = String(req.query.filename || "download");

    if (!public_id) return res.status(400).json({ message: "public_id manquant" });

    // URL signée courte durée (assets en delivery type: authenticated)
    const expiresAt = Math.floor(Date.now() / 1000) + 60; // 60s
    const signedUrl = cloudinary.utils.private_download_url(
      public_id,
      undefined, // format auto
      {
        resource_type: rt,
        type: "authenticated",
        expires_at: expiresAt,
        attachment: filename, // forcer le nom de fichier
      }
    );

    // On récupère le fichier côté serveur
    const upstream = await fetch(signedUrl);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ message: "Cloudinary fetch failed" });
    }

    // Recopie quelques headers utiles
    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    const len = upstream.headers.get("content-length");
    res.setHeader("Content-Type", ct);
    if (len) res.setHeader("Content-Length", len);
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // Stream vers le client
    upstream.body.pipe(res);
  } catch (e) {
    console.error("files/download error:", e);
    res.status(500).json({ message: "Erreur téléchargement" });
  }
});

export default router;
