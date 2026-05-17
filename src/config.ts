import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
process.env.DATABASE_URL = databaseUrl;

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl,
  fileStorageDir: process.env.FILE_STORAGE_DIR
    ? path.resolve(process.env.FILE_STORAGE_DIR)
    : path.join(root, "uploads"),
};

fs.mkdirSync(env.fileStorageDir, { recursive: true });
