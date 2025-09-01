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
      nature,
      attente,
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

        const html = `<h2>Nouvelle réclamation</h2>
<ul>
  <li><b>Numéro:</b> ${full.numero}</li>
  <li><b>Document:</b> ${full.commande?.typeDoc} ${full.commande?.numero}</li>
  <li><b>Nature:</b> ${full.nature}</li>
  <li><b>Attente:</b> ${full.attente}</li>
  <li><b>Description:</b> ${full.description || "-"}</li>
</ul>
<h3>Client</h3>
<ul>
  <li><b>Nom:</b> ${fullName}</li>
  <li><b>Email:</b> ${replyTo || "-"}</li>
  <li><b>Téléphone:</b> ${full.user?.numTel || "-"}</li>
  <li><b>Adresse:</b> ${full.user?.adresse || "-"}</li>
</ul>`;

        await transporter.sendMail({
          from: process.env.MAIL_FROM || process.env.SMTP_USER,
          to: toAdmin || replyTo, // si pas d'admin, envoie au client
          replyTo: replyTo || undefined,
          subject,
          text,
          html,
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


export const adminListReclamations = async (req, res) => {
  try {
    const items = await Reclamation.find({})
      .populate("user", "nom prenom email")
      .sort("-createdAt")
      // ⬇️ ajoute "numero" et (optionnel) "commande.numero" si tu veux aussi le n° du doc source
      .select(
        "numero user commande.typeDoc commande.numero nature attente description createdAt " +
        "piecesJointes.filename piecesJointes.mimetype " +
        "demandePdf pdf"
      )
      .lean();

    const mapped = items.map((r) => {
      const hasPdf =
        !!(r?.demandePdf && r.demandePdf.data) ||
        !!(r?.pdf && r.pdf.data);

      return {
        _id: r._id,
        client: r.user ? `${r.user.prenom || ""} ${r.user.nom || ""}`.trim() : "—",
        date: r.createdAt,
        numero: r.numero || "",                // ✅ maintenant il sera bien rempli (R25xxxxx)
        typeDoc: r.commande?.typeDoc || "",
        // Optionnel: si tu veux afficher aussi le n° du document source:
        // docNumero: r.commande?.numero || "",
        nature: r.nature,
        attente: r.attente,
        description: r.description || "",
        piecesJointes: (r.piecesJointes || []).map((p) => ({
          filename: p.filename,
          mimetype: p.mimetype,
        })),
        pdf: hasPdf,
      };
    });

    res.json({ success: true, data: mapped });
  } catch (err) {
    console.error("adminListReclamations error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};


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
