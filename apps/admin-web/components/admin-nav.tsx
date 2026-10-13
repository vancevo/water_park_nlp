'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ReviewNavLink } from './review-nav-link';

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav>
      <Link
        href="/dashboard"
        className={pathname === '/dashboard' ? 'active' : ''}
      >
        Dashboard vận hành
      </Link>
      <Link
        href="/pois"
        className={pathname?.startsWith('/pois') ? 'active' : ''}
      >
        Điểm khám phá
      </Link>
      <Link href="/field">Hiện trường</Link>
      <ReviewNavLink />
      <span>
        Media <small>Sắp có</small>
      </span>
    </nav>
  );
}
