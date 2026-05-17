import { z } from "zod";
import { parseJson } from "./jsonStorage.js";

/** Normalized rectangle: 0–1 relative to page, origin top-left (UI-friendly). */
export const rectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.01).max(1),
  height: z.number().min(0.01).max(1),
});

export const fieldInputSchema = z.object({
  recipientId: z.string().min(1),
  type: z.enum(["signature", "initials", "text", "date", "checkbox"]),
  pageIndex: z.number().int().min(0),
  rect: rectSchema,
  required: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  tabOrder: z.number().int().optional(),
  label: z.string().optional(),
});

export const replaceFieldsSchema = z.object({
  fields: z.array(fieldInputSchema),
});

export type FieldInput = z.infer<typeof fieldInputSchema>;
export type NormalizedRect = z.infer<typeof rectSchema>;

export function formatFieldResponse(field: {
  id: string;
  recipientId: string;
  type: string;
  pageIndex: number;
  rectJson: string;
  required: boolean;
  readOnly: boolean;
  tabOrder: number;
  value: string | null;
  filledAt: Date | null;
  optionsJson: string | null;
}) {
  const options = parseJson<{ label?: string } | null>(field.optionsJson, null);

  return {
    id: field.id,
    recipientId: field.recipientId,
    type: field.type,
    pageIndex: field.pageIndex,
    rect: parseJson<NormalizedRect>(field.rectJson, {
      x: 0,
      y: 0,
      width: 0.01,
      height: 0.01,
    }),
    required: field.required,
    readOnly: field.readOnly,
    tabOrder: field.tabOrder,
    value: field.value ?? undefined,
    filledAt: field.filledAt ?? undefined,
    label:
      options && "label" in options
        ? String(options.label ?? "")
        : undefined,
  };
}
