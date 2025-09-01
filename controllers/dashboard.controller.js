// controllers/dashboard.controller.js
import mongoose from "mongoose";
import User from "../models/User.js"; // doit contenir createdAt
import Commande from "../models/ClientOrder.js"; // doit contenir createdAt, client, total
import Reclamation from "../models/reclamation.js"; // doit contenir createdAt

function parseRange(q) {
  const now = new Date();
  const from = q.from
    ? new Date(q.from)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29); // 30j par défaut
  const to = q.to ? new Date(q.to) : now;
  // inclure la fin du jour pour 'to'
  const toEnd = new Date(to);
  toEnd.setHours(23, 59, 59, 999);
  return { from, to: toEnd };
}

export async function dashboardOverview(req, res) {
  try {
    const { from, to } = parseRange(req.query);
    const minOrders = Math.max(+(req.query.minOrders ?? 3), 1);
    const limit = Math.min(+(req.query.limit ?? 10), 100);

    const rangeMatch = (field = "createdAt") => ({
      [field]: { $gte: from, $lte: to },
    });

    // 1) KPIs — totaux et dans la période
    const [
      totalClients,
      clientsInRange,
      totalOrders,
      ordersInRange,
      totalClaims,
      claimsInRange,
    ] = await Promise.all([
      User.countDocuments({ role: "client" }),
      User.countDocuments({ role: "client", ...rangeMatch("createdAt") }),

      Commande.countDocuments({}),
      Commande.countDocuments(rangeMatch("createdAt")),

      Reclamation.countDocuments({}),
      Reclamation.countDocuments(rangeMatch("createdAt")),
    ]);

    // 2) Séries par jour
    const byDayOrders = await Commande.aggregate([
      { $match: rangeMatch("createdAt") },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const byDayNewClients = await User.aggregate([
      { $match: { role: "client", ...rangeMatch("createdAt") } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const byDayClaims = await Reclamation.aggregate([
      { $match: rangeMatch("createdAt") },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // 3) Clients fidèles (sur la période sélectionnée)
    // 3) Clients fidèles (sur la période sélectionnée)
    const loyal = await Commande.aggregate([
      { $match: { createdAt: { $gte: from, $lte: to } } }, // facultatif: , status: "confirmed"
      // compat: si jamais d’anciens docs ont "client", on prend user || client
      { $addFields: { clientRef: { $ifNull: ["$user", "$client"] } } },
      { $match: { clientRef: { $type: "objectId" } } },

      {
        $group: {
          _id: "$clientRef",
          orders: { $sum: 1 },
          lastOrder: { $max: "$createdAt" },
        },
      },
      { $match: { orders: { $gte: minOrders } } },
      { $sort: { orders: -1, lastOrder: -1 } },
      { $limit: limit },

      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "client",
        },
      },
      { $unwind: "$client" },

      {
        $project: {
          _id: 0,
          clientId: "$client._id",
          name: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ["$client.prenom", ""] },
                  " ",
                  { $ifNull: ["$client.nom", ""] },
                ],
              },
            },
          },
          // ⬇️ remplace l’ancienne colonne
          accountType: "$client.accountType", // "company" | "person" | ...
          orders: 1,
          lastOrder: 1,
          totalAmount: 1,
        },
      },
    ]);

    res.json({
      range: { from, to },
      kpis: {
        totalClients,
        clientsInRange,
        totalOrders,
        ordersInRange,
        totalClaims,
        claimsInRange,
      },
      series: {
        ordersByDay: byDayOrders.map((d) => ({ date: d._id, count: d.count })),
        newClientsByDay: byDayNewClients.map((d) => ({
          date: d._id,
          count: d.count,
        })),
        claimsByDay: byDayClaims.map((d) => ({ date: d._id, count: d.count })),
      },
      loyalClients: loyal,
    });
  } catch (err) {
    console.error("dashboardOverview:", err);
    res
      .status(500)
      .json({ message: "Erreur serveur", error: String(err?.message || err) });
  }
}
