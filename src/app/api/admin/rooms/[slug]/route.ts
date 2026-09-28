import { json, notFound, route } from '@/lib/api';
import { publish } from '@/lib/bus';
import { prisma } from '@/lib/db';
import { requireSuperAdmin } from '@/lib/superadmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * DELETE /api/admin/rooms/:slug — delete one room without holding its admin
 * token. Cascades to participants, rounds, votes, wheel entries and spins.
 */
export const DELETE = route(async (request: Request, { params }: Ctx) => {
  const denied = requireSuperAdmin(request);
  if (denied) return denied;

  const { slug } = await params;
  const room = await prisma.room.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!room) return notFound();

  await prisma.room.delete({ where: { id: room.id } });
  publish(slug);

  console.warn(`[scrumbler] super-admin deleted room ${slug} (${room.name})`);
  return json({ deleted: true, slug });
});
