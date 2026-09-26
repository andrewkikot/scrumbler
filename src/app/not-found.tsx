import Link from 'next/link';
import { Mark } from '@/components/Mark';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div className="px-panel max-w-[440px] p-8">
        <div className="mb-5 flex justify-center">
          <Mark size={48} />
        </div>
        <h1 className="mb-2 text-[24px]">No room at this address</h1>
        <p className="mb-6 text-[color:var(--color-ink-dim)]">
          The link may be mistyped, or the admin deleted the room. Room URLs look like
          <span className="block font-semibold text-[color:var(--color-ink)]">/r/platform-squad</span>
        </p>
        <Link href="/" className="px-btn px-btn-gold">
          Create a room
        </Link>
      </div>
    </main>
  );
}
