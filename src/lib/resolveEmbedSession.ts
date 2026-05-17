import type { EmbedSessionType, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { verifyTokenHash } from "./tokens.js";

const sessionInclude = {
  envelope: {
    include: {
      document: true,
      fields: { orderBy: { tabOrder: "asc" as const } },
      recipients: { orderBy: { routingOrder: "asc" as const } },
    },
  },
  recipient: true,
} satisfies Prisma.EmbedSessionInclude;

export type ResolvedEmbedSession = Prisma.EmbedSessionGetPayload<{
  include: typeof sessionInclude;
}>;

async function findSessionByToken(
  token: string,
  expectedType?: EmbedSessionType,
): Promise<ResolvedEmbedSession | null> {
  if (!token || token.length < 12) {
    return null;
  }

  const sessions = await prisma.embedSession.findMany({
    where: {
      ...(expectedType ? { type: expectedType } : {}),
      expiresAt: { gt: new Date() },
      consumedAt: null,
    },
    include: sessionInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  for (const session of sessions) {
    const ok = await verifyTokenHash(token, session.tokenHash);
    if (ok) {
      return session;
    }
  }

  return null;
}

export async function resolveEmbedSession(
  token: string,
  expectedType: EmbedSessionType,
): Promise<ResolvedEmbedSession | null> {
  return findSessionByToken(token, expectedType);
}

export async function resolveEmbedSessionAny(
  token: string,
): Promise<ResolvedEmbedSession | null> {
  return findSessionByToken(token);
}
