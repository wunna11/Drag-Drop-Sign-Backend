import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";

export async function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const key = (req.headers["x-api-key"] as string) || "";
  console.log('key', key);
  if (!key || key.length < 12) {
    res.status(401).json({ error: "missing_or_invalid_api_key" });
    return;
  }

  const prefix = key.slice(0, 8);
  const candidates = await prisma.apiKey.findMany({
    where: { keyPrefix: prefix },
    include: { organization: true },
  });

  for (const row of candidates) {
    const ok = await bcrypt.compare(key, row.keyHash);
    if (ok) {
      await prisma.apiKey.update({
        where: { id: row.id },
        data: { lastUsedAt: new Date() },
      });
      req.organizationId = row.organizationId;
      req.organization = row.organization;
      next();
      return;
    }
  }

  res.status(401).json({ error: "invalid_api_key" });
}

declare global {
  namespace Express {
    interface Request {
      organizationId?: string;
      organization?: { id: string; name: string };
    }
  }
}
