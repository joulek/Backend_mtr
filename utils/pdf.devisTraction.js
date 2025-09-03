// utils/pdf.devisTraction.js
import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import fs from "fs";
import path from "path";

/**
 * PDF "Ressorts de Traction"
 * - Logo en haut gauche
 * - Titre sur 2 lignes centré
 * - N° + Date à droite
 * - Sections : Client → Schéma (1/2/3 images) → Spécifications principales
 * - Exigences + Remarques : conditionnels, groupés
 * - Spécifications : labels/valeurs sur 1 ligne (font-size auto)
 * - Table jamais scindée : si elle ne tient pas, on la bascule en page suivante
 */
export function buildDevisTractionPDF(devis = {}) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });

  /* ===== Stream ===== */
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  /* ===== Styles & constantes ===== */
  const PRIMARY = "#0B2A55";
  const LIGHT   = "#F5F7FB";
  const BORDER  = "#D5D9E4";
  const TXT     = "#111";

  const LEFT    = doc.page.margins.left;
  const RIGHT   = doc.page.width - doc.page.margins.right;
  const TOP     = doc.page.margins.top;
  const BOTTOM  = doc.page.height - doc.page.margins.bottom;
  const INNER_W = RIGHT - LEFT;

  const SPRING_TYPE_LABEL = "Ressort de traction";

  /* ===== Helpers ===== */
  const safe = (v, dash = "—") =>
    v === null || v === undefined || String(v).trim() === "" ? dash : String(v).trim();

  const sanitize = (v) => safe(v).replace(/\s*\n+\s*/g, " "); // supprime les \n parasites
  const hasText = (v) => v !== null && v !== undefined && String(v).trim() !== "";

  const get = (obj, paths = []) => {
    for (const p of paths) {
      const v = p.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), obj);
      if (v === undefined || v === null) continue;
      if (typeof v === "object") continue; // évite [object Object]
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

  const rule = (yy = y, color = BORDER) => {
    doc.moveTo(LEFT, yy).lineTo(RIGHT, yy).strokeColor(color).lineWidth(1).stroke();
  };

  const section = (label, yy = y, x = LEFT, w = INNER_W) => {
    const h = 22;
    doc
      .save()
      .fillColor(PRIMARY)
      .rect(x, yy, w, h)
      .fill()
      .fillColor("#fff")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(label, x + 10, yy + 4, { width: w - 20, align: "left" })
      .restore();
    return yy + h;
  };

  const ensureSpace = (needed) => {
    if (y + needed > BOTTOM) {
      doc.addPage();
      y = TOP;
    }
  };

  /* ===== En-tête ===== */
  const logoPath = tryImage(["assets/logo_MTR.png"]);
  // ↑ Agrandi : largeur max 180, hauteur max 85 (ratio conservé)
  const logoW = 180, logoHMax = 85;
  if (logoPath) doc.image(logoPath, LEFT, y - 6, { fit: [logoW, logoHMax] });

  doc
    .fillColor(TXT)
    .font("Helvetica-Bold")
    .fontSize(17)
    .text("Demande de devis", LEFT, y + 4, { width: INNER_W, align: "center" });

  doc
    .font("Helvetica-Bold")
    .fontSize(19)
    .text("Ressorts de Traction", LEFT, y + 24, { width: INNER_W, align: "center" });

  const metaTop = y + 24 + doc.heightOfString("Ressorts de Traction", { width: INNER_W }) + 6;
  const numero = devis?.numero ? `N° : ${devis.numero}` : devis?._id ? `ID : ${devis._id}` : "";

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(TXT)
    .text(numero, LEFT, metaTop, { width: INNER_W, align: "right" })
    .text(
      `Date : ${dayjs(devis?.createdAt || Date.now()).format("DD/MM/YYYY HH:mm")}`,
      LEFT,
      metaTop + 14,
      { width: INNER_W, align: "right" }
    );

  rule(metaTop + 24);
  y = metaTop + 34;

  /* ===== 1) Client ===== */
  y = section("Client", y);

  const u = devis?.user || {};
  const client = {
    nom:     get(u, ["nom", "lastName", "name.last", "fullname"]),
    prenom:  get(u, ["prenom", "firstName", "name.first"]),
    email:   get(u, ["email"]),
    tel:     get(u, ["numTel", "telephone", "phone", "tel"]),
    adresse: get(u, ["adresse", "address", "location.address"]),
  };

  const accountType = (get(u, ["accountType"]) || "").toLowerCase();
  const role        = get(u, ["role"]);

  const cin        = get(u, ["personal.cin"]);
  const postePers  = get(u, ["personal.posteActuel"]);

  const mf         = get(u, ["company.matriculeFiscal"]);
  const nomSociete = get(u, ["company.nomSociete"]);
  const posteSoc   = get(u, ["company.posteActuel"]);

  const accountLabel =
    accountType === "societe"   ? "Société"   :
    accountType === "personnel" ? "Personnel" : (accountType || "");

  const clientPairs = [];
  const pushPair = (k, v) => { if (hasText(v)) clientPairs.push([k, sanitize(v)]); };

  // Nom complet (fallback si user est string/ObjectId)
  const nomComplet =
    [client.prenom, client.nom].filter(Boolean).join(" ") ||
    (typeof u === "string" ? String(u) : safe(u?._id));

  // Identité + méta
  pushPair("Nom", nomComplet);
  pushPair("Type de compte", accountLabel);
  pushPair("Rôle", role);

  // Société (si présent)
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

  /* ===== 2) Schéma (2 en haut + 1 centrée en bas si 3 images) ===== */
  const imgPaths = [
    tryImage(["assets/traction00.png", "/mnt/data/traction00.png"]),
    tryImage(["assets/traction01.png", "/mnt/data/traction01.png"]),
    tryImage(["assets/traction02.png", "/mnt/data/traction02.png"]),
  ].filter(Boolean);

  if (imgPaths.length) {
    y = section("Schéma", y);

    const GAP = 12;              // espace horizontal
    const H_TOP = 120;           // hauteur image rangée du haut
    const H_BOTTOM = 120;        // hauteur image rangée du bas (si 3 images)

    if (imgPaths.length === 1) {
      const w = Math.min(INNER_W, 380);
      ensureSpace(H_TOP + 26);
      const x = LEFT + (INNER_W - w) / 2;
      doc.image(imgPaths[0], x, y + 8, { fit: [w, H_TOP], align: "center", valign: "center" });
      y += H_TOP + 18;
    } else if (imgPaths.length === 2) {
      const colW = Math.floor((INNER_W - GAP) / 2);
      ensureSpace(H_TOP + 26);
      doc.image(imgPaths[0], LEFT, y + 8, { fit: [colW, H_TOP], align: "center", valign: "center" });
      doc.image(imgPaths[1], LEFT + colW + GAP, y + 8, { fit: [colW, H_TOP], align: "center", valign: "center" });
      y += H_TOP + 18;
    } else {
      // 3 images → 2 colonnes en haut + 1 centrée dessous
      const colW = Math.floor((INNER_W - GAP) / 2);
      const bottomW = Math.min(Math.floor(INNER_W * 0.55), 320);
      ensureSpace(H_TOP + H_BOTTOM + 36);

      // ligne du haut
      doc.image(imgPaths[0], LEFT, y + 8, { fit: [colW, H_TOP], align: "center", valign: "center" });
      doc.image(imgPaths[1], LEFT + colW + GAP, y + 8, { fit: [colW, H_TOP], align: "center", valign: "center" });

      // ligne du bas
      const bx = LEFT + (INNER_W - bottomW) / 2;
      doc.image(imgPaths[2], bx, y + 8 + H_TOP + 12, { fit: [bottomW, H_BOTTOM], align: "center", valign: "center" });

      y += H_TOP + H_BOTTOM + 18;
    }
  }

  /* ===== 3) Spécifications principales ===== */
  const s = devis?.spec || {};
  const rows = [
    ["Diamètre du fil (d)", sanitize(s.d), "Diamètre extérieur (De)", sanitize(s.De || s.DE)],
    ["Longueur libre (Lo)", sanitize(s.Lo), "Nombre total de spires", sanitize(s.nbSires || s.nbSpires)],
    ["Quantité", sanitize(s.quantite ?? devis?.quantite), "Matière", sanitize(s.matiere)],
    ["Sens d’enroulement", sanitize(s.enroulement), "Position des anneaux", sanitize(s.positionAnneaux)],
    ["Type d’accrochage", sanitize(s.typeAccrochage), "Type de ressort", SPRING_TYPE_LABEL],
  ];

  const rowH = 28;
  const halfW = Math.floor(INNER_W / 2);
  const padX = 6;
  const labLW = 170;
  const labRW = 185;
  const valLW = halfW - (labLW + padX * 3);
  const valRW = halfW - (labRW + padX * 3);

  const tableH = rowH * rows.length;

  if (y + 22 + tableH + 10 > BOTTOM) {
    doc.addPage();
    y = TOP;
  }

  y = section("Spécifications principales", y);

  const tableTop = y;
  doc.rect(LEFT, tableTop, INNER_W, tableH).strokeColor(BORDER).lineWidth(1).stroke();

  rows.forEach((r, i) => {
    const yy = tableTop + i * rowH;
    if (i % 2 === 0) doc.save().fillColor(LIGHT).rect(LEFT, yy, INNER_W, rowH).fill().restore();

    doc.moveTo(LEFT, yy).lineTo(RIGHT, yy).strokeColor(BORDER).stroke();
    doc.moveTo(LEFT + halfW, yy).lineTo(LEFT + halfW, yy + rowH).strokeColor(BORDER).stroke();

    fitOneLine({ text: r[0], x: LEFT + padX, y: yy + 6, width: labLW, bold: true, maxSize: 10.5, minSize: 8 });
    fitOneLine({ text: r[1], x: LEFT + padX + labLW + padX, y: yy + 6, width: valLW, maxSize: 10.5, minSize: 7.5 });

    fitOneLine({ text: r[2], x: LEFT + halfW + padX, y: yy + 6, width: labRW, bold: true, maxSize: 10.5, minSize: 8 });
    fitOneLine({ text: r[3], x: LEFT + halfW + padX + labRW + padX, y: yy + 6, width: valRW, maxSize: 10.5, minSize: 7.5 });
  });

  doc.moveTo(LEFT, tableTop + tableH).lineTo(RIGHT, tableTop + tableH).strokeColor(BORDER).stroke();
  y = tableTop + tableH + 12;

  /* ===== 4) Exigences + Remarques ===== */
  const blocks = [];
  if (hasText(devis?.exigences)) {
    const text = sanitize(devis.exigences);
    doc.font("Helvetica").fontSize(10);
    const h = Math.max(56, doc.heightOfString(text, { width: INNER_W - 20 }) + 14);
    blocks.push({ title: "Exigences particulières", text, h });
  }
  if (hasText(devis?.remarques)) {
    const text = sanitize(devis.remarques);
    doc.font("Helvetica").fontSize(10);
    const h = Math.max(56, doc.heightOfString(text, { width: INNER_W - 20 }) + 14);
    blocks.push({ title: "Autres remarques", text, h });
  }

  if (blocks.length) {
    const totalNeeded = blocks.reduce((sum, b) => sum + 22 + b.h + 10, 0);
    ensureSpace(totalNeeded);
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

  /* ===== Pied ===== */
  if (y + 48 > BOTTOM) {
    doc.addPage();
    y = TOP;
  }
  rule(BOTTOM - 54);
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#666")
    .text("Document généré automatiquement — MTR Industry", LEFT, BOTTOM - 46, {
      width: INNER_W,
      align: "center",
    });

  doc.end();
  return new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
}
