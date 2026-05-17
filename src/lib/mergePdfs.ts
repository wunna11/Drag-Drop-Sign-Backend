import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { env } from "../config.js";

/**
 * Merge one or more PDF files into a single PDF written to FILE_STORAGE_DIR.
 * If only one path is provided the original file is returned as-is (no copy).
 *
 * @param sourcePaths  Absolute paths to existing PDF files (in order).
 * @returns            Absolute path to the merged (or original) PDF file and the storage key.
 */
export async function mergePdfs(
  sourcePaths: string[],
): Promise<{ filePath: string; storageKey: string }> {
  if (sourcePaths.length === 0) {
    throw new Error("mergePdfs: at least one source path is required");
  }

  // Single file — no merge needed, use as-is.
  if (sourcePaths.length === 1) {
    const filePath = sourcePaths[0];
    const storageKey = path.basename(filePath);
    return { filePath, storageKey };
  }

  // Multiple files — merge pages into a new PDF.
  const merged = await PDFDocument.create();

  for (const srcPath of sourcePaths) {
    const bytes = fs.readFileSync(srcPath);
    const src = await PDFDocument.load(bytes);
    const pageIndices = src.getPageIndices();
    const copiedPages = await merged.copyPages(src, pageIndices);
    for (const page of copiedPages) {
      merged.addPage(page);
    }
  }

  const mergedBytes = await merged.save();
  const storageKey = `${randomUUID()}.pdf`;
  const filePath = path.join(env.fileStorageDir, storageKey);
  fs.writeFileSync(filePath, mergedBytes);

  return { filePath, storageKey };
}
