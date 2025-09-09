import path from "path";
import fs from "fs";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import { makeTransport } from "../utils/mailer.js";

import DemandeAutre from "../models/DevisAutre.js";
import DemandeCompression from "../models/DevisCompression.js";
import DemandeTraction from "../models/DevisTraction.js";
import DemandeTorsion from "../models/DevisTorsion.js";
import DemandeFilDresse from "../models/DevisFilDresse.js";
import DemandeGrille from "../models/DevisGrille.js";
import ClientOrder from "../models/ClientOrder.js";
import User from "../models/User.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ORIGIN =
  process.env.PUBLIC_BACKEND_URL || `http://localhost:${process.env.PORT }`;

const DEMANDE_MODELS = [
  { type: "autre", Model: DemandeAutre },
  { type: "compression", Model: DemandeCompression },
  { type: "traction", Model: DemandeTraction },
  { type: "torsion", Model: DemandeTorsion },
  { type: "fil", Model: DemandeFilDresse },
  { type: "grille", Model: DemandeGrille },
];

// Host propre (masque localhost)
function getSiteHost(req) {
  const fromEnv =
    (process.env.SITE_HOST ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.PUBLIC_SITE_URL ||
      process.env.PUBLIC_BACKEND_URL ||
      "").trim();

  const clean = (v) =>
    v.toString().replace(/^https?:\/\//, "").replace(/\/+$/, "");

  let host = "";
  if (fromEnv) {
    try { host = new URL(fromEnv).host || clean(fromEnv); }
    catch { host = clean(fromEnv); }
  } else {
    const xfHost = req.headers["x-forwarded-host"];
    host = Array.isArray(xfHost) ? xfHost[0] : (xfHost || req.headers.host || "");
    host = clean(host);
  }

  const isLocal = /^(localhost(:\d+)?|127\.0\.0\.1(:\d+)?|.+\.local)$/i.test(host);
  return isLocal ? "" : host;
}

async function findOwnedDemande(demandeId, userId) {
  for (const { type, Model } of DEMANDE_MODELS) {
    const doc = await Model.findById(demandeId).populate("user");
    if (doc && String(doc.user?._id) === String(userId)) return { type, doc };
  }
  return null;
}

function buildAttachmentFromPdfInfo(devisNumero, devisPdf) {
  if (devisNumero) {
    const filename = `${devisNumero}.pdf`;
    const localPath = path.resolve(process.cwd(), "storage", "devis", filename);
    if (fs.existsSync(localPath)) return { filename, path: localPath };
  }
  if (devisPdf) {
    const filename = `${devisNumero || "devis"}.pdf`;
    return { filename, path: devisPdf };
  }
  return null;
}

function isValidEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/** POST /api/order/client/commander */
export async function placeClientOrder(req, res) {
  try {
    const { demandeId, devisNumero, devisPdf, demandeNumero, note = "" } = req.body || {};
    const userId = req.user?.id || req.user?._id;

    if (!userId) return res.status(401).json({ success: false, message: "Non authentifié" });
    if (!demandeId) return res.status(400).json({ success: false, message: "demandeId manquant" });

    const owned = await findOwnedDemande(demandeId, userId);
    if (!owned) return res.status(403).json({ success: false, message: "Accès interdit" });
    const { type, doc: demande } = owned;

    await ClientOrder.findOneAndUpdate(
      { user: userId, demandeId },
      { $set: { status: "confirmed", demandeType: type, devisNumero: devisNumero || null } },
      { upsert: true, new: true }
    );

    // Infos client
    const dbUser = await User.findById(userId)
      .select("prenom nom email tel numTel")
      .lean()
      .catch(() => null);

    const uEmail = (req.user?.email || dbUser?.email || "").trim();
    const uTel = (req.user?.tel || dbUser?.tel || dbUser?.numTel || "").trim();
    const uPrenom = (req.user?.prenom || dbUser?.prenom || "").trim();
    const uNom = (req.user?.nom || dbUser?.nom || "").trim();
    const clientDisplay = (uPrenom || uNom)
      ? `${uPrenom} ${uNom}`.trim()
      : (uEmail || "Client");

    // Sujet & pièces jointes
    const subject =
      `Commande confirmée – ${devisNumero ? `Devis ${devisNumero}` : `Demande ${demandeNumero || demande.numero || demandeId}`}`;

    const devisAttachment = buildAttachmentFromPdfInfo(devisNumero, devisPdf);
    const devisLink = devisPdf || (devisNumero ? `${ORIGIN}/files/devis/${devisNumero}.pdf` : null);

    // Texte fallback
    const lines = [
      `Bonjour,`,
      ``,
      `Un client confirme une commande :`,
      `• Client : ${clientDisplay}`,
      `• Email : ${uEmail || "-"}`,
      `• Téléphone : ${uTel || "-"}`,
      `• N° Demande : ${demandeNumero || demande.numero || demandeId}`,
      devisNumero ? `• N° Devis : ${devisNumero}` : null,
      devisLink ? `• Lien PDF devis : ${devisLink}` : null,
      `• Type : ${type}`,
      note ? `• Note : ${note}` : null,
      ``,
      `Merci.`,
    ].filter(Boolean);
    const textBody = lines.join("\n");

    // Styles & couleurs
    const BRAND_PRIMARY = "#002147";   // titres/links
    const BAND_DARK = "#0B2239";   // bleu marine foncé pour les bandes (comme ta capture)
    const BAND_TEXT = "#FFFFFF";   // texte en blanc dans les bandes foncées
    const PAGE_BG = "#F5F7FB";   // fond général clair
    const CONTAINER_W = 680;         // largeur du container
    const SITE_HOST = getSiteHost(req);
    const html = `<!doctype html>
<html>
  <head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;background:${PAGE_BG};font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Apple Color Emoji','Segoe UI Emoji';color:#111827;">

    <!-- Wrapper plein écran -->
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

            <!-- Espace vertical -->
            <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>

            <!-- Carte contenu (padding géré ici, pas sur les bandes) -->
            <tr>
              <td style="padding:0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                       style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;
                              border-collapse:separate;box-sizing:border-box;">
                  <tr>
                    <td style="padding:24px;">
                      <h1 style="margin:0 0 12px 0;font-size:18px;line-height:1.35;color:${BRAND_PRIMARY};"></h1>
                      <p style="margin:0 0 12px 0;">Bonjour, Vous avez reçu une nouvelle commande&nbsp;:</p>
                      <ul style="margin:0 0 16px 20px;padding:0;">
                        <li><strong>Client&nbsp;:</strong> ${clientDisplay}</li>
                        <li><strong>Email&nbsp;:</strong> ${uEmail || "-"}</li>
                        <li><strong>Téléphone&nbsp;:</strong> ${uTel || "-"}</li>
                        <li><strong>Type&nbsp;:</strong> ${type}</li>
                        <li><strong>N° Demande&nbsp;:</strong> ${demandeNumero || demande.numero || demandeId}</li>
                        ${devisNumero ? `<li><strong>N° Devis&nbsp;:</strong> ${devisNumero}</li>` : ""}
                        ${note ? `<li><strong>Note&nbsp;:</strong> ${note}</li>` : ""}
                      </ul>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Espace vertical -->
            <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>

            <!-- Bande BOTTOM (identique à TOP) -->
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



    // Destinataires & expéditeur
    const adminToRaw = (process.env.ADMIN_EMAIL || "").trim();
    const adminTo = isValidEmail(adminToRaw) ? adminToRaw : "joulekyosr123@gmail.com";
    const from = (process.env.MAIL_FROM || "").trim() || `MTR <no-reply@mtr.tn>`;
    const cc = isValidEmail(uEmail) ? [uEmail] : undefined;

    const transport = makeTransport();

    await transport.sendMail({
      from,
      to: adminTo,
      cc,
      replyTo: uEmail || undefined,
      subject,
      text: textBody,
      html,
      attachments: devisAttachment ? [devisAttachment] : [],
    });

    return res.json({ success: true, message: "Commande confirmée" });
  } catch (err) {
    console.error("placeClientOrder error:", err);
    return res.status(500).json({ success: false, message: "Erreur envoi commande" });
  }
}

/** GET /api/order/client/status?ids=ID1,ID2,... => { map: { [demandeId]: boolean } } */
export async function getClientOrderStatus(req, res) {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ success: false, message: "Non authentifié" });

    const ids = String(req.query.ids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!ids.length) return res.json({ success: true, map: {} });

    const objIds = ids.map((s) => new mongoose.Types.ObjectId(s));
    const rows = await ClientOrder.find({
      user: userId,
      demandeId: { $in: objIds },
    })
      .select("demandeId status")
      .lean();

    const map = {};
    for (const id of ids) map[id] = false;
    for (const r of rows) map[String(r.demandeId)] = r.status === "confirmed";

    return res.json({ success: true, map });
  } catch (err) {
    console.error("getClientOrderStatus error:", err);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}
