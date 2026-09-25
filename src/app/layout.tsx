import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, Pixelify_Sans } from 'next/font/google';
import './globals.css';

// Display face: a bitmap grid with real lowercase, so headings and card values
// stay legible at the sizes this app actually uses.
const pixelify = Pixelify_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-pixelify',
  display: 'swap',
});

// Body face: gridded and slightly technical, which sits naturally beside
// bitmap type without pretending to be it.
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
