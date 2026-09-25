import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';

export const ADMIN_HEADER = 'x-admin-token';
export const CLIENT_HEADER = 'x-client-id';

/**
 * Who is asking. Used only to show a viewer their own hidden card — it grants
 * no privileges, so an unknown or absent value simply means “show me nothing”.
 */
export const viewerId = (request: Request): string | null => request.headers.get(CLIENT_HEADER);

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export const badRequest = (m = 'Bad request') => fail(400, m);
export const forbidden = (m = 'Admin token required') => fail(403, m);
export const notFound = (m = 'Room not found') => fail(404, m);

/** Parse + validate a JSON body, returning either the value or a Response. */
export async function readBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: badRequest('Expected a JSON body') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join('.');
    return { ok: false, response: badRequest(path ? `${path}: ${first.message}` : (first?.message ?? 'Invalid body')) };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Wrap a route handler so an unexpected throw becomes a 500 with a readable
 * message instead of an opaque Next.js error page.
 */
export function route<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      console.error('[scrumbler]', error);
      return fail(500, message);
    }
  };
}
