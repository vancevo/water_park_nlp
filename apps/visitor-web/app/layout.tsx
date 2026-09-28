import type { Metadata, Viewport } from 'next';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Khám phá Đầm Sen',
  description:
    'Bản đồ khám phá, thuyết minh đa ngôn ngữ và dẫn đường tại Đầm Sen.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#075f46',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
