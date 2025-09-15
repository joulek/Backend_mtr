// controllers/authController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import nodemailer from "nodemailer";
import mongoose from "mongoose";

const NEUTRAL = "Si un compte existe, un email a été envoyé.";
const COOLDOWN_MS = 60 * 1000;

/* ✅ Effacer les cookies (mêmes options que pour set) */
export function clearAuthCookies(res) {
  const base = { path: "/", sameSite: "none", secure: true };
  res.clearCookie("token", base);
  res.clearCookie("role", base);
}

/* ✅ Poser des cookies cross-site: SameSite=None + Secure */
export function setAuthCookies(res, { token, role = "client", remember = false }) {
  const maxAge = (remember ? 30 : 1) * 24 * 60 * 60 * 1000; // 30j / 1j
  const base = {
    path: "/",
    sameSite: "none", // 🔥 indispensable pour XHR/fetch cross-site
    secure: true,     // 🔥 obligé avec SameSite=None
    maxAge,
  };
  // Cookie HTTP-only pour le JWT
  res.cookie("token", token, { ...base, httpOnly: true });
  // (optionnel) rôle lisible côté client
  res.cookie("role", role, { ...base, httpOnly: false });
}
