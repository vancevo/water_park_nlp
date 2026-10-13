'use client';

import { useEffect, useState } from 'react';
import type { DemoPaymentOrder } from '@damsen/api-client';

import { api, formatVnd } from '@/lib/api';
import { DemoBanner } from './demo-banner';

export function DemoPayment({ token }: { token: string }) {
  const [order, setOrder] = useState<DemoPaymentOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void api
      .getDemoPayment(token)
      .then(setOrder)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'QR không hợp lệ'),
      );
  }, [token]);

  async function confirm() {
    setBusy(true);
    setError('');
    setOrder((current) => current && { ...current, status: 'processing' });
    try {
      setOrder(
        await api.confirmDemoPayment(token, {
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Mô phỏng thất bại');
      void api
        .getDemoPayment(token)
        .then(setOrder)
        .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-shell narrow">
      <DemoBanner />
      <section className="card payment-card">
        <p className="eyebrow">Trang được mở từ QR</p>
        <h1>Thanh toán demo</h1>
        {!order && !error && <p>Đang tải giao dịch…</p>}
        {order && (
          <>
            <span className={`status ${order.status}`}>{order.status}</span>
            <div className="summary-list">
              {order.items.map((item) => (
                <div key={item.ticketProductId}>
                  <span>
                    {item.name} × {item.quantity}
                  </span>
                  <strong>{formatVnd(item.subtotalVnd)}</strong>
                </div>
              ))}
            </div>
            <div className="total">
              <span>Tổng mô phỏng</span>
              <strong>{formatVnd(order.totalAmountVnd)}</strong>
            </div>
            <p className="points">
              Tài khoản {order.phoneMasked} sẽ nhận{' '}
              <strong>{order.totalPoints} điểm</strong>.
            </p>
            {order.status === 'pending' && (
              <button disabled={busy} onClick={confirm}>
                Thanh toán demo
              </button>
            )}
            {order.status === 'processing' && (
              <div className="processing">
                <span className="spinner" />
                Đang mô phỏng xử lý…
              </div>
            )}
            {order.status === 'succeeded' && (
              <div className="success">
                <strong>Thành công</strong>
                <span>
                  Điểm đã được cộng. Bạn có thể quay lại web hướng dẫn.
                </span>
              </div>
            )}
            {['failed', 'expired', 'cancelled'].includes(order.status) && (
              <p className="error">
                Giao dịch demo không hoàn tất: {order.status}.
              </p>
            )}
          </>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
