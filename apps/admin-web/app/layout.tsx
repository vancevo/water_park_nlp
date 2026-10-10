import type { Metadata } from 'next';
import { SessionKeeper } from '@/components/session-keeper';
import { ShellSwitch } from '@/components/shell-switch';
import './globals.css';

export const viewport = { width: 'device-width', initialScale: 1 };

export const metadata: Metadata = {
  title: 'Đầm Sen Admin',
  description: 'Quản trị POI và nội dung đa ngôn ngữ',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <SessionKeeper />
        <ShellSwitch>{children}</ShellSwitch>
      </body>
    </html>
  );
}
