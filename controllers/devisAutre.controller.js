// controllers/devisAutre.controller.js
import DevisAutre from "../models/DevisAutre.js";
import Counter from "../models/Counter.js";
import { buildDevisAutrePDF } from "../utils/pdf.devisAutre.js";
import { makeTransport } from "../utils/mailer.js";
import { uploadBufferToCloudinary } from "../middlewares/upload.js"; // ⚠️ helper qu'on a créé

const formatDevisNumber = (year, seq) =>
  `DDV${String(year).slice(-2)}${String(seq).padStart(5, "0")}`;

const MAX_FILES = 4;
const MAX_ATTACH_TOTAL = 15 * 1024 * 1024;

// petites aides
const isBlank = (v) => !v || String(v).trim() === "";
const toStr = (v) => (v == null ? "" : String(v));
const clean = (v) => toStr(v).trim();

export const createDevisAutre = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Utilisateur non authentifié" });
    }

    const {
      titre,
      description,
      designation,
      dimensions,
      quantite,
      matiere,
      matiereAutre,
      exigences,
      remarques,
    } = req.body || {};

    // validations
    const dsg = clean(designation || titre);
    if (isBlank(dsg)) {
      return res.status(400).json({ success: false, message: "La désignation est requise." });
    }

    const qRaw = clean(quantite);
    const qte = Number(qRaw);
    if (!Number.isFinite(qte) || qte < 1) {
      return res.status(400).json({ success: false, message: "Quantité invalide (>= 1)." });
    }

    let mat = clean(matiere);
    const matAutre = clean(matiereAutre);
    if (isBlank(mat) || /^autre$/i.test(mat)) {
      if (isBlank(matAutre)) {
        return res.status(400).json({ success: false, message: "La matière est requise." });
      }
      mat = matAutre;
    }

    // fichiers côté upload middleware:
    // - req.files       → buffers mémoire (pour attacher par email si <= 15MB)
    // - req.cloudinaryFiles → résultats Cloudinary (url/public_id/bytes/format)
    const incomingFiles = Array.isArray(req.files) ? req.files : [];
    const cloudResults  = Array.isArray(req.cloudinaryFiles) ? req.cloudinaryFiles : [];

    if (incomingFiles.length > MAX_FILES) {
      return res.status(400).json({
        success: false,
        message: `Vous pouvez joindre au maximum ${MAX_FILES} fichiers.`,
      });
    }

    // documents à stocker en DB (sans buffer)
    // on associe chaque Cloudinary result au fichier original (même ordre)
    const documents = cloudResults.map((r, i) => {
      const f = incomingFiles[i];
      return {
        filename: f?.originalname || `document-${i + 1}`,
        mimetype: f?.mimetype || undefined,
        size: r?.bytes ?? f?.size ?? undefined,
        url: r?.url,
        public_id: r?.public_id,
      };
    });

    const spec = {
      titre: clean(titre) || dsg || "Article",
      description: clean(description) || clean(req.body?.["description"]) || "",
      designation: dsg,
      dimensions: clean(dimensions),
      quantite: qte,
      matiere: mat,
      matiereAutre: matAutre || "",
    };

    // Générer numéro unique par année
    const year = new Date().getFullYear();
    const counterId = `devis:${year}`;
    const c = await Counter.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    ).lean();
    const numero = formatDevisNumber(year, c.seq);

    // Enregistrement initial sans PDF (on ajoute l'URL après upload)
    const devis = await DevisAutre.create({
      numero,
      user: req.user.id,
      type: "autre",
      spec,
      exigences: clean(exigences),
      remarques: clean(remarques),
      documents, // { filename, mimetype, size, url, public_id }
    });

    // réponse immédiate
    res.status(201).json({ success: true, devisId: devis._id, numero: devis.numero });

    // ----------- PDF + MAIL asynchrones -----------
    setImmediate(async () => {
      try {
        const full = await DevisAutre.findById(devis._id)
          .populate("user", "nom prenom email numTel adresse accountType company personal")
          .lean();

        // Générer PDF en mémoire
        const pdfBuffer = await buildDevisAutrePDF(full);

        // Uploader le PDF vers Cloudinary (resource_type: raw)
        const uploadRes = await uploadBufferToCloudinary(pdfBuffer, {
          folder: "devis/demandes",
          resource_type: "raw",
          filename_override: `devis-autre-${full._id}.pdf`,
        });

        // Sauvegarder les métadonnées du PDF (url/public_id)
        await DevisAutre.findByIdAndUpdate(devis._id, {
          $set: {
            demandePdf: {
              filename: `devis-autre-${full._id}.pdf`,
              contentType: "application/pdf",
              size: uploadRes?.bytes || pdfBuffer?.length || undefined,
              url: uploadRes?.secure_url,
              public_id: uploadRes?.public_id,
            },
          },
        });

        // Préparation email
        const transporter = makeTransport();
        const fullName = [full.user?.prenom, full.user?.nom].filter(Boolean).join(" ") || "Client";
        const clientEmail = full.user?.email || "-";
        const clientTel = full.user?.numTel || "-";
        const clientAdr = full.user?.adresse || "-";
        const clientType = full.user?.accountType || "-";

        const human = (n = 0) => {
          const u = ["B", "KB", "MB", "GB"]; let i = 0, v = n;
          while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
          return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
        };

        // Attache le PDF (depuis buffer généré)
        const attachments = [
          {
            filename: `devis-autre-${full._id}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ];
        let total = pdfBuffer.length;

        // Attachements client depuis req.files (pas depuis Cloudinary) dans la limite 15MB
        for (let i = 0; i < incomingFiles.length; i++) {
          const f = incomingFiles[i];
          if (!f?.buffer?.length) continue;
          if (total + f.buffer.length > MAX_ATTACH_TOTAL) continue;
          attachments.push({
            filename: f.originalname || `document-${i + 1}`,
            content: f.buffer,
            contentType: f.mimetype || "application/octet-stream",
          });
          total += f.buffer.length;
        }

        const specBlockTxt = `
Détails article
- Référence: ${full.spec?.designation || full.spec?.titre || "-"}
- Dimensions: ${full.spec?.dimensions || "-"}
- Quantité: ${full.spec?.quantite ?? "-"}
- Matière: ${full.spec?.matiere || "-"}
- Description: ${(full.spec?.description || "").trim() || "-"}
`.trim();

        const textBody = `Nouvelle demande de devis – Autre Type

Numéro: ${full.numero}
Date: ${new Date(full.createdAt).toLocaleString()}

Infos client
- Nom: ${fullName}
- Email: ${clientEmail}
- Téléphone: ${clientTel}
- Adresse: ${clientAdr}
- Type de compte: ${clientType}

${specBlockTxt}
`;

        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: process.env.ADMIN_EMAIL,
          replyTo: clientEmail !== "-" ? clientEmail : undefined,
          subject: `${fullName} - ${full.numero}`,
          text: textBody,
          attachments,
        });
      } catch (err) {
        console.error("Post-send (PDF/email) failed:", err);
      }
    });
  } catch (e) {
    console.error("createDevisAutre:", e);
    res.status(400).json({ success: false, message: e.message || "Données invalides" });
  }
};
