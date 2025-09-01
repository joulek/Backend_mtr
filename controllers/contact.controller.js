import { makeTransport } from "../utils/mailer.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sanitize = (s="") => String(s).replace(/\r?\n/g, " ").trim();

export async function contactSend(req, res) {
  try {
    const b = req.body || {};
    const nom = sanitize(b.nom ?? b.name ?? "");
    const email = sanitize(b.email ?? "");
    const sujet = sanitize(b.sujet ?? b.subject ?? "Message via formulaire");
    const message = (b.message ?? "").toString().trim();

    if (!nom || !email || !message) {
      return res.status(400).json({ success:false, message:"Champs manquants (nom, email, message)." });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success:false, message:"Adresse e-mail invalide." });
    }

    const admin = process.env.ADMIN_EMAIL; // ton adresse vérifiée (domaine authentifié)

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

    const transport = makeTransport();
    await transport.sendMail({
      from: email,         // ⬅️ reste ton domaine
      to: admin,           // tu reçois le mail
      replyTo: email,      // ⬅️ répondre ⇢ client
      subject: `Contact – ${sujet}`,
      text: lines.join("\n"),
      // (optionnel) jolie version HTML
      html: `
        <p><strong>Nouveau message du site</strong></p>
        <p><strong>Nom:</strong> ${nom}<br/>
        <strong>Email:</strong> ${email}<br/>
        <strong>Sujet:</strong> ${sujet}</p>
        <p style="white-space:pre-wrap">${message.replace(/</g,"&lt;")}</p>
      `,
    });

    return res.json({ success:true, message:"Message envoyé. Merci !" });
  } catch (err) {
    console.error("contactSend error:", err);
    return res.status(500).json({ success:false, message:"Erreur lors de l’envoi. Réessayez plus tard." });
  }
}
