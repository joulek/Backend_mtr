// controllers/reclamation.controller.js
import Reclamation from "../models/reclamation.js";
import Counter from "../models/Counter.js";
import { buildReclamationPDF } from "../utils/pdf.reclamation.js";
import { makeTransport } from "../utils/mailer.js";
import mongoose from "mongoose";

// helpers
const toDate = (v) => (v ? new Date(v) : undefined);
const toInt = (v) =>
  v === undefined || v === null || v === "" ? undefined : Number(v);

const isOther = (v) =>
  /^autre?s?$/i.test(String(v || "").trim()) || /^other$/i.test(String(v || "").trim());

function pickPreciseField(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return undefined;
}

// fallback extraction from description
function extractFromDescription(desc = "") {
  const s = String(desc || "");
  const mNature  = s.match(/Précisez\s+la\s+nature\s*:\s*([^|]+?)(?:\||$)/i);
  const mAttente = s.match(/Précisez\s+votre\s+attente\s*:\s*([^|]+?)(?:\||$)/i);
  return {
    natureTxt:  mNature  ? mNature[1].trim()  : undefined,
    attenteTxt: mAttente ? mAttente[1].trim() : undefined,
  };
}

export const createReclamation = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Utilisateur non authentifié" });
    }

    // Parse body (multipart OR json)
    const isMultipart =
      !!req.files || /multipart\/form-data/i.test(req.headers["content-type"] || "");

    let commande, nature, attente, description, piecesJointes = [];
    let precisezNature, precisezAttente;

    if (isMultipart) {
      // Flask-style keys or nested object supported
      commande = {
        typeDoc: req.body["commande[typeDoc]"] || req.body?.commande?.typeDoc,
        numero: req.body["commande[numero]"] || req.body?.commande?.numero,
        dateLivraison: toDate(req.body["commande[dateLivraison]"] || req.body?.commande?.dateLivraison),
        referenceProduit: req.body["commande[referenceProduit]"] || req.body?.commande?.referenceProduit,
        quantite: toInt(req.body["commande[quantite]"] || req.body?.commande?.quantite),
      };
      nature = req.body.nature;
      attente = req.body.attente;
      description = req.body.description;

      precisezNature = pickPreciseField(req.body, [
        "precisezNature","natureAutre","natureTexte","nature_precise","preciseNature","prcNature"
      ]);
      precisezAttente = pickPreciseField(req.body, [
        "precisezAttente","attenteAutre","attenteTexte","attente_precise","preciseAttente","prcAttente"
      ]);

      if (isOther(nature)  && precisezNature)  nature  = precisezNature;
      if (isOther(attente) && precisezAttente) attente = precisezAttente;

      if (isOther(nature) || isOther(attente)) {
        const { natureTxt, attenteTxt } = extractFromDescription(description);
        if (isOther(nature)  && !precisezNature  && natureTxt)  nature  = natureTxt;
        if (isOther(attente) && !precisezAttente && attenteTxt) attente = attenteTxt;
      }

      const files = Array.isArray(req.files) ? req.files : [];
      piecesJointes = files.map((f) => ({
        filename: f.originalname,
        mimetype: f.mimetype,
        data: f.buffer,
        size: f.size, // للفلترة قبل الحفظ فقط
      }));
    } else {
      const b = req.body || {};
      commande = {
        typeDoc: b?.commande?.typeDoc,
        numero: b?.commande?.numero,
        dateLivraison: toDate(b?.commande?.dateLivraison),
        referenceProduit: b?.commande?.referenceProduit,
        quantite: toInt(b?.commande?.quantite),
      };
      nature = b.nature;
      attente = b.attente;
      description = b.description;

      precisezNature  = pickPreciseField(b, ["precisezNature","natureAutre","natureTexte","nature_precise"]);
      precisezAttente = pickPreciseField(b, ["precisezAttente","attenteAutre","attenteTexte","attente_precise"]);

      if (isOther(nature)  && precisezNature)  nature  = precisezNature;
      if (isOther(attente) && precisezAttente) attente = precisezAttente;

      if (isOther(nature) || isOther(attente)) {
        const { natureTxt, attenteTxt } = extractFromDescription(description);
        if (isOther(nature)  && !precisezNature  && natureTxt)  nature  = natureTxt;
        if (isOther(attente) && !precisezAttente && attenteTxt) attente = attenteTxt;
      }

      if (Array.isArray(b.piecesJointes)) {
        piecesJointes = b.piecesJointes.map((p) =>
          p?.data && typeof p.data === "string"
            ? {
                filename: p.filename,
                mimetype: p.mimetype || "application/octet-stream",
                data: Buffer.from(p.data, "base64"),
              }
            : p
        );
      }
    }

    // validations
    if (!commande?.typeDoc)
      return res.status(400).json({ success: false, message: "commande.typeDoc est obligatoire" });
    if (!commande?.numero)
      return res.status(400).json({ success: false, message: "commande.numero est obligatoire" });
    if (!nature)  return res.status(400).json({ success: false, message: "nature est obligatoire" });
    if (!attente) return res.status(400).json({ success: false, message: "attente est obligatoire" });

    const MAX_FILES = 10, MAX_PER_FILE = 5 * 1024 * 1024;
    if (piecesJointes.length > MAX_FILES)
      return res.status(400).json({ success: false, message: `Trop de fichiers (max ${MAX_FILES}).` });
    for (const p of piecesJointes) {
      if (p?.size && p.size > MAX_PER_FILE)
        return res.status(400).json({ success: false, message: `"${p.filename}" dépasse 5 Mo.` });
    }

    // Numéro: RYY#####
    const year = new Date().getFullYear();
    const yy = String(year).slice(-2);
    const c = await Counter.findOneAndUpdate(
      { _id: `reclamation:${year}` },
      { $inc: { seq: 1 }, $setOnInsert: { key: `reclamation-${yy}` } },
      { upsert: true, new: true }
    ).lean();
    const numero = `R${yy}${String(c.seq).padStart(5, "0")}`;

    const rec = await Reclamation.create({
      numero,
      user: req.user.id,
      commande,
      nature,
      attente,
      description,
      piecesJointes,
    });

    // UI response
    res.status(201).json({ success: true, data: rec });

    // Async: PDF + email
    setImmediate(async () => {
      const toBuffer = (x) => {
        if (!x) return null;
        if (Buffer.isBuffer(x)) return x;
        if (x.buffer && Buffer.isBuffer(x.buffer)) return Buffer.from(x.buffer);
        try { return Buffer.from(x); } catch { return null; }
      };

      try {
        const full = await Reclamation.findById(rec._id)
          .populate("user", "nom prenom email numTel adresse")
          .lean();

        const pdfBuffer = await buildReclamationPDF(full);

        await Reclamation.findByIdAndUpdate(
          rec._id,
          { $set: { demandePdf: { data: pdfBuffer, contentType: "application/pdf", generatedAt: new Date() } } },
          { new: true }
        );

        if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
          console.warn("[MAIL] SMTP non configuré → envoi ignoré");
          return;
        }

        const attachments = [
          { filename: `reclamation-${full.numero}.pdf`, content: pdfBuffer, contentType: "application/pdf" },
        ];
        let total = pdfBuffer.length;
        for (const pj of full.piecesJointes || []) {
          const buf = toBuffer(pj?.data);
          if (!buf || buf.length === 0) continue;
          if (total + buf.length > 15 * 1024 * 1024) break;
          attachments.push({ filename: pj.filename || "pj", content: buf, contentType: pj.mimetype || "application/octet-stream" });
          total += buf.length;
        }

        const transporter = makeTransport();
        const fullName = [full.user?.prenom, full.user?.nom].filter(Boolean).join(" ") || "Client";
        const toAdmin = process.env.ADMIN_EMAIL;
        const replyTo = full.user?.email;
        const subject = `Réclamation ${full.numero} – ${fullName}`;

        const text = `Nouvelle réclamation

Numéro : ${full.numero}
Document: ${full.commande?.typeDoc} ${full.commande?.numero}
Nature  : ${full.nature}
Attente : ${full.attente}
Desc.   : ${full.description || "-"}

Client  : ${fullName}
Email   : ${replyTo || "-"}
Téléphone: ${full.user?.numTel || "-"}
Adresse : ${full.user?.adresse || "-"}`;

        // HTML mail
        const BAND_DARK = "#0B2239";
        const BAND_TEXT = "#FFFFFF";
        const PAGE_BG   = "#F5F7FB";
        const CONTAINER_W = 680;

        const htmlBody = `<!doctype html>
<html>
  <head><meta charSet="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
  <body style="margin:0;background:${PAGE_BG};font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${PAGE_BG};margin:0;padding:24px 16px;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:${CONTAINER_W}px;max-width:100%;">
          <tr><td>
            <table role="presentation" width="100%"><tr>
              <td style="background:${BAND_DARK};color:${BAND_TEXT};text-align:center;padding:14px 20px;font-weight:800;border-radius:8px;">MTR – Manufacture Tunisienne des ressorts</td>
            </tr></table>
          </td></tr>
          <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>
          <tr><td>
            <table role="presentation" width="100%" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
              <tr><td style="padding:24px;">
                <p style="margin:0 0 12px 0;">Bonjour, Vous avez reçu une nouvelle réclamation :</p>
                <ul style="margin:0 0 16px 20px;padding:0;">
                  <li><strong>Numéro :</strong> ${full.numero}</li>
                  <li><strong>Document :</strong> ${full.commande?.typeDoc || "-"} ${full.commande?.numero || ""}</li>
                  <li><strong>Nom :</strong> ${fullName}</li>
                  <li><strong>Email :</strong> ${replyTo || "-"}</li>
                  <li><strong>Téléphone :</strong> ${full.user?.numTel || "-"}</li>
                  <li><strong>Adresse :</strong> ${full.user?.adresse || "-"}</li>
                </ul>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>
          <tr><td>
            <table role="presentation" width="100%"><tr>
              <td style="background:${BAND_DARK};color:${BAND_TEXT};text-align:center;padding:14px 20px;font-weight:800;border-radius:8px;">&nbsp;</td>
            </tr></table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

        await transporter.sendMail({
          from: process.env.MAIL_FROM || process.env.SMTP_USER,
          to: toAdmin || replyTo,
          replyTo: replyTo || undefined,
          subject,
          text,
          html: htmlBody,
          attachments,
        });
        console.log("✅ Mail réclamation envoyé");
      } catch (err) {
        console.error("❌ Post-send PDF/email failed:", err);
      }
    });
  } catch (e) {
    console.error("createReclamation:", e);
    res.status(400).json({ success: false, message: e.message || "Données invalides" });
  }
};

// [ADMIN] paginated list
export async function adminListReclamations(req, res) {
  try {
    const page     = Math.max(parseInt(req.query.page || "1", 10), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || "10", 10), 1), 100);

    const q = (req.query.q || "").trim();
    const and = [];

    if (q) {
      const rx = new RegExp(q.replace(/\s+/g, ".*"), "i");
      and.push({
        $or: [
          { numero: rx },
          { "commande.typeDoc": rx },
          { "commande.numero": rx },
          { nature: rx },
          { attente: rx },
          { "piecesJointes.filename": rx },
        ],
      });
    }

    const where = and.length ? { $and: and } : {};

    const [docs, total] = await Promise.all([
      Reclamation.find(where)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .select("-demandePdf.data -piecesJointes.data")
        .populate("user", "prenom nom email")
        .lean(),
      Reclamation.countDocuments(where),
    ]);

    const items = docs.map((r) => {
      const client = `${r?.user?.prenom || ""} ${r?.user?.nom || ""}`.trim() || r?.user?.email || "";
      return {
        _id: r._id,
        numero: r.numero,
        client,
        typeDoc: r?.commande?.typeDoc || r?.typeDoc || "",
        date: r.createdAt,
        pdf: Boolean(r?.demandePdf?.generatedAt),
        piecesJointes: Array.isArray(r.piecesJointes)
          ? r.piecesJointes.map((p) => ({ filename: p?.filename, mimetype: p?.mimetype }))
          : [],
      };
    });

    res.json({ success: true, data: items, total, page, pageSize });
  } catch (err) {
    console.error("adminListReclamations:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}

// --- STREAM PDF (admin) ---
export const streamReclamationPdf = async (req, res) => {
  try {
    const { id } = req.params;
    const r = await Reclamation.findById(id).select("demandePdf pdf").lean();

    const bin = r?.demandePdf?.data || r?.pdf?.data;
    const type = r?.demandePdf?.contentType || r?.pdf?.contentType || "application/pdf";
    if (!bin) return res.status(404).json({ success: false, message: "PDF introuvable" });

    const buf = Buffer.isBuffer(bin) ? bin : Buffer.from(bin.buffer);
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Content-Disposition", `inline; filename="reclamation-${id}.pdf"`);
    return res.end(buf);
  } catch (e) {
    console.error("streamReclamationPdf:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};

export const streamReclamationDocument = async (req, res) => {
  try {
    const { id, index } = req.params;
    const r = await Reclamation.findById(id).select("piecesJointes").lean();
    const i = Number(index);
    const pj = r?.piecesJointes?.[i];
    if (!pj?.data) return res.status(404).json({ success: false, message: "Pièce jointe introuvable" });

    const bin = pj.data;
    const buf = Buffer.isBuffer(bin) ? bin : Buffer.from(bin.buffer);
    const name = String(pj.filename || `piece-${i + 1}`).replace(/"/g, "");
    res.setHeader("Content-Type", pj.mimetype || "application/octet-stream");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    return res.end(buf);
  } catch (e) {
    console.error("streamReclamationDocument:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};
