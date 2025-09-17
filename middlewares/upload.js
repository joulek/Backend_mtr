// MTR_Backend/middlewaress/upload.js
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ---- Multer en mémoire (pas de disque local) ----
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 4 }, // max 10MB, 4 fichiers
});

// ---- Helper pour uploader un buffer vers Cloudinary ----
export const uploadBufferToCloudinary = (buffer, { folder, resource_type = "auto", filename_override } = {}) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: folder ? folder : "mtr",
        resource_type,
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        filename_override,
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });

// ---- middlewares pour gérer plusieurs fichiers et les pousser vers Cloudinary ----
export const cloudinaryUploadArray = (fieldName, folder) => [
  upload.array(fieldName),
  async (req, res, next) => {
    try {
      if (!req.files?.length) {
        req.cloudinaryFiles = [];
        return next();
      }
      const results = await Promise.all(
        req.files.map((f) =>
          uploadBufferToCloudinary(f.buffer, {
            folder,
            resource_type: "auto", // auto = images / pdf / autres
            filename_override: f.originalname,
          })
        )
      );
      req.cloudinaryFiles = results.map((r) => ({
        url: r.secure_url,
        public_id: r.public_id,
        bytes: r.bytes,
        format: r.format,
        resource_type: r.resource_type,
      }));
      next();
    } catch (err) {
      err.status = 400;
      next(err);
    }
  },
];
