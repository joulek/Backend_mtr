import Devis from "../models/Devis.js";

const ORIGIN = process.env.PUBLIC_BACKEND_URL || `http://localhost:${process.env.PORT }`;

/**
 * GET /api/admin/devis/compact?type=all|compression|traction|torsion|fil|grille|autre&q=...&page=1&limit=20
 * يرجّع صفوف جاهزة للقائمة (devisNumero, demandeNumeros, types, client, date, pdf)
 */
export async function listDevisCompact(req, res) {
  try {
    const page  = Math.max(1, parseInt(req.query.page ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? "20", 10)));
    const skip  = (page - 1) * limit;
    const type  = (req.query.type || "all").toString().toLowerCase();
    const q     = (req.query.q || "").toString().trim();

    // مطابقة (match) باستعمال الفهارس اللي فوق
    const match = {};
    if (type && type !== "all") {
      match["meta.demandes.type"] = type; // انت تخزّن type داخل linkSchema
    }
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      match.$or = [
        { numero: rx },
        { "meta.demandes.numero": rx },
        { demandeNumero: rx },
        { "meta.demandeNumero": rx },
        { "client.nom": rx },
      ];
    }

    const pipeline = [
      { $match: match },
      // حضّر أرقام الـ demandes و الأنواع من meta + الحقل القديم
      {
        $project: {
          numero: 1,
          createdAt: 1,
          clientNom: "$client.nom",
          devisPdf: { $concat: [ORIGIN, "/files/devis/", "$numero", ".pdf"] },
          allDemNums: {
            $setUnion: [
              { $ifNull: ["$meta.demandes.numero", []] }, // إذا كانت map objects، نعمل خطوة أخرى
              [
                { $ifNull: ["$demandeNumero", null] },
                { $ifNull: ["$meta.demandeNumero", null] }
              ]
            ]
          },
          allTypes: {
            $setUnion: [
              { $ifNull: ["$meta.demandes.type", []] },
              [{ $ifNull: ["$typeDemande", null] }]
            ]
          }
        }
      },
      {
        $project: {
          numero: 1,
          createdAt: 1,
          clientNom: 1,
          devisPdf: 1,
          demandeNumeros: {
            $setDifference: [
              { $filter: { input: "$allDemNums", as: "n", cond: { $and: [ { $ne: ["$$n", null] }, { $ne: ["$$n", ""] } ] } } },
              [null, ""]
            ]
          },
          types: {
            $setDifference: [
              { $filter: { input: "$allTypes", as: "t", cond: { $and: [ { $ne: ["$$t", null] }, { $ne: ["$$t", ""] } ] } } },
              [null, ""]
            ]
          }
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          meta:  [{ $count: "total" }],
          items: [{ $skip: skip }, { $limit: limit }]
        }
      },
      {
        $project: {
          total: { $ifNull: [ { $arrayElemAt: ["$meta.total", 0] }, 0 ] },
          items: 1
        }
      }
    ];

    const [agg] = await Devis.aggregate(pipeline).allowDiskUse(true);

    const items = (agg?.items || []).map((d) => ({
      devisNumero: d.numero,
      devisPdf: d.devisPdf,
      demandeNumeros: d.demandeNumeros || [],
      types: d.types || [],
      client: d.clientNom || "",
      date: d.createdAt
    }));

    return res.json({
      success: true,
      page,
      limit,
      total: agg?.total || 0,
      items
    });
  } catch (e) {
    console.error("listDevisCompact error:", e);
    return res.status(500).json({ success:false, message:"Erreur serveur" });
  }
}
