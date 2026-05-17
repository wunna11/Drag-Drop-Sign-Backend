import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { hashToken, randomToken } from "../../lib/tokens.js";
import { resolveEnvelopePdfPath } from "../../lib/completeSigning.js";
import fs from "node:fs";

const embedBase =
  process.env.EMBED_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:3000/embed";

export const documentRouter = Router();

const querySchema = z.object({
  documentId: z.string().min(1),
  signerEmail: z.string().email(),
  redirectUrl: z.string().url().optional(),
});

documentRouter.get("/getEmbeddedSignLink", async (req, res) => {
  const orgId = req.organizationId!;
  
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    return;
  }

  const { documentId, signerEmail, redirectUrl } = parsed.data;

  // We use Envelope internally instead of Document
  const envelope = await prisma.envelope.findFirst({
    where: { id: documentId, organizationId: orgId },
    include: { recipients: true },
  });

  if (!envelope) {
    res.status(404).json({ error: "document_not_found" });
    return;
  }

  // Validate signer email
  const recipient = envelope.recipients.find(
    (r) => r.email.toLowerCase() === signerEmail.toLowerCase()
  );

  if (!recipient) {
    res.status(400).json({ 
      error: "invalid_signer", 
      message: "The provided signerEmail does not match any recipient on this document." 
    });
    return;
  }

  // Create an embed signing session
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const ttl = 60; // default 1 hour
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000);

  const session = await prisma.embedSession.create({
    data: {
      envelopeId: envelope.id,
      recipientId: recipient.id,
      type: "SIGNING",
      tokenHash,
      expiresAt,
      // You can store redirectUrl if you modify your DB schema or put it in allowedOrigins temporarily, 
      // but for now, we just create the session
    },
  });

  let signLink = `${embedBase}/sign?token=${encodeURIComponent(token)}`;
  if (redirectUrl) {
    signLink += `&redirectUrl=${encodeURIComponent(redirectUrl)}`;
  }

  res.status(200).json({ signLink });
});

// -----------------------------------------------------------------------
// GET /v1/document/properties?documentId=<id>
// Returns BoldSign-style document properties / detail
// -----------------------------------------------------------------------
const statusMap: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "InProgress",
  COMPLETED: "Completed",
  DECLINED: "Declined",
  VOIDED: "Voided",
};

