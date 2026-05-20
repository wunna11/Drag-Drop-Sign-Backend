import path from "node:path";
import fs from "node:fs";
import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../db.js";
import { env } from "../../config.js";
import {
  resolveEmbedSession,
  resolveEmbedSessionAny,
} from "../../lib/resolveEmbedSession.js";
import { formatFieldResponse, replaceFieldsSchema } from "../../lib/fields.js";
import { replaceEnvelopeFields } from "../../lib/saveEnvelopeFields.js";
import { hashToken, randomToken } from "../../lib/tokens.js";
import {
  persistSignerValuesAndFlattenPdf,
  resolveEnvelopePdfPath,
} from "../../lib/completeSigning.js";
import { stringifyJson } from "../../lib/jsonStorage.js";
import { signingPageHtml } from "./signPage.js";
import { requestPageHtml } from "./requestPage.js";

const embedBase =
  process.env.EMBED_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:3000/embed";

import { mergePdfs } from "../../lib/mergePdfs.js";

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

export const hostedEmbedRouter = Router();

hostedEmbedRouter.get("/sign", (_req, res) => {
  res.type("html").send(signingPageHtml());
});

hostedEmbedRouter.get("/request", (_req, res) => {
  res.type("html").send(requestPageHtml());
});

async function sendDocument(
  token: string,
  res: import("express").Response,
): Promise<boolean> {
  const session = await resolveEmbedSessionAny(token);
  if (!session) {
    res.status(401).json({ error: "invalid_or_expired_session" });
    return false;
  }

  if (!session.envelope.document) {
    res.status(404).json({ error: "no_document" });
    return false;
  }

  const filePath = resolveEnvelopePdfPath(session.envelope);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "file_not_found" });
    return false;
  }

  res.type(session.envelope.document.mimeType);
  res.sendFile(filePath);
  return true;
}

hostedEmbedRouter.get("/api/document", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  await sendDocument(token, res);
});

