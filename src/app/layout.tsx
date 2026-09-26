import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, Pixelify_Sans } from 'next/font/google';
import './globals.css';

// Display face: a bitmap grid with real lowercase. It carries the identity —
// the wordmark, headings, the name the wheel lands on — at 18px and up, where
// the grid reads as a choice rather than as a puzzle.
const pixelify = Pixelify_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-pixelify',
  display: 'swap',
});

// Body face: gridded and slightly technical, which sits naturally beside
// bitmap type without pretending to be it. It does all the actual reading —
// prose, buttons, labels, chips, names, numbers, the wheel's wedges.
const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Scrumbler — planning poker and the daily wheel',
  description:
    'Estimate together in a permanent room, then spin the wheel to pick who runs tomorrow. No accounts, no sign-up.',
};

export const viewport: Viewport = {
  themeColor: '#1b1430',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${pixelify.variable} ${plex.variable}`}>
      <body>{children}</body>
    </html>
  );
}
