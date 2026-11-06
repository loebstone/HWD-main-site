import express, { type RequestHandler } from "express";
import { appOrigin } from "../lib/config";
import { PROXY_TRUST } from "../lib/proxy-trust";

// Resolve configuration when the serving process starts, never at build time.
export function canonicalOrigin(): RequestHandler {
  const origin = process.env.NODE_ENV === "production" ? new URL(appOrigin()) : null;
  return (req, res, next) => {
    if (!origin || !req.headers.host || req.path === "/api/healthz" ||
        req.host?.toLowerCase() === origin.host.toLowerCase()) {
      next(); return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(403).json({ error: "Write requests require same-origin browser headers" });
      return;
    }
    // Concatenation keeps even //... request targets on the fixed canonical host.
    const path = req.originalUrl.startsWith("/") ? req.originalUrl : `/${req.originalUrl}`;
    res.redirect(301, origin.origin + path);
  };
}

// Vite serves production HTML separately. Use Express's exact same bounded
// proxy-aware req.host resolution there, before Vite's headers/static handlers.
export function canonicalOriginGateway() {
  const gateway = express();
  gateway.disable("x-powered-by");
  gateway.set("trust proxy", PROXY_TRUST.hops);
  gateway.use(canonicalOrigin());
  return gateway;
}
