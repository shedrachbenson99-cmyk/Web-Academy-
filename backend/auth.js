// auth.js — password hashing (scrypt) and opaque session tokens.
// Deliberately uses only Node's built-in crypto module: no bcrypt/jsonwebtoken
// dependency, so this whole backend runs with zero `npm install`.
"use strict";
const crypto = require("node:crypto");

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hash, "hex");
  if (candidate.length !== stored.length) return false;
  // Constant-time comparison to avoid timing attacks.
  return crypto.timingSafeEqual(candidate, stored);
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = { hashPassword, verifyPassword, generateToken };
