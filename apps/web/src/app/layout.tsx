import type { Metadata, Viewport } from 'next';
import '@fontsource/jost/400.css';
import '@fontsource/jost/600.css';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/space-grotesk/400.css';
import './globals.css';

const site = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: 'Channel Green - Somewhere to belong',
  description: 'A cozy, open-source pixel world to hang out in. Walk around, sit by a fire, watch something together, say hi. A ZeroTheory project.',
  openGraph: {
    title: 'Channel Green',
    description: 'Somewhere to belong. A cozy open-source pixel world. SUCH IS LIFE.',
    type: 'website',
  },
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = { themeColor: '#0b1f15', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
