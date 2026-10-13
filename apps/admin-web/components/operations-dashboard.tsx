'use client';

import { DamSenApiClient, RealtimeInvalidationGate } from '@damsen/api-client';
import type {
  AdminPaymentFeedResponse,
  AdminPresencePoint,
  AdminPresenceSnapshot,
  DashboardSummary,
  DashboardTraffic,
  RealtimeEvent,
} from '@damsen/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiBase } from '@/lib/api-poi-client';
import { readAuthSession } from '@/lib/auth-session';
import { connectRealtime } from '@/lib/realtime';
import { LivePresenceMap } from './live-presence-map';

const api = new DamSenApiClient({ baseUrl: apiBase });
const money = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

export function OperationsDashboard() {
  const realtimeGate = useRef(new RealtimeInvalidationGate());
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [traffic, setTraffic] = useState<DashboardTraffic | null>(null);
  const [payments, setPayments] = useState<AdminPaymentFeedResponse | null>(
    null,
  );
  const [loadingMorePayments, setLoadingMorePayments] = useState(false);
  const [presence, setPresence] = useState<AdminPresenceSnapshot>({
    generatedAt: '',
    items: [],
  });
  const [error, setError] = useState('');
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const reportRefreshError = useCallback((cause: unknown) => {
    setError(
      cause instanceof Error ? cause.message : 'Không tải được dashboard',
    );
  }, []);

  const refresh = useCallback(async () => {
    const session = readAuthSession();
    if (!session)
      throw new Error('Đăng nhập ADMIN hoặc OPERATIONS để xem dashboard.');
    if (
      !session.user.roles.some(
        (role) => role === 'ADMIN' || role === 'OPERATIONS',
      )
    ) {
      throw new Error('Phiên hiện tại không có quyền OPERATIONS.');
    }
    const [nextSummary, nextTraffic, nextPresence] = await Promise.all([
      api.getOperationsDashboard(session.accessToken),
      api.getOperationsTraffic(session.accessToken),
      api.getAdminPresence(session.accessToken),
    ]);
    setSummary(nextSummary);
    setTraffic(nextTraffic);
    setPresence(nextPresence);
    setError('');
  }, []);

  const refreshPayments = useCallback(async () => {
    const session = readAuthSession();
    if (!session) throw new Error('Đăng nhập để xem giao dịch gần đây.');
    const firstPage = await api.getRecentPayments(session.accessToken, {
      limit: 8,
    });
    setPayments((current) => mergePaymentFirstPage(firstPage, current));
  }, []);

  const loadMorePayments = useCallback(async () => {
    const session = readAuthSession();
    if (!session || !payments?.nextCursor || loadingMorePayments) return;
    setLoadingMorePayments(true);
    try {
      const nextPage = await api.getRecentPayments(session.accessToken, {
        limit: 8,
        cursor: payments.nextCursor,
      });
      setPayments((current) => ({
        items: [
          ...(current?.items ?? []),
          ...nextPage.items.filter(
            (item) =>
              !current?.items.some((currentItem) => currentItem.id === item.id),
          ),
        ],
        ...(nextPage.nextCursor ? { nextCursor: nextPage.nextCursor } : {}),
      }));
    } catch (cause) {
      reportRefreshError(cause);
    } finally {
      setLoadingMorePayments(false);
    }
  }, [loadingMorePayments, payments?.nextCursor, reportRefreshError]);

  useEffect(() => {
    void refresh().catch(reportRefreshError);
    void refreshPayments().catch(reportRefreshError);
    const timer = window.setInterval(() => {
      void refresh().catch(reportRefreshError);
      void refreshPayments().catch(reportRefreshError);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [refresh, refreshPayments, reportRefreshError]);

  useEffect(() => {
    const session = readAuthSession();
    if (!session) return;
    const socket = connectRealtime(session.accessToken);
    const presenceDeltas = new Map<string, AdminPresencePoint | null>();
    let animationFrame: number | undefined;
    const refreshSnapshot = () => {
      realtimeGate.current.reset();
      setRealtimeConnected(true);
      void refresh().catch(reportRefreshError);
      void refreshPayments().catch(reportRefreshError);
    };
    const markDisconnected = () => setRealtimeConnected(false);
    const refreshDelta = (event: RealtimeEvent) => {
      if (!realtimeGate.current.accept(event)) return;
      void refresh().catch(reportRefreshError);
      void refreshPayments().catch(reportRefreshError);
    };
    const flushPresence = () => {
      animationFrame = undefined;
      setPresence((current) => {
        const items = new Map(
          current.items.map((point) => [point.sessionId, point]),
        );
        for (const [sessionId, point] of presenceDeltas) {
          if (point) items.set(sessionId, point);
          else items.delete(sessionId);
        }
        presenceDeltas.clear();
        return {
          generatedAt: new Date().toISOString(),
          items: [...items.values()],
        };
      });
    };
    const applyPresenceDelta = (
      event: RealtimeEvent<
        AdminPresencePoint | { sessionId: string; removed: true }
      >,
    ) => {
      if (!event.payload.sessionId || !realtimeGate.current.accept(event)) {
        return;
      }
      presenceDeltas.set(
        event.payload.sessionId,
        'removed' in event.payload ? null : event.payload,
      );
      animationFrame ??= window.requestAnimationFrame(flushPresence);
    };
    socket.on('connect', refreshSnapshot);
    socket.on('disconnect', markDisconnected);
    socket.on('dashboard.delta.v1', refreshDelta);
    socket.on('presence.delta.v1', applyPresenceDelta);
    return () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
      socket.disconnect();
    };
  }, [refresh, refreshPayments, reportRefreshError]);

  const maxTraffic = Math.max(
    1,
    ...(traffic?.items.map((item) => item.uniqueVisitors) ?? []),
  );
  const freshness = dashboardFreshness(summary, error);
  return (
    <section className="operations-dashboard">
      <div className="page-title">
        <div>
          <p className="eyebrow">Vận hành thời gian thực</p>
          <h1>Dashboard hôm nay</h1>
        </div>
        <div className="dashboard-status" aria-live="polite">
          <span className={`live-pill ${freshness.tone}`}>
            ● {freshness.label}
          </span>
          <small>
            {realtimeConnected ? 'Realtime + snapshot' : 'Polling 2 giây'}
            {summary?.generatedAt
              ? ` · cập nhật ${formatTimeWithSeconds(summary.generatedAt)}`
              : ''}
          </small>
        </div>
      </div>
      {error ? <div className="dashboard-error">{error}</div> : null}
      <div className="metric-grid">
        <Metric
          label="Khách hoạt động hôm nay"
          value={summary?.activeVisitorsToday ?? '—'}
        />
        <Metric
          label="Khách đã thanh toán"
          value={summary?.payingUsersToday ?? '—'}
        />
        <Metric
          label="Đang online trên bản đồ"
          value={summary?.onlineNow ?? '—'}
        />
        <Metric
          label="Doanh thu demo hôm nay"
          value={
            summary ? money.format(summary.simulatedRevenue.todayVnd) : '—'
          }
        />
      </div>
      <div className="revenue-grid">
        <Metric
          label="Hôm qua"
          value={
            summary ? money.format(summary.simulatedRevenue.yesterdayVnd) : '—'
          }
          compact
        />
        <Metric
          label="Tuần này"
          value={summary ? money.format(summary.simulatedRevenue.weekVnd) : '—'}
          compact
        />
        <Metric
          label="Tháng này"
          value={
            summary ? money.format(summary.simulatedRevenue.monthVnd) : '—'
          }
          compact
        />
      </div>
      <div className="dashboard-grid">
        <article className="dashboard-card">
          <div className="card-heading">
            <div>
              <h2>Thời gian đông / vắng</h2>
              <p>
                Số khách duy nhất theo mỗi 15 phút; nhóm dưới 3 người được ẩn vì
                riêng tư.
              </p>
            </div>
          </div>
          <div className="traffic-highlights">
            <span>
              Đông nhất{' '}
              <strong>
                {traffic?.peak
                  ? formatTime(traffic.peak.startsAt)
                  : 'Chưa đủ dữ liệu'}
              </strong>
            </span>
            <span>
              Vắng nhất{' '}
              <strong>
                {traffic?.quiet
                  ? formatTime(traffic.quiet.startsAt)
                  : 'Chưa đủ dữ liệu'}
              </strong>
            </span>
          </div>
          <div className="traffic-chart">
            {traffic?.items.length ? (
              traffic.items.slice(-24).map((item) => (
                <div
                  key={item.startsAt}
                  title={`${formatTime(item.startsAt)} · ${item.uniqueVisitors} khách`}
                >
                  <span
                    style={{
                      height: `${Math.max(3, (item.uniqueVisitors / maxTraffic) * 100)}%`,
                    }}
                  />
                  <small>{formatTime(item.startsAt)}</small>
                </div>
              ))
            ) : (
              <p>Chưa có dữ liệu chia sẻ vị trí hôm nay.</p>
            )}
          </div>
        </article>
        <article className="dashboard-card map-card">
          <div className="card-heading">
            <div>
              <h2>Bản đồ khách đang hoạt động</h2>
              <p>
                User đăng nhập hiện ở Cổng 1 mô phỏng; GPS thật chỉ hiển thị khi
                khách đồng ý. Điểm tự hết hạn sau 45 giây.
              </p>
            </div>
            <strong>{presence.items.length} người</strong>
          </div>
          <LivePresenceMap points={presence.items} />
          <div className="presence-legend" aria-label="Chú thích trạng thái vé">
            <span>
              <i className="paid" /> Đã mua vé
            </span>
            <span>
              <i className="unpaid" /> Chưa mua vé
            </span>
          </div>
          {presence.items.length ? (
            <div
              className="presence-roster"
              aria-label="Danh sách user đang đăng nhập"
            >
              {presence.items.map((point) => (
                <div className="presence-roster-row" key={point.sessionId}>
                  <span
                    className={`presence-avatar variant-${point.avatarVariant}`}
                    aria-hidden="true"
                  />
                  <strong>{point.pseudonym}</strong>
                  <span
                    className={`ticket-state ${point.hasPaidTicket ? 'paid' : 'unpaid'}`}
                  >
                    {point.hasPaidTicket ? 'Đã mua vé' : 'Chưa mua vé'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="presence-empty">
              Chưa có user đăng nhập đang hoạt động.
            </p>
          )}
        </article>
      </div>
      <article className="dashboard-card payment-feed-card">
        <div className="card-heading">
          <div>
            <h2>Giao dịch demo gần đây</h2>
            <p>
              Số điện thoại luôn được che; danh sách mới nhất hiển thị trước.
            </p>
          </div>
          <strong>{payments?.items.length ?? 0} giao dịch</strong>
        </div>
        {payments?.items.length ? (
          <div className="payment-feed-list">
            {payments.items.map((payment) => (
              <div className="payment-feed-row" key={payment.id}>
                <div>
                  <strong>{payment.phoneMasked}</strong>
                  <small>
                    {payment.ticketQuantity} vé ·{' '}
                    {payment.productNames.join(', ')}
                  </small>
                </div>
                <div>
                  <strong>{money.format(payment.totalAmountVnd)}</strong>
                  <small>+{payment.totalPoints} điểm</small>
                </div>
                <div>
                  <span className={`payment-status ${payment.status}`}>
                    {paymentStatusLabel(payment.status)}
                  </span>
                  <small>
                    {formatDateTime(payment.paidAt ?? payment.createdAt)}
                  </small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="payment-feed-empty">Chưa có giao dịch demo.</p>
        )}
        {payments?.nextCursor ? (
          <button
            className="payment-feed-more"
            disabled={loadingMorePayments}
            onClick={() => void loadMorePayments()}
            type="button"
          >
            {loadingMorePayments ? 'Đang tải…' : 'Xem thêm'}
          </button>
        ) : null}
      </article>
      <p className="dashboard-footnote">
        Mọi số tiền trong màn hình này là giao dịch mô phỏng, không phải doanh
        thu thật. Múi giờ Asia/Ho_Chi_Minh.
      </p>
    </section>
  );
}

function Metric({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string | number;
  compact?: boolean;
}) {
  return (
    <article className={`metric-card${compact ? ' compact' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

function formatTimeWithSeconds(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

function paymentStatusLabel(status: string) {
  return (
    {
      pending: 'Chờ quét',
      processing: 'Đang xử lý',
      succeeded: 'Thành công',
      failed: 'Thất bại',
      expired: 'Hết hạn',
      cancelled: 'Đã hủy',
    }[status] ?? status
  );
}

function mergePaymentFirstPage(
  firstPage: AdminPaymentFeedResponse,
  current: AdminPaymentFeedResponse | null,
): AdminPaymentFeedResponse {
  if (!current || current.items.length <= firstPage.items.length) {
    return firstPage;
  }
  const firstIds = new Set(firstPage.items.map((item) => item.id));
  return {
    items: [
      ...firstPage.items,
      ...current.items.filter((item) => !firstIds.has(item.id)),
    ],
    ...(current.nextCursor ? { nextCursor: current.nextCursor } : {}),
  };
}

function dashboardFreshness(summary: DashboardSummary | null, error: string) {
  if (error) return { label: 'Lỗi tải dữ liệu', tone: 'error' };
  if (!summary) return { label: 'Đang tải dữ liệu', tone: 'loading' };
  if (summary.dataStatus === 'partial') {
    return { label: 'Dữ liệu một phần', tone: 'delayed' };
  }
  const generatedAt = new Date(summary.generatedAt).getTime();
  const ageMs = Date.now() - generatedAt;
  if (
    summary.dataStatus === 'delayed' ||
    !Number.isFinite(ageMs) ||
    ageMs > 5_000
  ) {
    return { label: 'Dữ liệu đang trễ', tone: 'delayed' };
  }
  return { label: 'Dữ liệu trực tiếp', tone: 'live' };
}