hostedEmbedRouter.get("/api/download", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = await resolveEmbedSessionAny(token);
  if (!session) {
    res.status(401).json({ error: "invalid_or_expired_session" });
    return;
  }

  const envelope = session.envelope;
  if (envelope.status !== "COMPLETED" || !envelope.signedStorageKey) {
    res.status(409).json({
      error: "envelope_not_completed",
      status: envelope.status,
    });
    return;
  }

  if (!envelope.document) {
    res.status(404).json({ error: "no_document" });
    return;
  }

  const filePath = resolveEnvelopePdfPath(envelope);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "signed_file_not_found" });
    return;
  }

  const baseName = (envelope.title || envelope.document.originalName)
    .replace(/\.pdf$/i, "")
    .replace(/[^\w.\- ()[\]]+/g, "")
    .trim();
  const filename = `${baseName || "document"}-signed.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.sendFile(filePath);
});

hostedEmbedRouter.get("/api/session", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = await resolveEmbedSession(token, "SIGNING");
  if (!session) {
    res.status(401).json({ error: "invalid_or_expired_session" });
    return;
  }

  const recipientId = session.recipientId;
  const editableFields = session.envelope.fields.filter(
    (f) => f.recipientId === recipientId && !f.filledAt,
  );
  const completedFields = session.envelope.fields.filter(
    (f) => f.recipientId !== recipientId && f.value,
  );

  await prisma.auditEvent.create({
    data: {
      envelopeId: session.envelopeId,
      action: "embed.signing.viewed",
      ip: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    },
  });

  res.json({
    sessionId: session.id,
    envelope: {
      id: session.envelope.id,
      title: session.envelope.title,
      status: session.envelope.status,
    },
    document: session.envelope.document
      ? {
          id: session.envelope.document.id,
          originalName: session.envelope.document.originalName,
        }
      : null,
    recipient: session.recipient
      ? {
          id: session.recipient.id,
          email: session.recipient.email,
          name: session.recipient.name,
        }
      : null,
    fields: editableFields.map(formatFieldResponse),
    completedFields: completedFields.map(formatFieldResponse),
  });
});

hostedEmbedRouter.get("/api/request/session", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = await resolveEmbedSession(token, "REQUESTING");
  if (!session) {
    res.status(401).json({ error: "invalid_or_expired_session" });
    return;
  }

  if (session.envelope.status !== "DRAFT") {
    res.status(409).json({ error: "envelope_not_editable" });
    return;
  }

  res.json({
    sessionId: session.id,
    envelope: {
      id: session.envelope.id,
      title: session.envelope.title,
      status: session.envelope.status,
    },
    document: session.envelope.document ? {
      id: session.envelope.document.id,
      originalName: session.envelope.document.originalName,
    } : null,
    recipients: session.envelope.recipients.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      routingOrder: r.routingOrder,
    })),
    fields: session.envelope.fields.map(formatFieldResponse),
  });
});

hostedEmbedRouter.post("/api/request/upload", upload.array("Files", 20), async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = await resolveEmbedSession(token, "REQUESTING");
  if (!session) {
    res.status(401).json({ error: "invalid_or_expired_session" });
    return;
  }

  if (session.envelope.status !== "DRAFT") {
    res.status(409).json({ error: "envelope_not_editable" });
    return;
  }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: "files_required" });
    return;
  }

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
    for (const f of files) fs.rmSync(f.path, { force: true });
    res.status(500).json({ error: "merge_failed" });
    return;
  }

  if (files.length > 1) {
    for (const f of files) fs.rmSync(f.path, { force: true });
  }

  const originalName = files.length === 1 ? files[0].originalname : "document.pdf";

  // Create the document
  const doc = await prisma.document.create({
    data: {
      organizationId: session.envelope.organizationId,
      originalName,
      storageKey: mergedStorageKey,
      mimeType: "application/pdf",
      byteSize: mergedByteSize,
      pageCount: null,
    },
  });

  // Attach to envelope
  await prisma.envelope.update({
    where: { id: session.envelopeId },
    data: { documentId: doc.id },
  });

  res.json({ ok: true, document: { id: doc.id, originalName: doc.originalName } });
});

const updateRecipientsSchema = z.object({
  token: z.string().min(12),
  recipients: z.array(z.object({
    id: z.string().optional(),
    email: z.string().email(),
    name: z.string().optional(),
    routingOrder: z.number().int().positive().optional(),
  })),
});

hostedEmbedRouter.put("/api/request/recipients", async (req, res) => {
  const parsed = updateRecipientsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }

  const { token, recipients } = parsed.data;
  const session = await resolveEmbedSession(token, "REQUESTING");
  if (!session) {
    res.status(401).json({ error: "invalid_or_expired_session" });
    return;
  }

  if (session.envelope.status !== "DRAFT") {
    res.status(409).json({ error: "envelope_not_editable" });
    return;
  }

  const newRecipients = await prisma.$transaction(async (tx) => {
    // Fetch existing recipients
    const existingRecipients = await tx.recipient.findMany({
      where: { envelopeId: session.envelopeId },
    });

    const existingMap = new Map(existingRecipients.map((r) => [r.id, r]));
    const incomingIds = new Set(
      recipients
        .map((r) => r.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    );

    // Delete recipients that are not in the incoming list
    const idsToDelete = existingRecipients
      .map((r) => r.id)
      .filter((id) => !incomingIds.has(id));

    if (idsToDelete.length > 0) {
      await tx.recipient.deleteMany({
        where: { id: { in: idsToDelete } },
      });
    }

    // Upsert recipients
    return Promise.all(
      recipients.map((r, i) => {
        if (r.id && existingMap.has(r.id)) {
          return tx.recipient.update({
            where: { id: r.id },
            data: {
              email: r.email,
              name: r.name ?? null,
              routingOrder: r.routingOrder ?? i + 1,
            },
          });
        } else {
          return tx.recipient.create({
            data: {
              envelopeId: session.envelopeId,
              email: r.email,
              name: r.name ?? null,
              routingOrder: r.routingOrder ?? i + 1,
            },
          });
        }
      })
    );
  });

  res.json({ ok: true, recipients: newRecipients });
});

const requestFieldsBodySchema = replaceFieldsSchema.extend({
  token: z.string().min(12),
});

hostedEmbedRouter.put("/api/request/fields", async (req, res) => {
  const parsed = requestFieldsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }

  const session = await resolveEmbedSession(parsed.data.token, "REQUESTING");
  if (!session) {
    res.status(401).json({ error: "invalid_or_expired_session" });
    return;
  }

  if (session.envelope.status !== "DRAFT") {
    res.status(409).json({ error: "envelope_not_editable" });
    return;
  }

  const result = await replaceEnvelopeFields(
    session.envelopeId,
    session.envelope.organizationId,
    parsed.data.fields,
  );

  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ fields: result.fields.map(formatFieldResponse) });
});

const finishSchema = z.object({ token: z.string().min(12) });

hostedEmbedRouter.post("/api/request/finish", async (req, res) => {
  const parsed = finishSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }

  const session = await resolveEmbedSession(parsed.data.token, "REQUESTING");
  if (!session) {
    res.status(401).json({ error: "invalid_or_expired_session" });
    return;
  }

  const envelope = await prisma.envelope.findUnique({
    where: { id: session.envelopeId },
    include: { fields: true, recipients: { orderBy: { routingOrder: "asc" } } },
  });

  if (!envelope || envelope.status !== "DRAFT") {
    res.status(409).json({ error: "envelope_not_editable" });
    return;
  }

  if (envelope.fields.length === 0) {
    res.status(400).json({ error: "no_fields_placed" });
    return;
  }

  await prisma.envelope.update({
    where: { id: envelope.id },
    data: { status: "SENT" },
  });

  await prisma.auditEvent.create({
    data: {
      envelopeId: envelope.id,
      action: "envelope.sent",
      metaJson: stringifyJson({ via: "embed.request" }),
    },
  });

  const ttlMinutes = 60 * 24 * 7;
  const signingSessions = [];

  for (const recipient of envelope.recipients) {
    const hasField = envelope.fields.some((f) => f.recipientId === recipient.id);
    if (!hasField) continue;

    const token = randomToken();
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await prisma.embedSession.create({
      data: {
        envelopeId: envelope.id,
        recipientId: recipient.id,
        type: "SIGNING",
        tokenHash,
        expiresAt,
        allowedOrigins: session.allowedOrigins,
      },
    });

    signingSessions.push({
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      embedUrl: `${embedBase}/sign?token=${encodeURIComponent(token)}`,
    });
  }

  await prisma.embedSession.update({
    where: { id: session.id },
    data: { consumedAt: new Date() },
  });

  res.json({
    ok: true,
    envelopeId: envelope.id,
    status: "SENT",
    signingSessions,
  });
});

const completeSchema = z.object({
  token: z.string().min(12),
  fieldValues: z.record(z.string()).optional(),
});

hostedEmbedRouter.post("/api/sign/complete", async (req, res) => {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }

  const { token, fieldValues } = parsed.data;
  const session = await resolveEmbedSession(token, "SIGNING");
  if (!session) {
    res.status(401).json({ error: "invalid_or_expired_session" });
    return;
  }

  if (session.consumedAt) {
    res.status(409).json({ error: "session_already_used" });
    return;
  }

  const myFields = session.envelope.fields.filter(
    (f) => f.recipientId === session.recipientId,
  );
  for (const field of myFields) {
    if (field.required) {
      const val = fieldValues?.[field.id]?.trim();
      if (!val) {
        res.status(400).json({ error: "required_field_missing", fieldId: field.id });
        return;
      }
    }
  }

  await persistSignerValuesAndFlattenPdf(
    session.envelopeId,
    session.recipientId!,
    fieldValues ?? {},
  );

  await prisma.embedSession.update({
    where: { id: session.id },
    data: { consumedAt: new Date() },
  });

  await prisma.auditEvent.create({
    data: {
      envelopeId: session.envelopeId,
      action: "embed.signing.completed",
      metaJson: stringifyJson({
        recipientId: session.recipientId,
        fieldValues: fieldValues ?? {},
      }),
      ip: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    },
  });

  const envelope = await prisma.envelope.findUnique({
    where: { id: session.envelopeId },
    select: { status: true },
  });

  const downloadUrl =
    envelope?.status === "COMPLETED"
      ? `/v1/envelopes/${session.envelopeId}/download`
      : undefined;

  res.json({
    ok: true,
    envelopeId: session.envelopeId,
    status: envelope?.status,
    downloadUrl,
    embedDownloadUrl:
      envelope?.status === "COMPLETED"
        ? `/embed/api/download?token=${encodeURIComponent(token)}`
        : undefined,
  });
});
