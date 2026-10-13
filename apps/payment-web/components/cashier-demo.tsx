'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuthResponse,
  CashierCustomerLookup,
  DemoPaymentOrder,
  RealtimeEvent,
  TicketProduct,
} from '@damsen/api-client';
import { RealtimeInvalidationGate } from '@damsen/api-client';
import QRCode from 'qrcode';

import { api, formatVnd } from '@/lib/api';
import { connectRealtime } from '@/lib/realtime';
import { DemoBanner } from './demo-banner';

const SESSION_KEY = 'damsen.payment.demo.session';
const ORDER_KEY = 'damsen.payment.demo.active-order';

function preserveQrUrl(
  current: DemoPaymentOrder | null,
  next: DemoPaymentOrder,
): DemoPaymentOrder {
  return current?.id === next.id && current.qrUrl && !next.qrUrl
    ? { ...next, qrUrl: current.qrUrl }
    : next;
}

export function CashierDemo() {
  const [session, setSession] = useState<AuthResponse | null>(null);
  const [email, setEmail] = useState('admin@damsen.local');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('0901234567');
  const [customer, setCustomer] = useState<CashierCustomerLookup | null>(null);
  const [products, setProducts] = useState<TicketProduct[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<DemoPaymentOrder | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [qrImage, setQrImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const creating = useRef(false);
  const realtimeGate = useRef(new RealtimeInvalidationGate());

  useEffect(() => {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (raw) setSession(JSON.parse(raw) as AuthResponse);
  }, []);

  useEffect(() => {
    if (!session) return;
    const activeOrderId = window.sessionStorage.getItem(ORDER_KEY);
    void Promise.all([
      api.listTicketProducts(session.accessToken).then(setProducts),
      activeOrderId
        ? api
            .getCashierDemoPaymentOrder(activeOrderId, session.accessToken)
            .then(setOrder)
        : Promise.resolve(),
    ]).catch((cause) =>
      setError(
        cause instanceof Error ? cause.message : 'Không tải được dữ liệu quầy',
      ),
    );
  }, [session]);

  useEffect(() => {
    if (!order || order.status !== 'pending') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [order]);

  useEffect(() => {
    if (!qrUrl) {
      setQrImage('');
      return;
    }
    void QRCode.toDataURL(qrUrl, { width: 280, margin: 2 }).then(setQrImage);
  }, [qrUrl]);

  useEffect(() => {
    if (!session || !order || !['pending', 'processing'].includes(order.status))
      return;
    const timer = window.setInterval(() => {
      void api
        .getCashierDemoPaymentOrder(order.id, session.accessToken)
        .then((next) => {
          setOrder((current) => preserveQrUrl(current, next));
          if (next.status === 'succeeded') {
            void api
              .lookupCashierCustomer({ phone }, session.accessToken)
              .then(setCustomer)
              .catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [order, phone, session]);

  useEffect(() => {
    if (!session || !order) return;
    const socket = connectRealtime(session.accessToken);
    const subscribe = () => {
      realtimeGate.current.reset();
      socket.emit('order.subscribe.v1', { orderId: order.id });
      void api
        .getCashierDemoPaymentOrder(order.id, session.accessToken)
        .then((next) => setOrder((current) => preserveQrUrl(current, next)))
        .catch(() => undefined);
    };
    const onPayment = (
      event: RealtimeEvent<DemoPaymentOrder | { orderId?: string }>,
    ) => {
      const matches =
        ('id' in event.payload && event.payload.id === order.id) ||
        ('orderId' in event.payload && event.payload.orderId === order.id);
      if (!matches || !realtimeGate.current.accept(event, order.id)) return;
      void api
        .getCashierDemoPaymentOrder(order.id, session.accessToken)
        .then((snapshot) => {
          setOrder((current) => preserveQrUrl(current, snapshot));
          if (snapshot.status === 'succeeded') {
            void api
              .lookupCashierCustomer({ phone }, session.accessToken)
              .then(setCustomer)
              .catch(() => undefined);
          }
        })
        .catch(() => undefined);
    };
    socket.on('connect', subscribe);
    socket.on('payment.status.v1', onPayment);
    return () => {
      socket.off('connect', subscribe);
      socket.off('payment.status.v1', onPayment);
      socket.disconnect();
    };
  }, [order?.id, phone, session]);

  const selected = useMemo(
    () =>
      products
        .map((product) => ({ product, quantity: quantities[product.id] ?? 0 }))
        .filter((item) => item.quantity > 0),
    [products, quantities],
  );

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const next = await api.login({ email, password });
      if (
        !next.user.roles.some((role) => role === 'CASHIER' || role === 'ADMIN')
      ) {
        throw new Error('Tài khoản không có quyền CASHIER');
      }
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      setSession(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Đăng nhập thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError('');
    setOrder(null);
    setQrUrl('');
    try {
      setCustomer(
        await api.lookupCashierCustomer({ phone }, session.accessToken),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Không tìm được tài khoản demo',
      );
    } finally {
      setBusy(false);
    }
  }

  async function createOrder() {
    if (!session || !customer || selected.length === 0 || creating.current)
      return;
    creating.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await api.createDemoPaymentOrder(
        {
          customerToken: customer.customerToken,
          idempotencyKey: crypto.randomUUID(),
          items: selected.map(({ product, quantity }) => ({
            ticketProductId: product.id,
            quantity,
          })),
        },
        session.accessToken,
      );
      window.sessionStorage.setItem(ORDER_KEY, next.id);
      setQrUrl(next.qrUrl ?? '');
      setOrder(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Không tạo được QR demo',
      );
    } finally {
      creating.current = false;
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <main className="page-shell narrow">
        <DemoBanner />
        <section className="card">
          <p className="eyebrow">Ứng dụng quầy vé</p>
          <h1>Đăng nhập nhân viên</h1>
          <form onSubmit={login} className="stack">
            <label>
              Email
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
              />
            </label>
            <label>
              Mật khẩu
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
              />
            </label>
            <button disabled={busy}>Đăng nhập</button>
          </form>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <DemoBanner />
      <header className="hero">
        <div>
          <p className="eyebrow">Ứng dụng quầy vé</p>
          <h1>QR & điểm thưởng demo</h1>
        </div>
        <button
          className="secondary"
          onClick={() => {
            window.sessionStorage.removeItem(SESSION_KEY);
            setSession(null);
          }}
        >
          Đăng xuất
        </button>
      </header>
      <div className="grid">
        <section className="card">
          <h2>1. Tài khoản khách</h2>
          <form onSubmit={lookup} className="row-form">
            <input
              aria-label="Số điện thoại"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="0901234567"
            />
            <button disabled={busy}>Tiếp tục</button>
          </form>
          {customer && (
            <div className="customer">
              <strong>{customer.phoneMasked}</strong>
              <span>{customer.pointsBalance} điểm hiện có</span>
            </div>
          )}

          <h2>2. Chọn vé demo</h2>
          <div className="ticket-list">
            {products.map((product) => (
              <label className="ticket" key={product.id}>
                <span>
                  <strong>{product.name}</strong>
                  <small>
                    {formatVnd(product.amountVnd)} · +{product.pointsPerItem}{' '}
                    điểm
                  </small>
                </span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={quantities[product.id] ?? 0}
                  onChange={(event) =>
                    setQuantities((current) => ({
                      ...current,
                      [product.id]: Number(event.target.value),
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <button
            disabled={busy || !customer || selected.length === 0}
            onClick={createOrder}
          >
            Tạo QR mô phỏng
          </button>
          {error && <p className="error">{error}</p>}
        </section>

        <section className="card qr-card">
          <h2>3. Quét QR</h2>
          {!order && (
            <p className="muted">
              QR sẽ xuất hiện sau khi chọn tài khoản và vé.
            </p>
          )}
          {order && (
            <>
              <span className={`status ${order.status}`}>{order.status}</span>
              {qrImage && order.status === 'pending' && (
                <img
                  className="qr"
                  src={qrImage}
                  alt="QR mở trang thanh toán mô phỏng"
                />
              )}
              {order.status === 'pending' && (
                <p className="countdown">
                  QR hết hạn sau{' '}
                  {Math.max(
                    0,
                    Math.ceil(
                      (new Date(order.qrExpiresAt).getTime() - now) / 1_000,
                    ),
                  )}{' '}
                  giây
                </p>
              )}
              <p>
                <strong>{formatVnd(order.totalAmountVnd)}</strong> · +
                {order.totalPoints} điểm
              </p>
              {qrUrl && (
                <a href={qrUrl} target="_blank" rel="noreferrer">
                  Mở trang quét trên máy này
                </a>
              )}
              {order.status === 'succeeded' && (
                <div className="success">
                  <strong>Giao dịch mô phỏng thành công</strong>
                  <span>Điểm đã được cộng cho {order.phoneMasked}.</span>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
