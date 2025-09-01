// utils/pdf.reclamation.js
import PDFDocument from "pdfkit";
import path from "path";
import dayjs from "dayjs";

export async function buildReclamationPDF(rec) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      /* ---------------- Styles & Layout ---------------- */
      const NAVY   = "#003366";
      const LIGHT  = "#F3F3F8";
      const BORDER = "#C8C8D8";

      const PAGE_LEFT  = 40;
      const TABLE_W    = 515; // largeur utile
      const PAGE_RIGHT = PAGE_LEFT + TABLE_W;

      const CARD_SPACE_Y = 28; // espace vertical entre les cartes

      const safe = (s = "") => String(s || "—");
      const dateStr = dayjs(rec?.createdAt || Date.now()).format("DD/MM/YYYY HH:mm:ss");

      const u = rec?.user || {};
      const c = rec?.commande || {};

      const drawSectionTitle = (label, x, y, w) => {
        doc.save()
          .fillColor(NAVY)
          .rect(x, y, w, 20)
          .fill()
          .fillColor("#FFFFFF")
          .font("Helvetica-Bold").fontSize(11)
          .text(label, x + 10, y + 4, { width: w - 20, align: "left" })
          .restore();
        return y + 20;
      };

      const drawKeyValue = (pairs, x, y, w, lineH = 18, labelW = 95) => {
        doc.fontSize(10).fillColor("#000");
        pairs.forEach(([label, value]) => {
          doc.font("Helvetica-Bold").text(label, x, y, { width: labelW, align: "left" });
          doc.font("Helvetica").text(value, x + labelW, y, { width: w - labelW, align: "left" });
          y += lineH;
        });
        return y;
      };

      /* ---------------- En-tête ---------------- */
      const topY = PAGE_LEFT;

      // Logo
      try {
        const logoPath = path.resolve(process.cwd(), "assets/logo.png");
        doc.image(logoPath, PAGE_LEFT, topY - 10, { width: 90, height: 90, fit: [90, 90] });
      } catch {}

      // Titre centré
      doc.font("Helvetica-Bold").fontSize(18).fillColor("#000")
        .text("Réclamation client", 0, topY + 6, { align: "center" });

      // Réf & Date
      const metaX = PAGE_RIGHT - 220;
      const metaY = topY + 42;
      doc.font("Helvetica").fontSize(10).fillColor("#000")
        .text("Réf :", metaX, metaY)
        .font("Helvetica-Bold").text(safe(rec?.numero), metaX + 30, metaY)
        .font("Helvetica").text("Date :", metaX, metaY + 16)
        .font("Helvetica-Bold").text(dateStr, metaX + 30, metaY + 16);

      /* ---------------- Client (PLEINE LARGEUR) ---------------- */
      const blockTop = topY + 90;

      const CLIENT_H = 120; // tu peux augmenter si besoin
      let nextY = drawSectionTitle("Client", PAGE_LEFT, blockTop, TABLE_W);
      const clientRectY = nextY;
      doc.rect(PAGE_LEFT, clientRectY, TABLE_W, CLIENT_H).strokeColor(BORDER).stroke();
      drawKeyValue(
        [
          ["Nom", `${safe(u.prenom)} ${safe(u.nom)}`.trim()],
          ["Email", safe(u.email)],
          ["Tél", safe(u.numTel)],
          ["Adresse", safe(u.adresse)],
        ],
        PAGE_LEFT + 10,
        clientRectY + 8,
        TABLE_W - 20
      );

      /* ---------------- Commande (PLEINE LARGEUR, SOUS CLIENT) ---------------- */
      const CMD_H = 140;
      nextY = clientRectY + CLIENT_H + CARD_SPACE_Y;

      const cmdTitleBottom = drawSectionTitle("Commande", PAGE_LEFT, nextY, TABLE_W);
      const cmdRectY = cmdTitleBottom;
      doc.rect(PAGE_LEFT, cmdRectY, TABLE_W, CMD_H).strokeColor(BORDER).stroke();
      drawKeyValue(
        [
          ["Type doc",  safe(c.typeDoc)],
          ["Numéro",    safe(c.numero)],
          ["Date livr.", c.dateLivraison ? dayjs(c.dateLivraison).format("DD/MM/YYYY") : "—"],
          ["Réf prod.", safe(c.referenceProduit)],
          ["Quantité",  String(c.quantite ?? "—")],
        ],
        PAGE_LEFT + 10,
        cmdRectY + 8,
        TABLE_W - 20
      );

      // Position après les deux blocs verticaux
      const afterBlocksY = cmdRectY + CMD_H + CARD_SPACE_Y;

      /* ---------------- Réclamation ---------------- */
      let ry = drawSectionTitle("Réclamation", PAGE_LEFT, afterBlocksY, TABLE_W);
      doc.save().rect(PAGE_LEFT, ry, TABLE_W, 56).fill(LIGHT).restore();
      doc.rect(PAGE_LEFT, ry, TABLE_W, 56).strokeColor(BORDER).stroke();
      ry = drawKeyValue(
        [
          ["Nature",  safe(rec?.nature)],
          ["Attente", safe(rec?.attente)],
        ],
        PAGE_LEFT + 10,
        ry + 8,
        TABLE_W - 20
      );

      /* ---------------- Description (optionnelle) ---------------- */
      if (rec?.description) {
        let dy = drawSectionTitle("Description", PAGE_LEFT, ry + CARD_SPACE_Y, TABLE_W);
        const textH = doc.heightOfString(String(rec.description), { width: TABLE_W - 20 });
        const boxH = Math.max(60, textH + 16);
        doc.save().rect(PAGE_LEFT, dy, TABLE_W, boxH).fill("#FFFFFF").restore();
        doc.rect(PAGE_LEFT, dy, TABLE_W, boxH).strokeColor(BORDER).stroke();
        doc.font("Helvetica").fontSize(10).fillColor("#000")
          .text(String(rec.description), PAGE_LEFT + 10, dy + 8, {
            width: TABLE_W - 20,
            align: "left",
          });
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
