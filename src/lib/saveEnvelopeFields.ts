import { prisma } from "../db.js";
import type { FieldInput } from "./fields.js";
import { stringifyJson } from "./jsonStorage.js";

export async function replaceEnvelopeFields(
  envelopeId: string,
  organizationId: string,
  fields: FieldInput[],
) {
  const envelope = await prisma.envelope.findFirst({
    where: { id: envelopeId, organizationId },
    include: { recipients: true },
  });

  if (!envelope) {
    return { error: "envelope_not_found" as const };
  }

  if (envelope.status !== "DRAFT") {
    return { error: "envelope_not_editable" as const };
  }

  const recipientIds = new Set(envelope.recipients.map((r) => r.id));
  for (const f of fields) {
    if (!recipientIds.has(f.recipientId)) {
      return { error: "invalid_recipient" as const, recipientId: f.recipientId };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.envelopeField.deleteMany({ where: { envelopeId } });
    if (fields.length > 0) {
      await tx.envelopeField.createMany({
        data: fields.map((f, i) => ({
          envelopeId,
          recipientId: f.recipientId,
          type: f.type,
          pageIndex: f.pageIndex,
          rectJson: stringifyJson(f.rect),
          required: f.required ?? true,
          readOnly: f.readOnly ?? false,
          tabOrder: f.tabOrder ?? i,
          optionsJson: f.label ? stringifyJson({ label: f.label }) : undefined,
        })),
      });
    }
  });

  const saved = await prisma.envelopeField.findMany({
    where: { envelopeId },
    orderBy: { tabOrder: "asc" },
  });

  return { fields: saved };
}
