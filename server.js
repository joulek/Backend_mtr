// server.js
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";

import authRegisterRoutes from "./routes/auth.routes.js";     // register-client / register-admin
import authLoginRoutes from "./routes/auth.js";               // login / logout (cookies HTTP-only)
import userRoutes from "./routes/user.routes.js";
import devisTractionRoutes from "./routes/devisTraction.routes.js";
import adminDevisRoutes from "./routes/admin.devis.routes.js";
import devisTorsionRoutes from "./routes/devisTorsion.routes.js";
import devisCompressionRoutes from "./routes/devisCompression.routes.js";
import devisGrilleRoutes from "./routes/devisGrille.routes.js";
import devisFillDresseRoutes from "./routes/devisFilDresse.routes.js";
import devisAutreRoutes from "./routes/devisAutre.routes.js";
import ProductRoutes from "./routes/product.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import ArticleRoutes from "./routes/article.routes.js";
import reclamationRoutes from "./routes/reclamation.routes.js";           // (si routes supplémentaires
import auth from "./middleware/auth.js";   
import multer from "multer";                  // middleware d'authentification
import authRoutes from "./routes/auth.routes.js"; // Authentification (login, logout, etc.)
import mesDemandesDevisRoutes from "./routes/mesDemandesDevis.js";
import devisRoutes from "./routes/devis.routes.js";
import clientOrderRoutes from "./routes/client.order.routes.js";
import contactRoutes from "./routes/contact.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
dotenv.config();


const upload = multer({ limits: { fileSize: 5 * 1024 * 1024, files: 10 } });
const app = express();

/* ---------- Middlewares GLOBAUX (dans le bon ordre) ---------- */
app.use(cors({
  origin: "http://localhost:3000",
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

app.use(cookieParser());

// ❗️Important: définir les PARSEURS AVANT les routes
// Monte une limite confortable pour JSON / urlencoded
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));


// Static
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

/* ---------------------- MongoDB ---------------------- */
const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/myapp_db";
mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

/* ---------------------- Routes ---------------------- */
app.get("/", (_, res) => res.send("API OK"));
app.use("/api/categories", categoryRoutes);

// Authentification
app.use("/api/auth", authRegisterRoutes);  // Inscription
app.use("/api/auth", authLoginRoutes);     // Connexion / Déconnexion
app.use("/api/auth", authRoutes);          // (si endpoints supplémentaires)
app.use(
  "/files/devis",
  express.static(path.resolve(process.cwd(), "storage/devis"))
);

// Ressources
app.use("/api/produits", ProductRoutes);
app.use("/api/articles", ArticleRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminDevisRoutes);
// Soumissions client
app.use("/api/devis/traction", devisTractionRoutes);
app.use("/api/devis/torsion", devisTorsionRoutes);
app.use("/api/devis/compression", devisCompressionRoutes);
app.use("/api/devis/grille", devisGrilleRoutes);
app.use("/api/devis/filDresse", devisFillDresseRoutes);
app.use("/api/devis/autre", devisAutreRoutes);
app.use("/api/devis", devisRoutes);
app.use("/api/reclamations", auth, upload.array("piecesJointes"), reclamationRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin/users", userRoutes);
app.use("/api", mesDemandesDevisRoutes);
app.use("/api/order", clientOrderRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/dashboard", dashboardRoutes);
// 404
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

/* ---------------------- Error handler ---------------------- */
app.use((err, req, res, next) => {
  // PayloadTooLargeError, etc.
  // err.statusCode ou err.status selon paquet
  const status = err.status || err.statusCode || 500;
  const msg = err.message || "Server error";
  console.error("🔥 Error:", err);
  res.status(status).json({ error: msg });
});

/* ---------------------- Start ---------------------- */
const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);

/* ---------------------- Graceful shutdown ---------------------- */
const shutdown = async () => {
  console.log("\n⏹️  Shutting down...");
  await mongoose.connection.close();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default app;
