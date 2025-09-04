// controllers/devisCompression.controller.js
import DevisCompression from "../models/DevisCompression.js";
import Counter from "../models/Counter.js";
import { buildDevisCompressionPDF } from "../utils/pdf.devisCompression.js";
import { makeTransport } from "../utils/mailer.js";

const toNum = (val) => Number(String(val ?? "").replace(",", "."));
const formatDevisNumber = (year, seq) =>
  `DDV${String(year).slice(-2)}${String(seq).padStart(5, "0")}`;

/**
 * POST /api/devis/compression
 * - nécessite auth (req.user.id)
 * - accepte des fichiers (req.files) -> documents
 */
export const createDevisCompression = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res
        .status(401)
        .json({ success: false, message: "Utilisateur non authentifié" });
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
      enroulement, // optionnel
      extremite,   // optionnel
    };

    // Fichiers joints du client
    const documents = (req.files || []).map((f) => ({
      filename: f.originalname,
      mimetype: f.mimetype,
      data: f.buffer,
    }));

    // Génération du numéro (compteur par année)
    const year = new Date().getFullYear();
    const counterId = `devis:${year}`;
    const c = await Counter.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    ).lean();

    const numero = formatDevisNumber(year, c.seq); // ex: DDV2500001

    // 1) Création en base (sans PDF pour UI rapide)
    const devis = await DevisCompression.create({
      numero,
      user: req.user.id,
      type: "compression",
      spec,
      exigences,
      remarques,
      documents,
    });

    // 2) Réponse immédiate
    res
      .status(201)
      .json({ success: true, devisId: devis._id, numero: devis.numero });

    // 3) Suite asynchrone: PDF + email + stockage PDF
    setImmediate(async () => {
      const toBuffer = (maybeBinary) => {
        if (!maybeBinary) return null;
        if (Buffer.isBuffer(maybeBinary)) return maybeBinary;
        if (maybeBinary.buffer && Buffer.isBuffer(maybeBinary.buffer)) {
          return Buffer.from(maybeBinary.buffer);
        }
        try { return Buffer.from(maybeBinary); } catch { return null; }
      };

      try {
        // Récup complète
        const full = await DevisCompression.findById(devis._id)
          .populate("user", "nom prenom email numTel adresse accountType company personal")
          .lean();

        // Générer PDF
        const pdfBuffer = await buildDevisCompressionPDF(full);

        // Stocker dans demandePdf
        await DevisCompression.findByIdAndUpdate(
          devis._id,
          { $set: { demandePdf: { data: pdfBuffer, contentType: "application/pdf" } } },
          { new: true }
        );

        // Construire les PJ d’email
        const attachments = [
          {
            filename: `devis-compression-${full._id}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ];

        // Limite totale pour éviter erreurs SMTP
        const MAX_TOTAL = 15 * 1024 * 1024; // 15 Mo
        let total = pdfBuffer.length;

        const docs = Array.isArray(full.documents) ? full.documents : [];
        for (const doc of docs) {
          const name = (doc?.filename || "").trim();
          const buf = toBuffer(doc?.data);
          const type = doc?.mimetype || "application/octet-stream";

          if (!name || name.startsWith("~$")) continue; // ignorer fichiers temp Office
          if (!buf || buf.length === 0) continue;
          if (total + buf.length > MAX_TOTAL) {
            console.warn("[MAIL] PJ ignorée (>15 Mo):", name);
            continue;
          }

          attachments.push({ filename: name, content: buf, contentType: type });
          total += buf.length;
        }

        // Infos mail
        const transporter = makeTransport();
        const fullName = [full.user?.prenom, full.user?.nom].filter(Boolean).join(" ") || "Client";
        const clientEmail = full.user?.email || "-";
        const clientTel = full.user?.numTel || "-";
        const clientAdr = full.user?.adresse || "-";
        const clientType = full.user?.accountType || "-"; // ✅ Type de compte

        const human = (n = 0) => {
          const u = ["B", "KB", "MB", "GB"];
          let i = 0, v = n;
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

        // ======= EMAIL HTML (même style bandeau haut/carte/bandeau bas) =======
        const BRAND_PRIMARY = "#002147"; // titres/liens
        const BAND_DARK     = "#0B2239"; // bandes bleu marine
        const BAND_TEXT     = "#FFFFFF"; // texte bandes
        const PAGE_BG       = "#F5F7FB"; // fond page
        const CONTAINER_W   = 680;       // largeur conteneur

        const htmlBody = `<!doctype html>
<html>
  <head>
    <meta charSet="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${fullName} - ${full.numero}</title>
  </head>
  <body style="margin:0;background:${PAGE_BG};font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Apple Color Emoji','Segoe UI Emoji';color:#111827;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;background:${PAGE_BG};margin:0;padding:24px 16px;border-collapse:collapse;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;">
      <tr>
        <td align="center" style="padding:0;margin:0;">

          <!-- Conteneur centré -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                 style="width:${CONTAINER_W}px;max-width:100%;border-collapse:collapse;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;">

            <!-- Bande TOP -->
            <tr>
              <td style="padding:0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                       style="border-collapse:collapse;border-spacing:0;">
                  <tr>
                    <td style="background:${BAND_DARK};color:${BAND_TEXT};text-align:center;
                               padding:14px 20px;font-weight:800;font-size:14px;letter-spacing:.3px;
                               border-radius:8px;box-sizing:border-box;width:100%;">
                      MTR – Manufacture Tunisienne des ressorts
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Espace -->
            <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>

            <!-- Carte contenu -->
            <tr>
              <td style="padding:0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                       style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;border-collapse:separate;box-sizing:border-box;">
                  <tr>
                    <td style="padding:24px;">
                      <p style="margin:0 0 12px 0;">Bonjour, Vous avez reçu une <strong>nouvelle demande de devis (compression)</strong>&nbsp;:</p>
                      <ul style="margin:0 0 16px 20px;padding:0;">
                        <li><strong>Client&nbsp;:</strong> ${fullName}</li>
                        <li><strong>Email&nbsp;:</strong> ${clientEmail}</li>
                        <li><strong>Téléphone&nbsp;:</strong> ${clientTel}</li>
                        <li><strong>Type&nbsp;:</strong> compression</li>
                        <li><strong>N° Demande&nbsp;:</strong> ${full.numero}</li>
                      </ul>


                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Espace -->
            <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>

            <!-- Bande BOTTOM (même largeur que TOP, même sans texte) -->
           <tr>
              <td style="padding:0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                       style="border-collapse:collapse;border-spacing:0;">
                  <tr>
                    <td style="background:${BAND_DARK};color:${BAND_TEXT};text-align:center;
                               padding:14px 20px;font-weight:800;font-size:14px;letter-spacing:.3px;
                               border-radius:8px;box-sizing:border-box;width:100%;">
                      &nbsp;
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: process.env.ADMIN_EMAIL,
          replyTo: clientEmail !== "-" ? clientEmail : undefined,
          subject: `${fullName} - ${full.numero}`, // ✅ Nom Prénom - DDVxxxxx
          text: textBody,
          html: htmlBody,
          attachments,
        });
      } catch (err) {
        console.error("Post-send PDF/email failed (compression):", err);
      }
    });
  } catch (e) {
    console.error("createDevisCompression:", e);
    res
      .status(400)
      .json({ success: false, message: e.message || "Données invalides" });
  }
};
