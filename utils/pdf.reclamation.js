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

      const NAVY="#003366", LIGHT="#F3F3F8", BORDER="#C8C8D8";
      const PAGE_LEFT=40, TABLE_W=515, PAGE_RIGHT=PAGE_LEFT+TABLE_W;
      const CARD_SPACE_Y=28;

      const safe = (s="") => {
        const v = String(s ?? "").trim();
        return v || "—";
      };
      const dateStr = dayjs(rec?.createdAt || Date.now()).format("DD/MM/YYYY HH:mm:ss");

      const u = rec?.user || {};
      const c = rec?.commande || {};

      const drawSectionTitle = (label, x, y, w) => {
        doc.save().fillColor(NAVY).rect(x,y,w,20).fill()
           .fillColor("#FFF").font("Helvetica-Bold").fontSize(11)
           .text(label, x+10, y+4, { width: w-20, align: "left" }).restore();
        return y+20;
      };

      const drawKeyValue = (pairs, x, y, w, lineH=18, labelW=95) => {
        doc.fontSize(10).fillColor("#000");
        pairs.forEach(([label, value]) => {
          doc.font("Helvetica-Bold").text(label, x, y, { width: labelW, align: "left" });
          doc.font("Helvetica").text(value, x+labelW, y, { width: w-labelW, align: "left" });
          y += lineH;
        });
        return y;
      };

      const topY = PAGE_LEFT;

      try {
        const logoPath = path.resolve(process.cwd(), "assets/logo_MTR.png");
        doc.image(logoPath, PAGE_LEFT, topY - 10, { width: 90, height: 90, fit: [90,90] });
      } catch {}

      doc.font("Helvetica-Bold").fontSize(18).fillColor("#000")
        .text("Réclamation client", 0, topY + 6, { align: "center" });

      const metaX = PAGE_RIGHT - 220, metaY = topY + 42;
      doc.font("Helvetica").fontSize(10).fillColor("#000")
        .text("Réf :", metaX, metaY)
        .font("Helvetica-Bold").text(safe(rec?.numero), metaX + 30, metaY)
        .font("Helvetica").text("Date :", metaX, metaY + 16)
        .font("Helvetica-Bold").text(dateStr, metaX + 30, metaY + 16);

      const blockTop = topY + 90;

      const CLIENT_H = 120;
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

      const afterBlocksY = cmdRectY + CMD_H + CARD_SPACE_Y;

      // ————— Réclamation —————
      let ry = drawSectionTitle("Réclamation", PAGE_LEFT, afterBlocksY, TABLE_W);
      doc.save().rect(PAGE_LEFT, ry, TABLE_W, 56).fill(LIGHT).restore();
      doc.rect(PAGE_LEFT, ry, TABLE_W, 56).strokeColor(BORDER).stroke();
      ry = drawKeyValue(
        [
          ["Nature",  safe(rec?.nature)],   // ← directement el champ
          ["Attente", safe(rec?.attente)],  // ← directement el champ
        ],
        PAGE_LEFT + 10,
        ry + 8,
        TABLE_W - 20
      );

      // ma fama ch "Description" section taw

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
