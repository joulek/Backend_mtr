// controllers/contact.controller.js
import { makeTransport } from "../utils/mailer.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sanitize = (s = "") => String(s).replace(/\r?\n/g, " ").trim();
const escapeHtml = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export async function contactSend(req, res) {
  try {
    const b = req.body || {};
    const nom = sanitize(b.nom ?? b.name ?? "");
    const email = sanitize(b.email ?? "");
    const sujet = sanitize(b.sujet ?? b.subject ?? "Message via formulaire");
    const message = (b.message ?? "").toString().trim();

    if (!nom || !email || !message) {
      return res
        .status(400)
        .json({ success: false, message: "Champs manquants (nom, email, message)." });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, message: "Adresse e-mail invalide." });
    }

    const admin = (process.env.ADMIN_EMAIL || "").trim();
    if (!admin) {
      return res.status(500).json({ success: false, message: "ADMIN_EMAIL non configuré." });
    }

    // Plain-text fallback
    const lines = [
      "Nouveau message du site :",
      "",
      `Nom    : ${nom}`,
      `Email  : ${email}`,
      `Sujet  : ${sujet}`,
      "",
      "Message :",
      message,
    ];

    // Design commun (mêmes couleurs/bandes que tes autres e-mails)
    const BRAND_PRIMARY = "#002147";
    const BAND_DARK = "#0B2239";
    const BAND_TEXT = "#FFFFFF";
    const PAGE_BG = "#F5F7FB";
    const CONTAINER_W = 680;

    const subject = `Contact – ${sujet}`;
    const safeMsg = escapeHtml(message).replace(/\r?\n/g, "<br>");

    const html = `<!doctype html>
<html>
  <head>
    <meta charSet="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;background:${PAGE_BG};font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Apple Color Emoji','Segoe UI Emoji';color:#111827;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;background:${PAGE_BG};margin:0;padding:24px 16px;border-collapse:collapse;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;">
      <tr>
        <td align="center" style="padding:0;margin:0;">

          <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                 style="width:${CONTAINER_W}px;max-width:100%;border-collapse:collapse;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;">

            <!-- Bande TOP -->
            <tr>
              <td style="padding:0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border-spacing:0;">
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

            <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>

            <!-- Carte contenu -->
            <tr>
              <td style="padding:0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                       style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;
                              border-collapse:separate;box-sizing:border-box;">
                  <tr>
                    <td style="padding:24px;">
                      <h1 style="margin:0 0 12px 0;font-size:18px;line-height:1.35;color:${BRAND_PRIMARY};">
                        Nouveau message du site
                      </h1>

                      <ul style="margin:0 0 16px 20px;padding:0;">
                        <li><strong>Nom&nbsp;:</strong> ${escapeHtml(nom)}</li>
                        <li><strong>Email&nbsp;:</strong> <a href="mailto:${escapeHtml(email)}" style="color:${BRAND_PRIMARY};text-decoration:underline;">${escapeHtml(email)}</a></li>
                        <li><strong>Objet&nbsp;:</strong> ${escapeHtml(sujet)}</li>
                      </ul>

                      <h2 style="margin:16px 0 8px 0;font-size:16px;color:#111827;">Message</h2>
                      <div style="margin:0;border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#fafafa;line-height:1.5;">
                        ${safeMsg}
                      </div>

                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>

            <!-- Bande BOTTOM (même largeur, même si vide) -->
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

    const transport = makeTransport();
    await transport.sendMail({
      // meilleur pour l’auth: From = ton domaine; Reply-To = expéditeur
      from: process.env.MAIL_FROM || "no-reply@mtr.tn",
      to: admin,
      replyTo: email,
      subject,
      text: lines.join("\n"),
      html,
    });

    return res.json({ success: true, message: "Message envoyé. Merci !" });
  } catch (err) {
    console.error("contactSend error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Erreur lors de l’envoi. Réessayez plus tard." });
  }
}
