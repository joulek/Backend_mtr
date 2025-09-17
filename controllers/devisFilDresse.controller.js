// controllers/devisFilDresse.controller.js
import DevisFilDresse from "../models/DevisFilDresse.js";
import Counter from "../models/Counter.js";
import { buildDevisFilDressePDF } from "../utils/pdf.devisFilDresse.js";
import { makeTransport } from "../utils/mailer.js";
import { uploadBufferToCloudinary } from "../middlewares/upload.js"; // helper متاع Cloudinary

const toNum = (val) => Number(String(val ?? "").replace(",", "."));
const formatDevisNumber = (year, seq) =>
  `DDV${String(year).slice(-2)}${String(seq).padStart(5, "0")}`;

const MAX_ATTACH_TOTAL = 15 * 1024 * 1024; // 15MB

export const createDevisFilDresse = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Utilisateur non authentifié" });
    }

    const {
      longueurValeur, longueurUnite,
      diametre,
      quantiteValeur, quantiteUnite,
      matiere,
      exigences, remarques,
    } = req.body;

    // spec normalized
    const spec = {
      longueurValeur: toNum(longueurValeur),
      longueurUnite,
      diametre: toNum(diametre),
      quantiteValeur: toNum(quantiteValeur),
      quantiteUnite,
      matiere,
    };

    // ملفات الطلب:
    // - req.files: buffers (لإرفاقهم في الإيميل)
    // - req.cloudinaryFiles: { url, public_id, bytes, format } (من الميدلوير)
    const incomingFiles = Array.isArray(req.files) ? req.files : [];
    const cloudResults  = Array.isArray(req.cloudinaryFiles) ? req.cloudinaryFiles : [];

    // نخزّن وثائق Cloudinary في DB (من غير Buffer)
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

    // رقم متسلسل بالسنة
    const year = new Date().getFullYear();
    const counterId = `devis:${year}`;
    const c = await Counter.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    ).lean();
    const numero = formatDevisNumber(year, c.seq);

    // إنشاء الدوكيومون من غير PDF (باش الرسبونس ترجع بسرعة)
    const devis = await DevisFilDresse.create({
      numero,
      user: req.user.id,
      type: "fil",
      spec,
      exigences,
      remarques,
      documents, // { filename, mimetype, size, url, public_id }
    });

    res.status(201).json({ success: true, devisId: devis._id, numero: devis.numero });

    // -------- PDF + Mail async --------
    setImmediate(async () => {
      try {
        const full = await DevisFilDresse.findById(devis._id)
          .populate("user", "nom prenom email numTel adresse accountType company personal")
          .lean();

        // بناء PDF
        const pdfBuffer = await buildDevisFilDressePDF(full);

        // رفع PDF لCloudinary resource_type: raw
        const up = await uploadBufferToCloudinary(pdfBuffer, {
          folder: "devis/demandes",
          resource_type: "raw",
          filename_override: `devis-filDresse-${full._id}.pdf`,
        });

        // تخزين بيانات PDF في الوثيقة
        await DevisFilDresse.findByIdAndUpdate(
          devis._id,
          {
            $set: {
              demandePdf: {
                filename: `devis-filDresse-${full._id}.pdf`,
                contentType: "application/pdf",
                size: up?.bytes || pdfBuffer?.length || undefined,
                url: up?.secure_url,
                public_id: up?.public_id,
              },
            },
          },
          { new: true }
        );

        // تجهيز الإيميل: نبعث PDF من الBuffer (مش من Cloudinary)
        const attachments = [
          { filename: `devis-filDresse-${full._id}.pdf`, content: pdfBuffer, contentType: "application/pdf" },
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
        const fullName   = [full.user?.prenom, full.user?.nom].filter(Boolean).join(" ") || "Client";
        const clientEmail= full.user?.email || "-";
        const clientTel  = full.user?.numTel || "-";
        const clientAdr  = full.user?.adresse || "-";
        const clientType = full.user?.accountType || "-";

        const human = (n = 0) => {
          const u = ["B", "KB", "MB", "GB"]; let i = 0, v = n;
          while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
          return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
        };

        const docsList =
          attachments.slice(1).map(a => `- ${a.filename} (${human(a.content.length)})`).join("\n")
          || "(aucun document client)";

        const textBody = `Nouvelle demande de devis – Fil dressé

Numéro: ${full.numero}
Date: ${new Date(full.createdAt).toLocaleString()}

Infos client
- Nom: ${fullName}
- Email: ${clientEmail}
- Téléphone: ${clientTel}
- Adresse: ${clientAdr}
- Type de compte: ${clientType}

Spécifications:
- Longueur: ${full.spec?.longueurValeur} ${full.spec?.longueurUnite}
- Diamètre: ${full.spec?.diametre}
- Quantité: ${full.spec?.quantiteValeur} ${full.spec?.quantiteUnite}
- Matière: ${full.spec?.matiere}
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
        console.error("Post-send PDF/email failed (filDresse):", err);
      }
    });
  } catch (e) {
    console.error("createDevisFilDresse:", e);
    res.status(400).json({ success: false, message: e.message || "Données invalides" });
  }
};
