'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getPoiClient } from '@/lib/api-poi-client';
import { poiToDraft, type Poi } from '@/lib/poi-contract';
import { PoiForm } from './poi-form';
const clientPromise = getPoiClient();
export function PoiEditLoader({ id }: { id: string }) {
  const [poi, setPoi] = useState<Poi>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    setPoi(undefined);
    clientPromise
      .then((client) => client.get(id))
      .then((item) => active && setPoi(item))
      .catch(
        (cause: unknown) =>
          active &&
          setError(
            cause instanceof Error ? cause.message : 'Không thể tải POI.',
          ),
      );
    return () => {
      active = false;
    };
  }, [id, attempt]);
  if (error)
    return (
      <div className="panel state">
        <b>Không thể mở POI</b>
        <p>{error}</p>
        <div className="button-row">
          <button
            className="button primary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Thử lại
          </button>
          <Link className="button ghost" href="/pois">
            Về danh sách
          </Link>
        </div>
      </div>
    );
  if (!poi)
    return (
      <div className="panel state">
        <div className="spinner" />
        Đang tải nội dung POI…
      </div>
    );
  return <PoiForm id={id} initial={poiToDraft(poi)} current={poi} />;
}
