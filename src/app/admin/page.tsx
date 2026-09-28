import type { Metadata } from 'next';
import { SuperAdminConsole } from '@/components/SuperAdminConsole';

export const metadata: Metadata = {
  title: 'All rooms — Scrumbler super admin',
  robots: { index: false, follow: false },
};

/**
 * /admin — the operator's view of every room on the deployment.
 *
 * Nothing is fetched here: the page is a shell, and the console asks for the
 * super-admin key before it calls /api/admin/rooms. Keeping the key out of the
 * server render means this page holds no secret and needs no session.
 */
export default function SuperAdminPage() {
  return (
    <main>
      <SuperAdminConsole />
    </main>
  );
}
