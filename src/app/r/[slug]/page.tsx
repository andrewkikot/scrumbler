import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RoomClient } from '@/components/RoomClient';
import { getRoomState } from '@/lib/room';

// Rooms are live by definition — never prerender or cache one.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const state = await getRoomState(slug);
  return {
    title: state ? `${state.name} — Scrumbler` : 'Room not found — Scrumbler',
    robots: { index: false, follow: false },
  };
}

export default async function RoomPage({ params }: Props) {
  const { slug } = await params;

  // Server-render the first frame so the table is on screen before the browser
  // has opened its event stream.
  const state = await getRoomState(slug);
  if (!state) notFound();

  return <RoomClient slug={slug} initialState={state} />;
}
