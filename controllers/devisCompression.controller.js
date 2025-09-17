// controllers/devisCompression.controller.js
import DevisCompression from "../models/DevisCompression.js";
import Counter from "../models/Counter.js";
import { buildDevisCompressionPDF } from "../utils/pdf.devisCompression.js";
import { makeTransport } from "../utils/mailer.js";
import { uploadBufferToCloudinary } from "../middlewares/upload.js"; // helper Cloudinary

const toNum = (val) => Number(String(val ?? "").replace(",", "."));
const formatDevisNumber = (year, seq) =>
  `DDV${String(year).slice(-2)}${String(seq).padStart(5, "0")}`;

const MAX_ATTACH_TOTAL = 15 * 1024 * 1024; // 15MB

export const createDevisCompression = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Utilisateur non authentifié" });
    }

    // Champs attendus depuis le form
    const {
      d, DE, H, S, DI, Lo, nbSpires, pas,
      quantite, matiere, enroulement, extremite,
      exigences, remarques,
    } = req.body;

    // Normalisation numérique
    const spec = {
      d: toNum(d),
      DE: toNum(DE),
      H: H != null && H !== "" ? toNum(H) : undefined,
      S: S != null && S !== "" ? toNum(S) : undefined,
      DI: toNum(DI),
      Lo: toNum(Lo),
      nbSpires: toNum(nbSpires),
      pas: pas != null && pas !== "" ? toNum(pas) : undefined,
      quantite: toNum(quantite),
      matiere,
      enroulement,
      extremite,
    };

    // fichiers: buffers en mémoire (req.files) + résultats Cloudinary (req.cloudinaryFiles)
    const incomingFiles = Array.isArray(req.files) ? req.files : [];
    const cloudResults  = Array.isArray(req.cloudinaryFiles) ? req.cloudinaryFiles : [];

    // documents à stocker en DB (sans buffer)
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

    // Génération du numéro (compteur par année)
    const year = new Date().getFullYear();
    const counterId = `devis:${year}`;
    const c = await Counter.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    ).lean();

    const numero = formatDevisNumber(year, c.seq);

    // 1) Création en base (sans PDF pour UI rapide)
    const devis = await DevisCompression.create({
      numero,
      user: req.user.id,
      type: "compression",
      spec,
      exigences,
      remarques,
      documents, // { filename, mimetype, size, url, public_id }
    });

    // 2) Réponse immédiate
    res.status(201).json({ success: true, devisId: devis._id, numero: devis.numero });

    // 3) Suite asynchrone: PDF + email + stockage PDF (Cloudinary)
    setImmediate(async () => {
      try {
        // Récup complète
        const full = await DevisCompression.findById(devis._id)
          .populate("user", "nom prenom email numTel adresse accountType company personal")
          .lean();

        // Générer PDF
        const pdfBuffer = await buildDevisCompressionPDF(full);

        // Uploader le PDF vers Cloudinary (resource_type: raw)
        const uploadRes = await uploadBufferToCloudinary(pdfBuffer, {
          folder: "devis/demandes",
          resource_type: "raw",
          filename_override: `devis-compression-${full._id}.pdf`,
        });

        // Stocker l’URL/public_id du PDF
        await DevisCompression.findByIdAndUpdate(
          devis._id,
          {
            $set: {
              demandePdf: {
                filename: `devis-compression-${full._id}.pdf`,
                contentType: "application/pdf",
                size: uploadRes?.bytes || pdfBuffer?.length || undefined,
                url: uploadRes?.secure_url,
                public_id: uploadRes?.public_id,
              },
            },
          },
          { new: true }
        );

        // Construire les PJ d’email (on attache le PDF généré depuis buffer)
        const attachments = [
          {
            filename: `devis-compression-${full._id}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ];

        let total = pdfBuffer.length;

        // Attachements client (depuis req.files) dans la limite 15MB
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

        // Infos mail
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

        const docsList =
          attachments
            .slice(1) // skip le PDF généré
            .map((a) => `- ${a.filename} (${human(a.content.length)})`)
            .join("\n") || "(aucun document client)";

        const textBody = `Nouvelle demande de devis – Ressort de Compression

Numéro: ${full.numero}
Date: ${new Date(full.createdAt).toLocaleString()}

Infos client
- Nom: ${fullName}
- Email: ${clientEmail}
- Téléphone: ${clientTel}
- Adresse: ${clientAdr}
- Type de compte: ${clientType}

Pièces jointes:
- PDF de la demande: devis-compression-${full._id}.pdf (${human(pdfBuffer.length)})
Documents client:
${docsList}
`;

        // (HTML facultatif – tu peux reprendre le même template que tu avais)
        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: process.env.ADMIN_EMAIL,
          replyTo: clientEmail !== "-" ? clientEmail : undefined,
          subject: `${fullName} - ${full.numero}`,
          text: textBody,
          attachments,
        });
      } catch (err) {
        console.error("Post-send PDF/email failed (compression):", err);
      }
    });
  } catch (e) {
    console.error("createDevisCompression:", e);
    res.status(400).json({ success: false, message: e.message || "Données invalides" });
  }
};
