import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Đầm Sen — Thanh toán mô phỏng',
  description: 'Demo QR, điểm thưởng và thông báo realtime',
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
