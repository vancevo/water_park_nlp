'use client';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from './app-shell';

/** The admin chrome everywhere except the phone-first /field screens. */
export function ShellSwitch({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith('/field')) return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}
