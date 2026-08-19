// router.js — a tiny Express-like router built on node:http, so the whole
// backend needs zero npm dependencies. Supports :params, middleware chains,
// JSON bodies, and JSON error responses.
"use strict";

class Router {
  constructor() {
    this.routes = []; // { method, segments, handlers }
  }
  _add(method, path, handlers) {
    const segments = path.split("/").filter(Boolean);
    this.routes.push({ method, segments, handlers });
  }
  get(path, ...h) { this._add("GET", path, h); }
  post(path, ...h) { this._add("POST", path, h); }
  put(path, ...h) { this._add("PUT", path, h); }
  delete(path, ...h) { this._add("DELETE", path, h); }

  match(method, pathname) {
    const segs = pathname.split("/").filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method) continue;
      if (r.segments.length !== segs.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const rs = r.segments[i];
        if (rs.startsWith(":")) params[rs.slice(1)] = decodeURIComponent(segs[i]);
        else if (rs !== segs[i]) { ok = false; break; }
      }
      if (ok) return { handlers: r.handlers, params };
    }
    return null;
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    const MAX = 6 * 1024 * 1024; // 6MB cap (covers small assignment attachments)
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX) { reject(new Error("Request body too large")); req.destroy(); return; }
      data += chunk;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  });
  res.end(payload);
}

async function handleRequest(router, req, res) {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") { sendJson(res, 204, {}); return; }

  const match = router.match(req.method, url.pathname);
  if (!match) { sendJson(res, 404, { error: "Not found" }); return; }

  req.params = match.params;
  req.query = Object.fromEntries(url.searchParams.entries());
  if (["POST", "PUT"].includes(req.method)) {
    try { req.body = await readJsonBody(req); }
    catch (e) { sendJson(res, 400, { error: e.message }); return; }
  } else {
    req.body = {};
  }

  let i = 0;
  const next = async (err) => {
    if (err) { sendJson(res, err.status || 500, { error: err.message || "Server error" }); return; }
    const handler = match.handlers[i++];
    if (!handler) { sendJson(res, 500, { error: "No handler matched" }); return; }
    try { await handler(req, res, next); }
    catch (e) { sendJson(res, e.status || 500, { error: e.message || "Server error" }); }
  };
  await next();
}

module.exports = { Router, handleRequest, sendJson };
