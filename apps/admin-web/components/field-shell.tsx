'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuthSessionPanel } from './auth-session-panel';
import { useEffect, useState } from 'react';
import {
  AUTH_SESSION_EVENT,
  readAuthSession,
  type AdminAuthSession,
} from '@/lib/auth-session';

/** Phone-first frame for /field: no sidebar, big targets, login only when needed. */
export function FieldShell({
  title,
  back,
  actions,
  children,
}: {
  title: string;
  back?: { href: string; label: string };
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [session, setSession] = useState<AdminAuthSession | null | undefined>(
    undefined,
  );
  useEffect(() => {
    const sync = () => setSession(readAuthSession());
    sync();
    window.addEventListener(AUTH_SESSION_EVENT, sync);
    return () => window.removeEventListener(AUTH_SESSION_EVENT, sync);
  }, []);
  return (
    <div className="field-shell">
      <header className="field-header">
        {back ? (
          <Link href={back.href} className="field-back">
            ‹ {back.label}
          </Link>
        ) : (
          <span className="field-brand">Đầm Sen · Hiện trường</span>
        )}
        <h1>{title}</h1>
        {actions}
      </header>
      {session === undefined ? null : session ? (
        children
      ) : (
        <div className="panel card field-login">
          <h2>Đăng nhập để bắt đầu</h2>
          <AuthSessionPanel />
        </div>
      )}
    </div>
  );
}