documentRouter.get("/properties", async (req, res) => {
  const orgId = req.organizationId!;
  const documentId = typeof req.query.documentId === "string" ? req.query.documentId : "";

  if (!documentId) {
    res.status(400).json({ error: "documentId_required" });
    return;
  }

  const envelope = await prisma.envelope.findFirst({
    where: { id: documentId, organizationId: orgId },
    include: {
      document: true,
      organization: true,
      recipients: { orderBy: { routingOrder: "asc" } },
      fields: { orderBy: { tabOrder: "asc" } },
      auditEvents: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!envelope) {
    res.status(404).json({ error: "document_not_found" });
    return;
  }

  // Build files array from document
  const files = envelope.document
    ? [
        {
          id: envelope.document.id,
          documentName: envelope.document.originalName,
          order: 0,
          pageCount: envelope.document.pageCount ?? null,
        },
      ]
    : [];

  // Build signer details
  const signers = envelope.recipients.filter((r) => r.role === "SIGNER");
  const ccRecipients = envelope.recipients.filter((r) => r.role === "CC");

  const signerDetails = signers.map((r) => {
    const recipientFields = envelope.fields.filter((f) => f.recipientId === r.id);

    const formFields = recipientFields.map((f) => {
      let rect = { x: 0, y: 0, width: 0, height: 0 };
      try { rect = JSON.parse(f.rectJson); } catch { /* ignore */ }

      return {
        id: f.id,
        formFieldId: f.id,
        type: f.type,
        value: f.value ?? "",
        isRequired: f.required,
        isReadOnly: f.readOnly,
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        pageNumber: f.pageIndex + 1,
        tabIndex: f.tabOrder,
        label: null,
      };
    });

    const recipientStatus = r.signedAt
      ? "Completed"
      : envelope.status === "SENT"
        ? "NotCompleted"
        : "Waiting";

    return {
      id: r.id,
      signerName: r.name ?? "",
      signerEmail: r.email,
      status: recipientStatus,
      order: r.routingOrder,
      signerType: "Signer",
      isViewed: false,
      signedAt: r.signedAt ?? null,
      formFields,
    };
  });

  // Build audit / document history
  const documentHistory = envelope.auditEvents.map((ev) => ({
    id: ev.id,
    action: ev.action,
    ipAddress: ev.ip ?? null,
    userAgent: ev.userAgent ?? null,
    timestamp: Math.floor(ev.createdAt.getTime() / 1000),
    metaData: ev.metaJson ? (() => { try { return JSON.parse(ev.metaJson); } catch { return null; } })() : null,
  }));

  // Build cc details
  const ccDetails = ccRecipients.map((r) => ({
    emailAddress: r.email,
    name: r.name ?? null,
    isViewed: false,
  }));

  res.json({
    documentId: envelope.id,
    messageTitle: envelope.title ?? null,
    documentDescription: envelope.message ?? null,
    status: statusMap[envelope.status] ?? envelope.status,
    files,
    senderDetail: {
      name: envelope.organization.name,
      emailAddress: "", // No sender email field in Organization yet
      isViewed: false,
    },
    signerDetails,
    ccDetails,
    enableSigningOrder: signers.some((s) => s.routingOrder > 1),
    createdDate: Math.floor(envelope.createdAt.getTime() / 1000),
    documentHistory,
    isDeleted: false,
    allowedSignatureTypes: ["Text", "Draw", "Image"],
  });
});

// -----------------------------------------------------------------------
// GET /v1/document/list?page=<page>&pagesize=<pageSize>
// Returns BoldSign-style list of documents / envelopes
// -----------------------------------------------------------------------
documentRouter.get("/list", async (req, res) => {
  const orgId = req.organizationId!;
  const page = parseInt(req.query.page as string || "1", 10) || 1;
  const pageSize = parseInt(req.query.pageSize as string || req.query.pagesize as string || "10", 10) || 10;

  const skip = (page - 1) * pageSize;

  try {
    const [totalRecordsCount, envelopes] = await Promise.all([
      prisma.envelope.count({
        where: { organizationId: orgId },
      }),
      prisma.envelope.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          document: true,
          organization: true,
          recipients: { orderBy: { routingOrder: "asc" } },
          auditEvents: { orderBy: { createdAt: "desc" } },
        },
      }),
    ]);

    const totalPages = Math.ceil(totalRecordsCount / pageSize) || 1;

    const result = envelopes.map((envelope) => {
      const signers = envelope.recipients.filter((r) => r.role === "SIGNER");
      const ccRecipients = envelope.recipients.filter((r) => r.role === "CC");

      const ccDetails = ccRecipients.map((r) => ({
        emailAddress: r.email,
        name: r.name ?? null,
        isViewed: false,
      }));

      // Find latest activityDate and activityBy
      const latestAudit = envelope.auditEvents[0];
      const activityDate = latestAudit
        ? Math.floor(latestAudit.createdAt.getTime() / 1000)
        : Math.floor(envelope.updatedAt.getTime() / 1000);

      let activityBy = "";
      if (latestAudit) {
        if (latestAudit.metaJson) {
          try {
            const meta = JSON.parse(latestAudit.metaJson);
            if (meta.recipientId) {
              const recipient = envelope.recipients.find((r) => r.id === meta.recipientId);
              if (recipient) {
                activityBy = recipient.email;
              }
            }
          } catch { /* ignore */ }
        }
      }
      if (!activityBy) {
        activityBy = envelope.recipients[0]?.email || "wana11391@gmail.com";
      }

      const signerDetails = signers.map((r) => {
        const recipientStatus = r.signedAt
          ? "Completed"
          : envelope.status === "SENT"
            ? "NotCompleted"
            : "Waiting";

        return {
          id: r.id,
          signerName: r.name ?? "",
          signerRole: "",
          signerEmail: r.email,
          status: recipientStatus,
          order: r.routingOrder,
          signerType: "Signer",
        };
      });

      const createdDate = Math.floor(envelope.createdAt.getTime() / 1000);
      const expiryDate = createdDate + 60 * 24 * 3600; // 60 days standard expiry
      const displayStatus = envelope.status === "COMPLETED"
        ? "Completed"
        : envelope.status === "DRAFT"
          ? "Draft"
          : signers.some((s) => s.signedAt)
            ? "Waiting for others"
            : "Waiting for me";

      return {
        documentId: envelope.id,
        senderDetail: {
          name: envelope.organization.name,
          privateMessage: null,
          emailAddress: "", // No sender email field in Organization yet
          isViewed: false,
        },
        ccDetails,
        createdDate,
        activityDate,
        activityBy,
        messageTitle: envelope.title ?? "Untitled Document",
        status: statusMap[envelope.status] ?? envelope.status,
        signerDetails,
        expiryDate,
        enableSigningOrder: signers.some((s) => s.routingOrder > 1),
        isDeleted: false,
        labels: [],
        cursor: activityDate * 1000,
        brandId: "a97486c6-8b31-42eb-b0db-37aeb469e632",
        scheduledSendTime: null,
        inEditingMode: envelope.status === "DRAFT",
        displayStatus,
      };
    });

    res.json({
      pageDetails: {
        pageSize,
        page,
        totalRecordsCount,
        totalPages,
        sortedColumn: "activityDate",
        sortDirection: "DESC",
      },
      result,
    });
  } catch (error) {
    console.error("Failed to list documents:", error);
    res.status(500).json({ error: "internal_error" });
  }
});

// -----------------------------------------------------------------------
// GET /v1/document/download?documentId=<id>
// Downloads the envelope / document PDF file (signed if complete, else original)
// -----------------------------------------------------------------------
documentRouter.get("/download", async (req, res) => {
  const orgId = req.organizationId!;
  const documentId = typeof req.query.documentId === "string" ? req.query.documentId : "";

  if (!documentId) {
    res.status(400).json({ error: "documentId_required" });
    return;
  }

  try {
    const envelope = await prisma.envelope.findFirst({
      where: { id: documentId, organizationId: orgId },
      include: { document: true },
    });

    if (!envelope) {
      res.status(404).json({ error: "document_not_found" });
      return;
    }

    if (!envelope.document) {
      res.status(404).json({ error: "no_document" });
      return;
    }

    const filePath = resolveEnvelopePdfPath(envelope);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "file_not_found" });
      return;
    }

    const baseName = (envelope.title || envelope.document.originalName)
      .replace(/\.pdf$/i, "")
      .replace(/[^\w.\- ()[\]]+/g, "")
      .trim();
    
    const isCompleted = envelope.status === "COMPLETED";
    const filename = `${baseName || "document"}${isCompleted ? "-signed" : ""}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.sendFile(filePath);
  } catch (error) {
    console.error("Failed to download document:", error);
    res.status(500).json({ error: "internal_error" });
  }
});


