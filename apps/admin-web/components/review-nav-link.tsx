'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fieldApi } from '@/lib/field-client';
import { AUTH_SESSION_EVENT, readAuthSession } from '@/lib/auth-session';

/** Sidebar link to the moderation queue, with the number of places waiting. */
export function ReviewNavLink() {
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => {
      if (!readAuthSession()) return setWaiting(0);
      fieldApi
        .listPois()
        .then(
          (pois) =>
            active &&
            setWaiting(
              pois.filter((poi) => poi.status === 'pending_review').length,
            ),
        )
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener(AUTH_SESSION_EVENT, load);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(AUTH_SESSION_EVENT, load);
    };
  }, []);
  return (
    <Link href="/review">
      Kiểm duyệt
      {waiting > 0 && (
        <span
          className="nav-badge"
          aria-label={`${waiting} địa điểm chờ duyệt`}
        >
          {waiting}
        </span>
      )}
    </Link>
  );
}
