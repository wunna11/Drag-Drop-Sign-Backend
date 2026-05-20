import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../../db.js";
import { env } from "../../config.js";
import { hashToken, randomToken } from "../../lib/tokens.js";
import { mergePdfs } from "../../lib/mergePdfs.js";

// ---------------------------------------------------------------------------
// Multer — accept multiple PDFs under the field name "Files"
// ---------------------------------------------------------------------------
const allowedMime = new Set(["application/pdf"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.fileStorageDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".pdf";
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedMime.has(file.mimetype)) {
      cb(new Error("unsupported_mime"));
      return;
    }
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// Helper — parse flat form-data keys like Signers[0][Name] into an array
// ---------------------------------------------------------------------------
type RawSigner = {
  Name?: string;
  EmailAddress?: string;
  SignerOrder?: string;
};

function parseSigners(body: Record<string, unknown> | undefined): RawSigner[] {
  if (!body) return [];
  // Multer parses Signers[0][Name] into an object array natively
  // body.Signers might be an array: [ { Name: 'SM', EmailAddress: '...' }, ... ]
  if (Array.isArray(body.Signers)) {
    return body.Signers as RawSigner[];
  }

  // Fallback for flat keys if parser behaves differently in other environments
  const map: Record<number, RawSigner> = {};

  for (const [key, value] of Object.entries(body)) {
    const match = key.match(/^Signers\[(\d+)\]\[(\w+)\]$/);
    if (!match) continue;
    const idx = Number(match[1]);
    const field = match[2] as keyof RawSigner;
    if (!map[idx]) map[idx] = {};
    map[idx][field] = String(value);
  }

  return Object.keys(map)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => map[Number(k)]);
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------
const embedBase =
  process.env.EMBED_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:3000/embed";

// Default TTL — 24 hours so the URL is usable after you share it
const DEFAULT_TTL_MINUTES = 60 * 24;

export const createRequestUrlRouter = Router();

createRequestUrlRouter.post(
  "/",
  upload.array("Files", 20),
  async (req, res) => {
    const orgId = req.organizationId!;

    const files = req.files as Express.Multer.File[] | undefined;
    const rawSigners = parseSigners(req.body as Record<string, unknown>);

    for (const [i, s] of rawSigners.entries()) {
      if (!s.EmailAddress) {
        if (files) {
          for (const f of files) fs.rmSync(f.path, { force: true });
        }
        res.status(400).json({ error: `signer_${i}_missing_email` });
        return;
      }
    }

    // -----------------------------------------------------------------------
    // 3. Merge PDFs (if files are provided)
    // -----------------------------------------------------------------------
    let doc: { id: string } | null = null;

    if (files && files.length > 0) {
      const sourcePaths = files.map((f) => f.path);
      let mergedFilePath: string;
      let mergedStorageKey: string;
      let mergedByteSize: number;

      try {
        const merged = await mergePdfs(sourcePaths);
        mergedFilePath = merged.filePath;
        mergedStorageKey = merged.storageKey;
        mergedByteSize = fs.statSync(mergedFilePath).size;
      } catch (err) {
        // Clean up uploaded files on merge failure
        for (const f of files) fs.rmSync(f.path, { force: true });
        throw err;
      }

      // If we merged into a new file, remove the originals
      if (files.length > 1) {
        for (const f of files) fs.rmSync(f.path, { force: true });
      }

      // Original display name: use original filename if 1 file, else JSON array of filenames
      const originalName =
        files.length === 1
          ? files[0].originalname
          : JSON.stringify(files.map((f) => f.originalname));

      doc = await prisma.document.create({
        data: {
          organizationId: orgId,
          originalName,
          storageKey: mergedStorageKey,
          mimeType: "application/pdf",
          byteSize: mergedByteSize,
          pageCount: null,
        },
      });
    }

    // -----------------------------------------------------------------------
    // 4. Create Envelope with recipients
    // -----------------------------------------------------------------------
    const title = (req.body as Record<string, string> | undefined)?.Title || null;

    const envelope = await prisma.envelope.create({
      data: {
        organizationId: orgId,
        documentId: doc ? doc.id : null,
        title,
        recipients:
          rawSigners.length > 0
            ? {
                create: rawSigners.map((s) => ({
                  email: s.EmailAddress!,
                  name: s.Name ?? null,
                  routingOrder: s.SignerOrder ? Number(s.SignerOrder) : 1,
                })),
              }
            : undefined,
      },
      include: { recipients: true },
    });

    await prisma.auditEvent.create({
      data: {
        envelopeId: envelope.id,
        action: "envelope.created",
        ip: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
      },
    });

    // -----------------------------------------------------------------------
    // 6. Create embed session (REQUESTING)
    // -----------------------------------------------------------------------
    const token = randomToken();
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + DEFAULT_TTL_MINUTES * 60 * 1000);

    await prisma.embedSession.create({
      data: {
        envelopeId: envelope.id,
        type: "REQUESTING",
        tokenHash,
        expiresAt,
        allowedOrigins: "[]",
      },
    });

    const sendUrl = `${embedBase}/request?token=${encodeURIComponent(token)}`;

    // -----------------------------------------------------------------------
    // 7. Return BoldSign-compatible response
    // -----------------------------------------------------------------------
    res.status(201).json({
      documentId: envelope.id,   // mirrors BoldSign's documentId field
      sendUrl,
    });
  },
);
