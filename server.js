// server.js
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import multer from "multer";

import authRoutes from "./routes/auth.routes.js";
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
import reclamationRoutes from "./routes/reclamation.routes.js";
import auth from "./middleware/auth.js";
import mesDemandesDevisRoutes from "./routes/mesDemandesDevis.js";
import devisRoutes from "./routes/devis.routes.js";
import clientOrderRoutes from "./routes/client.order.routes.js";
import contactRoutes from "./routes/contact.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";

dotenv.config();

const app = express();
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024, files: 10 } });

/* ✅ important avec Render/Heroku (X-Forwarded-Proto → Secure cookies) */
app.set("trust proxy", 1);

/* ✅ CORS: origine(s) explicites + cookies */
const ALLOWED_ORIGINS = [
  "https://frontend-mtr.onrender.com",
  "http://localhost:3000",
];
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // outils comme curl/postman
      return cb(null, ALLOWED_ORIGINS.includes(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

/* ✅ parseurs AVANT les routes */
app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

/* ✅ statiques */
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
app.use("/files/devis", express.static(path.resolve(process.cwd(), "storage/devis")));
app.get("/apple-touch-icon.png", (_, res) => res.status(204).end()); // silence warning navigateur

/* ---------------------- MongoDB ---------------------- */
const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/myapp_db";
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

/* ---------------------- Routes ---------------------- */
app.get("/", (_, res) => res.send("API OK"));

app.use("/api/auth", authRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/produits", ProductRoutes);
app.use("/api/articles", ArticleRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminDevisRoutes);

app.use("/api/devis/traction", devisTractionRoutes);
app.use("/api/devis/torsion", devisTorsionRoutes);
app.use("/api/devis/compression", devisCompressionRoutes);
app.use("/api/devis/grille", devisGrilleRoutes);
app.use("/api/devis/filDresse", devisFillDresseRoutes);
app.use("/api/devis/autre", devisAutreRoutes);
app.use("/api/devis", devisRoutes);

app.use("/api/reclamations", auth, upload.array("piecesJointes"), reclamationRoutes);
app.use("/api/admin/users", userRoutes);
app.use("/api", mesDemandesDevisRoutes);
app.use("/api/order", clientOrderRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/dashboard", dashboardRoutes);

/* 404 */
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

/* Global error handler */
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const msg = err.message || "Server error";
  console.error("🔥 Error:", err);
  res.status(status).json({ error: msg });
});

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);

const shutdown = async () => {
  console.log("\n⏹️  Shutting down...");
  await mongoose.connection.close();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default app;
