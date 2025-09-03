// utils/pdf.devisFilDresse.js
import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import fs from "fs";
import path from "path";

export function buildDevisFilDressePDF(devis = {}) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });

  /* ===== Stream buffer ===== */
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  /* ===== Style tokens (identiques aux autres) ===== */
  const PRIMARY = "#0B2A55";
  const LIGHT   = "#F5F7FB";
  const BORDER  = "#D5D9E4";
  const TXT     = "#111";

  const LEFT    = doc.page.margins.left;
  const RIGHT   = doc.page.width - doc.page.margins.right;
  const TOP     = doc.page.margins.top;
  const BOTTOM  = doc.page.height - doc.page.margins.bottom;
  const INNER_W = RIGHT - LEFT;

  /* ===== Helpers communs ===== */
  const safe = (v, dash = "—") =>
    v === null || v === undefined || String(v).trim() === "" ? dash : String(v).trim();
  const sanitize = (v) => safe(v).replace(/\s*\n+\s*/g, " ");
  const hasText  = (v) => v !== null && v !== undefined && String(v).trim() !== "";

  const get = (obj, paths = []) => {
    for (const p of paths) {
      const v = p.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), obj);
      if (v === undefined || v === null) continue;
      if (typeof v === "object") continue;
      const s = String(v).trim();
      if (s) return s;
    }
    return "";
  };

  const tryImage = (paths = []) => {
    for (const p of paths) {
      try {
        const abs = path.resolve(process.cwd(), p);
        if (fs.existsSync(abs)) return abs;
      } catch {}
    }
    return null;
  };

  const fitOneLine = ({ text, x, y, width, bold = false, maxSize = 10.5, minSize = 8 }) => {
    const fontName = bold ? "Helvetica-Bold" : "Helvetica";
    let size = maxSize;
    doc.font(fontName);
    while (size > minSize) {
      doc.fontSize(size);
      const w = doc.widthOfString(text);
      if (w <= width) break;
      size -= 0.5;
    }
    doc.fontSize(size).text(text, x, y, { width, lineBreak: false, align: "left" });
    return size;
  };

  let y = TOP;
  const rule = (yy, color = BORDER) =>
    doc.moveTo(LEFT, yy).lineTo(RIGHT, yy).strokeColor(color).lineWidth(1).stroke();
  const section = (label, yy, x = LEFT, w = INNER_W) => {
    const h = 22;
    doc.save().fillColor(PRIMARY).rect(x, yy, w, h).fill()
       .fillColor("#fff").font("Helvetica-Bold").fontSize(11)
       .text(label, x + 10, yy + 4, { width: w - 20, align: "left" }).restore();
    return yy + h;
  };
  const ensureSpace = (needed) => { if (y + needed > BOTTOM) { doc.addPage(); y = TOP; } };

  /* ===== Données ===== */
  const { _id, numero, createdAt, user = {}, spec = {}, exigences, remarques } = devis || {};

  const client = {
    nom: get(user, ["nom", "lastName", "name.last", "fullname"]),
    prenom: get(user, ["prenom", "firstName", "name.first"]),
    email: get(user, ["email"]),
    tel: get(user, ["numTel", "telephone", "phone", "tel"]),
    adresse: get(user, ["adresse", "address", "location.address"]),
  };



  /* ===== En-tête (avec logo) ===== */
  const logoPath = tryImage(["assets/logo_MTR.png"]);
  if (logoPath) {
    // ↑ Agrandi : largeur max 180, hauteur max 85 (ratio conservé)
    doc.image(logoPath, LEFT, y - 6, { fit: [180, 85] });
  }

  doc.fillColor(TXT).font("Helvetica-Bold").fontSize(17)
     .text("Demande de devis", LEFT, y + 4, { width: INNER_W, align: "center" });
  doc.font("Helvetica-Bold").fontSize(19)
     .text("Fil dressé", LEFT, y + 24, { width: INNER_W, align: "center" });

  const metaTop = y + 24 + doc.heightOfString("Fil dressé", { width: INNER_W }) + 6;
  const metaNum = numero ? `N° : ${numero}` : _id ? `ID : ${_id}` : "";
  doc.font("Helvetica").fontSize(10).fillColor(TXT)
     .text(metaNum, LEFT, metaTop, { width: INNER_W, align: "right" })
     .text(`Date : ${dayjs(createdAt || Date.now()).format("DD/MM/YYYY HH:mm")}`,
           LEFT, metaTop + 14, { width: INNER_W, align: "right" });

  rule(metaTop + 24);
  y = metaTop + 34;

  /* ===== Client ===== */
  y = section("Client", y);

  // Champs user supplémentaires
  const accountType = (get(user, ["accountType"]) || "").toLowerCase();
  const role        = get(user, ["role"]);

  const cin        = get(user, ["personal.cin"]);
  const postePers  = get(user, ["personal.posteActuel"]);

  const mf         = get(user, ["company.matriculeFiscal"]);
  const nomSociete = get(user, ["company.nomSociete"]);
  const posteSoc   = get(user, ["company.posteActuel"]);

  const accountLabel =
    accountType === "societe"   ? "Société"   :
    accountType === "personnel" ? "Personnel" : (accountType || "");

  // Liste dynamique (label, valeur)
  const clientPairs = [];
  const pushPair = (k, v) => { if (hasText(v)) clientPairs.push([k, sanitize(v)]); };

  // Identité + méta
  pushPair("Nom", [client.prenom, client.nom].filter(Boolean).join(" "));
  pushPair("Type de compte", accountLabel);
  pushPair("Rôle", role);

  // Entreprise (si présent)
  if (accountType === "societe" || hasText(nomSociete) || hasText(mf) || hasText(posteSoc)) {
    pushPair("Raison sociale", nomSociete);
    pushPair("Matricule fiscal", mf);
    pushPair("Poste (société)", posteSoc);
  }

  // Personnel (si présent)
  if (accountType === "personnel" || hasText(cin) || hasText(postePers)) {
    pushPair("CIN", cin);
    pushPair("Poste (personnel)", postePers);
  }

  // Contacts
  pushPair("Email", client.email);
  pushPair("Tél.", client.tel);
  pushPair("Adresse", client.adresse);

  const rowHClient = 18, labelW = 120; // libellés longs OK
  const clientBoxH = rowHClient * clientPairs.length + 8;
  ensureSpace(clientBoxH + 12);

  doc.rect(LEFT, y, INNER_W, clientBoxH).strokeColor(BORDER).stroke();

  let cy = y + 6;
  clientPairs.forEach(([k, v]) => {
    fitOneLine({ text: k, x: LEFT + 8, y: cy, width: labelW, bold: true, maxSize: 10, minSize: 8 });
    fitOneLine({ text: v, x: LEFT + 8 + labelW + 6, y: cy, width: INNER_W - (labelW + 26), maxSize: 10, minSize: 8 });
    cy += rowHClient;
  });
  y += clientBoxH + 14;

  /* ===== Schéma (optionnel) ===== */
  const dresserImg = tryImage(["assets/dresser.png", "/mnt/data/dresser.png"]);
  if (dresserImg) {
    y = section("Schéma", y);
    const IMG_H = 120, IMG_W = Math.min(INNER_W, 360);
    ensureSpace(IMG_H + 26);
    const x = LEFT + (INNER_W - IMG_W) / 2;
    doc.image(dresserImg, x, y + 8, { fit: [IMG_W, IMG_H], align: "center", valign: "center" });
    y += IMG_H + 18;
  }

  /* ===== Spécifications ===== */
  const longueur = `${sanitize(spec.longueurValeur)} ${safe(spec.longueurUnite, "").trim()}`.trim() || "—";
  const diametre = sanitize(spec.diametre);
  const quantite = `${sanitize(spec.quantiteValeur)} ${safe(spec.quantiteUnite, "").trim()}`.trim() || "—";
  const matiere  = sanitize(spec.matiere);

  const specRows = [
    ["Longueur", longueur, "Diamètre", diametre],
    ["Quantité", quantite, "Matière", matiere],
  ];
  const rowH = 28, halfW = Math.floor(INNER_W / 2), padX = 6;
  const labLW = 170, labRW = 185;
  const valLW = halfW - (labLW + padX * 3);
  const valRW = halfW - (labRW + padX * 3);
  const tableH = specRows.length * rowH;

  if (y + 22 + tableH + 10 > BOTTOM) { doc.addPage(); y = TOP; }
  y = section("Spécifications", y);

  const tableTop = y;
  doc.rect(LEFT, tableTop, INNER_W, tableH).strokeColor(BORDER).lineWidth(1).stroke();

  specRows.forEach((r, i) => {
    const yy = tableTop + i * rowH;
    if (i % 2 === 0) doc.save().fillColor(LIGHT).rect(LEFT, yy, INNER_W, rowH).fill().restore();
    doc.moveTo(LEFT, yy).lineTo(RIGHT, yy).strokeColor(BORDER).stroke();
    doc.moveTo(LEFT + halfW, yy).lineTo(LEFT + halfW, yy + rowH).strokeColor(BORDER).stroke();
    fitOneLine({ text: r[0], x: LEFT + padX, y: yy + 6, width: labLW, bold: true, maxSize: 10.5, minSize: 8 });
    fitOneLine({ text: sanitize(r[1]), x: LEFT + padX + labLW + padX, y: yy + 6, width: valLW, maxSize: 10.5, minSize: 7.5 });
    fitOneLine({ text: r[2], x: LEFT + halfW + padX, y: yy + 6, width: labRW, bold: true, maxSize: 10.5, minSize: 8 });
    fitOneLine({ text: sanitize(r[3]), x: LEFT + halfW + padX + labRW + padX, y: yy + 6, width: valRW, maxSize: 10.5, minSize: 7.5 });
  });

  doc.moveTo(LEFT, tableTop + tableH).lineTo(RIGHT, tableTop + tableH).strokeColor(BORDER).stroke();
  y = tableTop + tableH + 12;

  /* ===== Exigences & Autres remarques ===== */
  const blocks = [];
  if (hasText(exigences)) {
    const t = sanitize(exigences);
    const h = Math.max(56, doc.font("Helvetica").fontSize(10).heightOfString(t, { width: INNER_W - 20 }) + 14);
    blocks.push({ title: "Exigences particulières", text: t, h });
  }
  if (hasText(remarques)) {
    const t = sanitize(remarques);
    const h = Math.max(56, doc.font("Helvetica").fontSize(10).heightOfString(t, { width: INNER_W - 20 }) + 14);
    blocks.push({ title: "Autres remarques", text: t, h });
  }

  if (blocks.length) {
    const need = blocks.reduce((s, b) => s + 22 + b.h + 10, 0);
    if (y + need > BOTTOM) { doc.addPage(); y = TOP; }
    for (const b of blocks) {
      y = section(b.title, y);
      doc.save().fillColor("#fff").rect(LEFT, y, INNER_W, b.h).fill().restore();
      doc.rect(LEFT, y, INNER_W, b.h).strokeColor(BORDER).stroke();
      doc.font("Helvetica").fontSize(10).fillColor(TXT).text(b.text, LEFT + 10, y + 8, {
        width: INNER_W - 20,
      });
      y += b.h + 10;
    }
  }

  /* ===== Footer ===== */
  if (y + 48 > BOTTOM) { doc.addPage(); y = TOP; }
  rule(BOTTOM - 54);
  doc.font("Helvetica").fontSize(8).fillColor("#666")
     .text("Document généré automatiquement — MTR Industry", LEFT, BOTTOM - 46, {
       width: INNER_W, align: "center",
     });

  doc.end();
  return new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
}
