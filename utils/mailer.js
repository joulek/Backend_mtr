import nodemailer from "nodemailer";

export function makeTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,     // ex: "smtp.gmail.com"
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,                   // true si 465
    auth: {
      user: process.env.SMTP_USER,   // ex: compte mail
      pass: process.env.SMTP_PASS,   // ⚠️ mot de passe d'application si Gmail
    },
  });
}