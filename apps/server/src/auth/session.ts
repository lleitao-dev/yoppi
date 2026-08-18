import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma';

export const SESSION_COOKIE_NAME = 'yoppi_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  secure: boolean,
): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    signed: true,
  });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
  });
}

export async function createGuestPlayer(displayName: string) {
  const token = createSessionToken();
  const player = await prisma.player.create({
    data: {
      displayName,
      sessionTokenHash: hashToken(token),
    },
  });

  return { player, token };
}

export async function getPlayerByToken(token: string) {
  return prisma.player.findUnique({
    where: { sessionTokenHash: hashToken(token) },
  });
}

export async function getPlayerFromRequest(request: FastifyRequest) {
  const cookieValue = request.cookies[SESSION_COOKIE_NAME];
  if (!cookieValue) return null;

  const unsigned = request.unsignCookie(cookieValue);
  if (!unsigned.valid || !unsigned.value) return null;

  const player = await getPlayerByToken(unsigned.value);
  if (!player) return null;

  await prisma.player.update({
    where: { id: player.id },
    data: { lastSeenAt: new Date() },
  });

  return player;
}

export async function getPlayerFromCookieHeader(
  app: FastifyInstance,
  cookieHeader: string | undefined,
) {
  if (!cookieHeader) return null;
  const cookies = app.parseCookie(cookieHeader);
  const cookieValue = cookies[SESSION_COOKIE_NAME];
  if (!cookieValue) return null;

  const unsigned = app.unsignCookie(cookieValue);
  if (!unsigned.valid || !unsigned.value) return null;

  return getPlayerByToken(unsigned.value);
}

export async function revokeSession(playerId: string): Promise<void> {
  const replacement = hashToken(createSessionToken());
  await prisma.player.update({
    where: { id: playerId },
    data: { sessionTokenHash: replacement },
  });
}
