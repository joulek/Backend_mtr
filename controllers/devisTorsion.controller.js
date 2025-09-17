// controllers/devisTorsion.controller.js
import DevisTorsion from "../models/DevisTorsion.js";
import Counter from "../models/Counter.js";
import { buildDevisTorsionPDF } from "../utils/pdf.devisTorsion.js";
import { makeTransport } from "../utils/mailer.js";
import { uploadBufferToCloudinary } from "../middlewaress/upload.js";

const toNum = (v) => Number(String(v ?? "").replace(",", "."));
const formatDevisNumber = (year, seq) =>
  `DDV${String(year).slice(-2)}${String(seq).padStart(5, "0")}`;

const MAX_ATTACH_TOTAL = 15 * 1024 * 1024; // 15MB

export const createDevisTorsion = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Utilisateur non authentifié" });
    }

    const {
      d, De, Lc, angle, nbSpires, L1, L2,
      quantite, matiere, enroulement, exigences, remarques
    } = req.body;

    const spec = {
      d: toNum(d), De: toNum(De), Lc: toNum(Lc),
      angle: toNum(angle), nbSpires: toNum(nbSpires),
      L1: toNum(L1), L2: toNum(L2),
      quantite: toNum(quantite),
      matiere, enroulement,
    };

    // fichiers client: buffers + résultats Cloudinary posés par middlewares
    const incomingFiles = Array.isArray(req.files) ? req.files : [];
    const cloudResults  = Array.isArray(req.cloudinaryFiles) ? req.cloudinaryFiles : [];

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

    // numéro séquentiel annuel
    const year = new Date().getFullYear();
    const c = await Counter.findOneAndUpdate(
      { _id: `devis:${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true }
    ).lean();
    const numero = formatDevisNumber(year, c.seq);

    // sauvegarde sans PDF pour retour rapide
    const devis = await DevisTorsion.create({
      numero,
      user: req.user.id,
      type: "torsion",
      spec,
      exigences,
      remarques,
      documents,
    });

    res.status(201).json({ success: true, devisId: devis._id, numero });

    // suite asynchrone: PDF + upload PDF + email
    setImmediate(async () => {
      try {
        const full = await DevisTorsion.findById(devis._id)
          .populate("user", "nom prenom email numTel adresse accountType company personal")
          .lean();

        // PDF buffer
        const pdfBuffer = await buildDevisTorsionPDF(full);

        // Upload PDF → Cloudinary (resource_type: raw)
        const up = await uploadBufferToCloudinary(pdfBuffer, {
          folder: "devis/demandes",
          resource_type: "raw",
          filename_override: `devis-torsion-${full._id}.pdf`,
        });

        // stocker métadonnées PDF
        await DevisTorsion.findByIdAndUpdate(
          devis._id,
          {
            $set: {
              demandePdf: {
                filename: `devis-torsion-${full._id}.pdf`,
                contentType: "application/pdf",
                size: up?.bytes || pdfBuffer?.length || undefined,
                url: up?.secure_url,
                public_id: up?.public_id,
              },
            },
          },
          { new: true }
        );

        // email: joindre PDF depuis buffer + fichiers client (<=15MB)
        const attachments = [
          { filename: `devis-torsion-${full._id}.pdf`, content: pdfBuffer, contentType: "application/pdf" },
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

        const t = makeTransport();
        const fullName   = [full.user?.prenom, full.user?.nom].filter(Boolean).join(" ") || "Client";
        const clientEmail= full.user?.email || "-";
        const clientTel  = full.user?.numTel || "-";
        const clientAdr  = full.user?.adresse || "-";
        const clientType = full.user?.accountType || "-";

        const human = (n=0)=>{const u=["B","KB","MB","GB"];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++;}return `${v.toFixed(v<10&&i>0?1:0)} ${u[i]}`;};
        const docsList = attachments.slice(1).map(a=>`- ${a.filename} (${human(a.content.length)})`).join("\n") || "(aucun document client)";

        const textBody = `Nouvelle demande de devis – Ressort de Torsion

Numéro: ${full.numero}
Date: ${new Date(full.createdAt).toLocaleString()}

Infos client
- Nom: ${fullName}
- Email: ${clientEmail}
- Téléphone: ${clientTel}
- Adresse: ${clientAdr}
- Type de compte: ${clientType}

Pièces jointes:
- PDF de la demande: devis-torsion-${full._id}.pdf (${human(pdfBuffer.length)})
Documents client:
${docsList}
`;

        await t.sendMail({
          from: process.env.SMTP_USER,
          to: process.env.ADMIN_EMAIL,
          replyTo: clientEmail !== "-" ? clientEmail : undefined,
          subject: `${fullName} - ${full.numero}`,
          text: textBody,
          attachments,
        });
      } catch (err) {
        console.error("Post-send PDF/email failed (torsion):", err);
      }
    });
  } catch (e) {
    console.error("createDevisTorsion:", e);
    res.status(400).json({ success: false, message: e.message || "Données invalides" });
  }
};
