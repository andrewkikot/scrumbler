import { z } from 'zod';
import { badRequest, json, route } from '@/lib/api';
import { prisma } from '@/lib/db';
import { DECK_KEYS } from '@/lib/decks';
import { newAdminToken, newSlug, newWatchToken, slugifyName } from '@/lib/ids';
import { rateLimit, roomCreationBrake } from '@/lib/limits';

export const runtime = 'nodejs';

const CreateRoom = z.object({
  name: z.string().trim().min(1).max(60),
  deckKey: z.enum(DECK_KEYS as [string, ...string[]]).optional(),
  wheelNames: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
});

/** POST /api/rooms — create a permanent room and mint its admin token. */
export const POST = route(async (request: Request) => {
  // Per address first, so one script cannot spend the global allowance alone.
  const limited = (await rateLimit(request, 'createRoom')) ?? (await roomCreationBrake());
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = CreateRoom.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid body');

  const { name, deckKey, wheelNames } = parsed.data;

  // Prefer a readable slug derived from the room name; fall back to a random
  // one, and suffix on collision so creation never fails for a taken name.
  let slug = slugifyName(name) || newSlug();
  if (await prisma.room.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${slug}-${newSlug().slice(0, 4)}`;
  }

  const adminToken = newAdminToken();
  const uniqueNames = [...new Set((wheelNames ?? []).map((n) => n.trim()).filter(Boolean))];

  const room = await prisma.room.create({
    data: {
      slug,
      name,
      adminToken,
      watchToken: newWatchToken(),
      deckKey: deckKey ?? 'fibonacci',
      rounds: { create: { number: 1 } },
      wheelEntries: {
        create: uniqueNames.map((label, position) => ({ label, position })),
      },
    },
    select: { slug: true, name: true, adminToken: true },
  });

  return json(room, { status: 201 });
});
