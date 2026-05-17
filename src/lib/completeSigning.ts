import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { env } from "../config.js";
import type { NormalizedRect } from "./fields.js";
import { flattenFieldsOntoPdf } from "./flattenPdf.js";
import { parseJson } from "./jsonStorage.js";

export async function persistSignerValuesAndFlattenPdf(
  envelopeId: string,
  recipientId: string,
  fieldValues: Record<string, string>,
): Promise<{ allSigned: boolean }> {
  const envelope = await prisma.envelope.findUnique({
    where: { id: envelopeId },
    include: {
      document: true,
      fields: true,
      recipients: true,
    },
  });

  if (!envelope) {
    throw new Error("envelope_not_found");
  }

  const now = new Date();
  const myFieldIds = envelope.fields
    .filter((f) => f.recipientId === recipientId)
    .map((f) => f.id);

  for (const fieldId of myFieldIds) {
    const trimmed = fieldValues[fieldId]?.trim();
    await prisma.envelopeField.update({
      where: { id: fieldId },
      data: {
        value: trimmed ?? null,
        filledAt: trimmed ? now : null,
      },
    });
  }

  await prisma.recipient.update({
    where: { id: recipientId },
    data: { signedAt: now },
  });

  const refreshed = await prisma.envelope.findUnique({
    where: { id: envelopeId },
    include: { document: true, fields: true, recipients: true },
  });

  if (!refreshed || !refreshed.document) {
    throw new Error("envelope_not_found_or_no_document");
  }

  // Always flatten from the original PDF + all saved field values (avoids double-drawing).
  const sourcePath = path.join(env.fileStorageDir, refreshed.document.storageKey);
  const outputKey = `signed-${envelopeId}-${randomUUID()}.pdf`;
  const outputPath = path.join(env.fileStorageDir, outputKey);

  const fieldsToDraw = refreshed.fields
    .filter((f) => f.value && f.value.trim())
    .map((f) => ({
      pageIndex: f.pageIndex,
      rect: parseJson<NormalizedRect>(f.rectJson, {
        x: 0,
        y: 0,
        width: 0.01,
        height: 0.01,
      }),
      value: f.value!,
      type: f.type,
    }));

  await flattenFieldsOntoPdf(sourcePath, outputPath, fieldsToDraw);

  const signersWithFields = new Set(
    refreshed.fields.map((f) => f.recipientId),
  );
  const allSigned = [...signersWithFields].every((rid) => {
    const r = refreshed.recipients.find((x) => x.id === rid);
    return r?.signedAt != null;
  });

  await prisma.envelope.update({
    where: { id: envelopeId },
    data: {
      signedStorageKey: outputKey,
      status: allSigned ? "COMPLETED" : refreshed.status,
    },
  });

  return { allSigned };
}

export function resolveEnvelopePdfPath(envelope: {
  signedStorageKey: string | null;
  document: { storageKey: string } | null;
}): string {
  const key = envelope.signedStorageKey ?? envelope.document?.storageKey;
  if (!key) throw new Error("envelope_has_no_document");
  return path.join(env.fileStorageDir, key);
}
