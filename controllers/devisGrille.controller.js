// controllers/devisGrille.controller.js
import DevisGrille from "../models/DevisGrille.js";
import Counter from "../models/Counter.js";
import { buildDevisGrillePDF } from "../utils/pdf.DevisGrille.js"; // garde le même chemin
import { makeTransport } from "../utils/mailer.js";
import { uploadBufferToCloudinary } from "../middlewaress/upload.js"; // helper Cloudinary

const toNum = (val) => Number(String(val ?? "").replace(",", "."));
const formatDevisNumber = (year, seq) =>
  `DDV${String(year).slice(-2)}${String(seq).padStart(5, "0")}`;

const MAX_ATTACH_TOTAL = 15 * 1024 * 1024; // 15MB

export const createDevisGrille = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Utilisateur non authentifié" });
    }

    const {
      L, l, nbLong, nbTrans, pas1, pas2, D2, D1,
      quantite, matiere, finition,
      exigences, remarques,
    } = req.body;

    const spec = {
      L: toNum(L), l: toNum(l),
      nbLong: toNum(nbLong), nbTrans: toNum(nbTrans),
      pas1: toNum(pas1), pas2: toNum(pas2),
      D2: toNum(D2), D1: toNum(D1),
      quantite: toNum(quantite),
      matiere, finition,
    };

    // Fichiers: buffers (req.files) + résultats Cloudinary (req.cloudinaryFiles)
    const incomingFiles = Array.isArray(req.files) ? req.files : [];
    const cloudResults  = Array.isArray(req.cloudinaryFiles) ? req.cloudinaryFiles : [];

    // Documents à stocker en DB (sans buffer)
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

    // Numéro de devis (DDVYY#####)
    const year = new Date().getFullYear();
    const counterId = `devis:${year}`;
    const c = await Counter.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    ).lean();
    const numero = formatDevisNumber(year, c.seq);

    // Enregistrement rapide (sans PDF pour retour immédiat)
    const devis = await DevisGrille.create({
      numero,
      user: req.user.id,
      type: "grille",
      spec,
      exigences,
      remarques,
      documents, // { filename, mimetype, size, url, public_id }
    });

    // Réponse immédiate
    res.status(201).json({ success: true, devisId: devis._id, numero: devis.numero });

    // Post-traitement (PDF + email + upload PDF)
    setImmediate(async () => {
      try {
        const full = await DevisGrille.findById(devis._id)
          .populate("user", "nom prenom email numTel adresse accountType company personal")
          .lean();

        // 1) Générer PDF
        const pdfBuffer = await buildDevisGrillePDF(full);

        // 2) Uploader PDF vers Cloudinary (resource_type: raw)
        const up = await uploadBufferToCloudinary(pdfBuffer, {
          folder: "devis/demandes",
          resource_type: "raw",
          filename_override: `devis-grille-${full._id}.pdf`,
        });

        // 3) Stocker métadonnées du PDF (url/public_id)
        await DevisGrille.findByIdAndUpdate(
          devis._id,
          {
            $set: {
              demandePdf: {
                filename: `devis-grille-${full._id}.pdf`,
                contentType: "application/pdf",
                size: up?.bytes || pdfBuffer?.length || undefined,
                url: up?.secure_url,
                public_id: up?.public_id,
              },
            },
          },
          { new: true }
        );

        // 4) Préparer email (joindre le PDF à partir du buffer)
        const attachments = [
          { filename: `devis-grille-${full._id}.pdf`, content: pdfBuffer, contentType: "application/pdf" },
        ];

        let total = pdfBuffer.length;
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

        const transporter = makeTransport();
        const fullName    = [full.user?.prenom, full.user?.nom].filter(Boolean).join(" ") || "Client";
        const clientEmail = full.user?.email || "-";
        const clientTel   = full.user?.numTel || "-";
        const clientAdr   = full.user?.adresse || "-";
        const clientType  = full.user?.accountType || "-";

        const human = (n = 0) => {
          const u = ["B", "KB", "MB", "GB"]; let i = 0, v = n;
          while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
          return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
        };

        const docsList =
          attachments.slice(1).map(a => `- ${a.filename} (${human(a.content.length)})`).join("\n")
          || "(aucun document client)";

        const textBody = `Nouvelle demande de devis – Grille métallique

Numéro: ${full.numero}
Date: ${new Date(full.createdAt).toLocaleString()}

Infos client
- Nom: ${fullName}
- Email: ${clientEmail}
- Téléphone: ${clientTel}
- Adresse: ${clientAdr}
- Type de compte: ${clientType}

Pièces jointes:
- PDF de la demande: devis-grille-${full._id}.pdf (${human(pdfBuffer.length)})
Documents client:
${docsList}
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
        console.error("Post-send PDF/email (grille) failed:", err);
      }
    });
  } catch (e) {
    console.error("createDevisGrille:", e);
    res.status(400).json({ success: false, message: e.message || "Données invalides" });
  }
};
