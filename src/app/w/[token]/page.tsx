import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { WatchClient } from '@/components/WatchClient';
import { getWatchState } from '@/lib/room';

// Live, like the room itself — never prerender or cache it.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const state = await getWatchState(token);
  return {
    title: state ? `Watching ${state.name} — Scrumbler` : 'Link not found — Scrumbler',
    robots: { index: false, follow: false },
    // The token is the capability: keep it out of Referer headers.
    referrer: 'no-referrer',
  };
}

export default async function WatchPage({ params }: Props) {
  const { token } = await params;
  const state = await getWatchState(token);
  if (!state) notFound();

  return <WatchClient token={token} initialState={state} />;
}
