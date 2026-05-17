import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { NormalizedRect } from "./fields.js";

export type FieldToDraw = {
  pageIndex: number;
  rect: NormalizedRect;
  value: string;
  type: string;
};

type SignatureValue = {
  kind: "signature";
  dataUrl?: string;
  text?: string;
};

function parseSignatureValue(value: string): SignatureValue | null {
  if (!value.trim().startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as SignatureValue;
    return parsed?.kind === "signature" ? parsed : null;
  } catch {
    return null;
  }
}

function parseImageDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g));base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    return null;
  }
  return {
    mime: match[1].toLowerCase(),
    bytes: Buffer.from(match[2], "base64"),
  };
}

/** Burn field values onto a PDF; rects use top-left normalized coordinates (0–1). */
export async function flattenFieldsOntoPdf(
  sourcePath: string,
  outputPath: string,
  fields: FieldToDraw[],
): Promise<void> {
  const bytes = fs.readFileSync(sourcePath);
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  for (const field of fields) {
    if (!field.value.trim()) continue;
    const page = pages[field.pageIndex];
    if (!page) continue;

    const { width: pw, height: ph } = page.getSize();
    const r = field.rect;
    const boxW = r.width * pw;
    const boxH = r.height * ph;
    const x = r.x * pw;
    const y = ph - (r.y + r.height) * ph;

    const signature = field.type === "signature" ? parseSignatureValue(field.value) : null;
    const imageData = signature?.dataUrl ? parseImageDataUrl(signature.dataUrl) : null;
    if (imageData) {
      const image = imageData.mime.includes("png")
        ? await pdf.embedPng(imageData.bytes)
        : await pdf.embedJpg(imageData.bytes);
      const scale = Math.min((boxW - 4) / image.width, (boxH - 4) / image.height);
      const drawW = image.width * scale;
      const drawH = image.height * scale;
      page.drawImage(image, {
        x: x + Math.max(2, (boxW - drawW) / 2),
        y: y + Math.max(2, (boxH - drawH) / 2),
        width: drawW,
        height: drawH,
      });
      continue;
    }

    const fontSize = Math.min(14, Math.max(8, boxH * 0.55));
    const text = signature?.text ?? field.value;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const drawX = x + Math.max(2, (boxW - textWidth) / 2);
    const drawY = y + Math.max(2, (boxH - fontSize) / 2);

    page.drawText(text, {
      x: drawX,
      y: drawY,
      size: fontSize,
      font,
      color: rgb(0.1, 0.1, 0.1),
      maxWidth: boxW - 4,
    });
  }

  const out = await pdf.save();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, out);
}
