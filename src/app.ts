import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { requireApiKey } from "./middleware/requireApiKey.js";
import { createRequestUrlRouter } from "./routes/v1/createRequestUrl.js";
import { documentRouter } from "./routes/v1/document.js";
import { hostedEmbedRouter } from "./routes/embed/hostedRouter.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "200mb" }));

  app.use(express.static(path.join(projectRoot, "public")));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/swagger", (_req, res) => res.redirect("/docs/"));
  app.get("/docs", (_req, res) => res.redirect("/docs/"));
  const v1 = express.Router();
  v1.use(requireApiKey);
  // POST /v1/embed/sessions/create-request-url
  v1.use("/embed/sessions/create-request-url", createRequestUrlRouter);
  // GET  /v1/document/getEmbeddedSignLink
  // GET  /v1/document/properties
  v1.use("/document", documentRouter);

  app.use("/v1", v1);

  // Public hosted pages for embedded signing (no API key; token in query string).
  app.use("/embed", hostedEmbedRouter);

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ error: "file_too_large" });
          return;
        }
      }
      if (err instanceof Error && err.message === "unsupported_mime") {
        res.status(415).json({ error: "unsupported_mime" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "internal_error" });
    },
  );

  return app;
}
