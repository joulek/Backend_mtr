// controllers/reclamation.controller.js
import Reclamation from "../models/reclamation.js"; // ⚠️ casse exacte
import Counter from "../models/Counter.js";
import { buildReclamationPDF } from "../utils/pdf.reclamation.js";
import { makeTransport } from "../utils/mailer.js";
import mongoose from "mongoose";

// petits helpers
const toDate = (v) => (v ? new Date(v) : undefined);
const toInt = (v) =>
  v === undefined || v === null || v === "" ? undefined : Number(v);

const isOther = (v) =>
  /^autre?s?$/i.test(String(v || "").trim()) || /^other$/i.test(String(v || "").trim());

const safe = (s = "") => {
  const v = String(s ?? "").trim();
  return v || "-";
};

// récupère la 1ère clé non vide parmi plusieurs alias envoyés par le front
function pickPreciseField(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return undefined;
}

// fallback: extraction depuis description "Précisez la nature: X | Précisez votre attente: Y"
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
    // 0) auth
    if (!req.user?.id) {
      return res
        .status(401)
        .json({ success: false, message: "Utilisateur non authentifié" });
    }

    // 1) parser body (multipart OU json)
    const isMultipart =
      !!req.files ||
      /multipart\/form-data/i.test(req.headers["content-type"] || "");
    let commande,
      nature,
      attente,
      description,
      piecesJointes = [];

    // on lira aussi ces champs si le front les envoie
    let precisezNature;
    let precisezAttente;

    if (isMultipart) {
      commande = {
        typeDoc: req.body["commande[typeDoc]"] || req.body?.commande?.typeDoc,
        numero: req.body["commande[numero]"] || req.body?.commande?.numero,
        dateLivraison: toDate(
          req.body["commande[dateLivraison]"] ||
            req.body?.commande?.dateLivraison
        ),
        referenceProduit:
          req.body["commande[referenceProduit]"] ||
          req.body?.commande?.referenceProduit,
        quantite: toInt(
          req.body["commande[quantite]"] || req.body?.commande?.quantite
        ),
      };
      nature = req.body.nature;
      attente = req.body.attente;
      description = req.body.description;

      // textes libres si présents
      precisezNature = pickPreciseField(req.body, [
        "precisezNature",
        "natureAutre",
        "natureTexte",
        "nature_precise",
        "preciseNature",
        "prcNature",
      ]);
      precisezAttente = pickPreciseField(req.body, [
        "precisezAttente",
        "attenteAutre",
        "attenteTexte",
        "attente_precise",
        "preciseAttente",
        "prcAttente",
      ]);

      // si Autre → remplacer par le texte libre
      if (isOther(nature)  && precisezNature)  nature  = precisezNature;
      if (isOther(attente) && precisezAttente) attente = precisezAttente;

      // fallback depuis description si nécessaire
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
        size: f.size,
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

      // textes libres si présents
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

    // 2) validations mini
    if (!commande?.typeDoc)
      return res
        .status(400)
        .json({ success: false, message: "commande.typeDoc est obligatoire" });
    if (!commande?.numero)
      return res
        .status(400)
        .json({ success: false, message: "commande.numero est obligatoire" });
    if (!nature)
      return res
        .status(400)
        .json({ success: false, message: "nature est obligatoire" });
    if (!attente)
      return res
        .status(400)
        .json({ success: false, message: "attente est obligatoire" });

    // hygiène upload
    const MAX_FILES = 10,
      MAX_PER_FILE = 5 * 1024 * 1024;
    if (piecesJointes.length > MAX_FILES)
      return res.status(400).json({
        success: false,
        message: `Trop de fichiers (max ${MAX_FILES}).`,
      });
    for (const p of piecesJointes) {
      if (p?.size && p.size > MAX_PER_FILE)
        return res
          .status(400)
          .json({ success: false, message: `"${p.filename}" dépasse 5 Mo.` });
    }

    // 3) Génération du numéro + sauvegarde
    const year = new Date().getFullYear();
    const yy = String(year).slice(-2);

    // Incrémente le compteur pour l'année courante (reset annuel automatique)
    const c = await Counter.findOneAndUpdate(
      { _id: `reclamation:${year}` },
      {
        $inc: { seq: 1 },
        $setOnInsert: { key: `reclamation-${yy}` }, // utile si tu exploits "key"
      },
      { upsert: true, new: true }
    ).lean();

    // Formate le numéro RYY##### (R25xxxxx)
    const numero = `R${yy}${String(c.seq).padStart(5, "0")}`;

    const rec = await Reclamation.create({
      numero, // ✅ auto-incrément
      user: req.user.id,
      commande,
      nature,      // ← peut être texte libre si Autre
      attente,     // ← idem
      description,
      piecesJointes,
    });

    // 4) Réponse immédiate
    res.status(201).json({ success: true, data: rec });

    // 5) Traitement async: PDF + email
    setImmediate(async () => {
      const toBuffer = (x) => {
        if (!x) return null;
        if (Buffer.isBuffer(x)) return x;
        if (x.buffer && Buffer.isBuffer(x.buffer)) return Buffer.from(x.buffer);
        try {
          return Buffer.from(x);
        } catch {
          return null;
        }
      };

      try {
        const full = await Reclamation.findById(rec._id)
          .populate("user", "nom prenom email numTel adresse")
          .lean();

        // PDF (Buffer)
        const pdfBuffer = await buildReclamationPDF(full);

        // Stocker le PDF en base
        await Reclamation.findByIdAndUpdate(
          rec._id,
          {
            $set: {
              demandePdf: {
                data: pdfBuffer,
                contentType: "application/pdf",
                generatedAt: new Date(),
              },
            },
          },
          { new: true }
        );

        // SMTP configuré ?
        if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
          console.warn("[MAIL] SMTP non configuré → envoi ignoré");
          return;
        }

        const attachments = [
          {
            filename: `reclamation-${full.numero}.pdf`, // ✅ cohérent avec numero
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ];

        // Joindre les PJ client (max 15Mo total)
        let total = pdfBuffer.length;
        for (const pj of full.piecesJointes || []) {
          const buf = toBuffer(pj?.data);
          if (!buf || buf.length === 0) continue;
          if (total + buf.length > 15 * 1024 * 1024) break;
          attachments.push({
            filename: pj.filename || "pj",
            content: buf,
            contentType: pj.mimetype || "application/octet-stream",
          });
          total += buf.length;
        }

        const transporter = makeTransport();
        const fullName =
          [full.user?.prenom, full.user?.nom].filter(Boolean).join(" ") ||
          "Client";
        const toAdmin = process.env.ADMIN_EMAIL;
        const replyTo = full.user?.email;

        const subject = `Réclamation ${full.numero} – ${fullName}`; // ✅ utilise numero

        // Texte brut (inchangé)
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
    <title>${subject}</title>
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

            <!-- Espace vertical -->
            <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>

            <!-- Carte contenu -->
            <tr>
              <td style="padding:0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                       style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;border-collapse:separate;box-sizing:border-box;">
                  <tr>
                    <td style="padding:24px;">

                      <p style="margin:0 0 12px 0;">Bonjour, Vous avez reçu une nouvelle réclamation&nbsp;:</p>

                      <ul style="margin:0 0 16px 20px;padding:0;">
                        <li><strong>Numéro&nbsp;:</strong> ${full.numero}</li>
                        <li><strong>Document&nbsp;:</strong> ${full.commande?.typeDoc || "-"} ${full.commande?.numero || ""}</li>
                        <li><strong>Nom&nbsp;:</strong> ${fullName}</li>
                        <li><strong>Email&nbsp;:</strong> ${replyTo || "-"}</li>
                        <li><strong>Téléphone&nbsp;:</strong> ${full.user?.numTel || "-"}</li>
                        <li><strong>Adresse&nbsp;:</strong> ${full.user?.adresse || "-"}</li>
                      </ul>


                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Espace vertical -->
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
          from: process.env.MAIL_FROM || process.env.SMTP_USER,
          to: toAdmin || replyTo, // si pas d'admin, envoie au client
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
    res
      .status(400)
      .json({ success: false, message: e.message || "Données invalides" });
  }
};

/** [ADMIN] Liste des réclamations (paginée, filtrée) */
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
          // client will be matched after populate (in-memory)
        ],
      });
    }

    const where = and.length ? { $and: and } : {};

    const [docs, total] = await Promise.all([
      Reclamation.find(where)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        // select everything *except* large buffers; keep generatedAt as a flag
        .select("-demandePdf.data -piecesJointes.data")
        .populate("user", "prenom nom email")
        .lean(),
      Reclamation.countDocuments(where),
    ]);

    // Optional: client-side filter on client name/email when q is present
    const filtered = !q
      ? docs
      : docs.filter((r) => {
          const clientStr = `${r?.user?.prenom || ""} ${r?.user?.nom || ""} ${r?.user?.email || ""}`.toLowerCase();
          return clientStr.includes(q.toLowerCase()) || true; // we already matched other fields in DB
        });

    // Map to the exact shape your frontend expects
    const items = filtered.map((r) => {
      const client = `${r?.user?.prenom || ""} ${r?.user?.nom || ""}`.trim() || r?.user?.email || "";
      return {
        _id: r._id,
        numero: r.numero,
        client,
        typeDoc: r?.commande?.typeDoc || r?.typeDoc || "",
        date: r.createdAt,
        // Boolean only: front shows “Aucun” when falsey
        pdf: Boolean(r?.demandePdf?.generatedAt),
        // expose only filename/mimetype (no data)
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

    res.setHeader("Content-Type", type);
    res.setHeader("Content-Disposition", `inline; filename="reclamation-${id}.pdf"`);
    return res.send(Buffer.from(bin.buffer || bin));
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

    res.setHeader("Content-Type", pj.mimetype || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${pj.filename || `piece-${i + 1}`}"`);
    return res.send(Buffer.from(pj.data.buffer || pj.data));
  } catch (e) {
    console.error("streamReclamationDocument:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};
