'use client';

import type {
  AuthResponse,
  GeoPoint,
  LoyaltyLedgerEntry,
  PresenceSession,
} from '@damsen/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { visitorApi } from '@/lib/api';
import {
  GATE_1_POINT,
  paidLedgerEntryIdToday,
  paidOrderId,
  simulatedGatePoint,
} from '@/lib/payment-presence';
import { acquireRealtime } from '@/lib/realtime';
import {
  PRESENCE_PUBLISH_INTERVAL_MS,
  presencePublishDelay,
} from '@/lib/presence-publish';

const HEARTBEAT_INTERVAL_MS = 20_000;
const LOYALTY_POLL_INTERVAL_MS = 2_000;

type PresenceMode = 'login' | 'device' | 'simulated' | 'manual';

export function PresenceShare({
  session,
  position,
  simulatedPosition,
  destinationPoiId,
  requestDevicePosition,
  onUseSimulation,
  onPresenceChange,
}: {
  session: AuthResponse | null;
  position: GeoPoint | null;
  simulatedPosition: GeoPoint | null;
  destinationPoiId?: string;
  requestDevicePosition(): Promise<GeoPoint>;
  onUseSimulation(position: GeoPoint): void;
  onPresenceChange(presenceId: string | null): void;
}) {
  const [presence, setPresence] = useState<PresenceSession | null>(null);
  const [mode, setMode] = useState<PresenceMode | null>(null);
  const [paymentPromptOpen, setPaymentPromptOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const latestPosition = useRef(position);
  const latestSimulatedPosition = useRef(simulatedPosition);
  const lastSent = useRef<{ position: GeoPoint; at: number } | null>(null);
  const activePresence = useRef<PresenceSession | null>(null);
  const activeMode = useRef<PresenceMode | null>(null);
  const pendingPayment = useRef<string | null>(null);
  const knownPaymentEntries = useRef<Set<string> | null>(null);
  const pageVisitId = useRef<string | null>(null);
  const publishTimer = useRef<number | null>(null);
  const publishing = useRef(false);
  const lastAttemptAt = useRef(0);
  const publishRequested = useRef(false);
  const heartbeatRequested = useRef(false);
  latestPosition.current = position;
  latestSimulatedPosition.current = simulatedPosition;
  activePresence.current = presence;
  activeMode.current = mode;

  const handledKey = session
    ? `damsen.presence.handled-payments.${session.user.id}`
    : '';
  const activeKey = session ? `damsen.presence.active.${session.user.id}` : '';

  const wasHandled = useCallback(
    (paymentId: string) => {
      if (!handledKey) return false;
      try {
        const values = JSON.parse(
          window.sessionStorage.getItem(handledKey) ?? '[]',
        ) as unknown;
        return Array.isArray(values) && values.includes(paymentId);
      } catch {
        return false;
      }
    },
    [handledKey],
  );

  const markHandled = useCallback(
    (paymentId: string) => {
      if (!handledKey) return;
      try {
        const stored = JSON.parse(
          window.sessionStorage.getItem(handledKey) ?? '[]',
        ) as unknown;
        const values = Array.isArray(stored)
          ? stored.filter((value): value is string => typeof value === 'string')
          : [];
        window.sessionStorage.setItem(
          handledKey,
          JSON.stringify([...new Set([...values, paymentId])].slice(-20)),
        );
      } catch {
        // Storage can be blocked; the in-memory pending guard still prevents repeats.
      }
    },
    [handledKey],
  );

  const requestOnboarding = useCallback(
    (paymentId: string) => {
      if (
        (activePresence.current && activeMode.current !== 'login') ||
        pendingPayment.current ||
        wasHandled(paymentId)
      ) {
        return;
      }
      pendingPayment.current = paymentId;
      setPaymentPromptOpen(true);
      setError('');
    },
    [wasHandled],
  );

  const publish = useCallback(
    async (heartbeat = false) => {
      const publishPosition =
        mode === 'login'
          ? (latestSimulatedPosition.current ?? lastSent.current?.position)
          : latestPosition.current;
      if (!session || !presence || !publishPosition) return;
      if (document.visibilityState !== 'visible') return;
      if (publishing.current) {
        publishRequested.current = true;
        heartbeatRequested.current ||= heartbeat;
        return;
      }
      const now = Date.now();
      const movementDelay = presencePublishDelay(
        lastSent.current,
        publishPosition,
        now,
        heartbeat,
      );
      if (movementDelay === null) return;
      const delay = Math.max(
        movementDelay,
        PRESENCE_PUBLISH_INTERVAL_MS - (now - lastAttemptAt.current),
      );
      if (delay > 0) {
        heartbeatRequested.current ||= heartbeat;
        publishTimer.current ??= window.setTimeout(() => {
          publishTimer.current = null;
          const queuedHeartbeat = heartbeatRequested.current;
          heartbeatRequested.current = false;
          void publish(queuedHeartbeat).catch((cause) =>
            setError(
              cause instanceof Error
                ? cause.message
                : 'Không thể chia sẻ vị trí',
            ),
          );
        }, delay);
        return;
      }
      publishing.current = true;
      lastAttemptAt.current = now;
      try {
        sequence.current += 1;
        await visitorApi.updatePresence(
          presence.id,
          {
            sessionId: presence.id,
            sequence: sequence.current,
            ...publishPosition,
            accuracyMeters: mode === 'simulated' || mode === 'login' ? 12 : 8,
            occurredAt: new Date().toISOString(),
            ...(destinationPoiId ? { destinationPoiId } : {}),
          },
          session.accessToken,
        );
        lastSent.current = { position: publishPosition, at: Date.now() };
      } finally {
        publishing.current = false;
        if (publishRequested.current) {
          publishRequested.current = false;
          const queuedHeartbeat = heartbeatRequested.current;
          heartbeatRequested.current = false;
          void publish(queuedHeartbeat).catch((cause) =>
            setError(
              cause instanceof Error
                ? cause.message
                : 'Không thể chia sẻ vị trí',
            ),
          );
        }
      }
    },
    [destinationPoiId, mode, presence, session],
  );

  useEffect(() => {
    if (!presence) return;
    void publish().catch((cause) =>
      setError(
        cause instanceof Error ? cause.message : 'Không thể chia sẻ vị trí',
      ),
    );
  }, [position, presence, publish, simulatedPosition]);

  useEffect(() => {
    if (!presence) return;
    const timer = window.setInterval(
      () => void publish(true).catch(() => undefined),
      HEARTBEAT_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [presence, publish]);

  useEffect(() => {
    pendingPayment.current = null;
    knownPaymentEntries.current = null;
    setPaymentPromptOpen(false);
    setError('');
    setMessage('');
    setPresence(null);
    onPresenceChange(null);
    setMode(null);
    sequence.current = 0;
    lastSent.current = null;
    publishRequested.current = false;
    heartbeatRequested.current = false;
    lastAttemptAt.current = 0;
    if (publishTimer.current !== null) {
      window.clearTimeout(publishTimer.current);
      publishTimer.current = null;
    }
    if (!session) {
      return;
    }
    pageVisitId.current ??= crypto.randomUUID();

    const realtime = acquireRealtime(session.accessToken);
    const { socket } = realtime;
    const onBalance = (event: Parameters<typeof paidOrderId>[0]) => {
      const orderId = paidOrderId(event);
      if (orderId) requestOnboarding(orderId);
    };
    socket.on('loyalty.balance_changed.v1', onBalance);

    let cancelled = false;
    const startLoginMarker = async () => {
      const previousId = window.sessionStorage.getItem(activeKey);
      if (previousId) {
        await visitorApi
          .stopPresenceSession(previousId, session.accessToken)
          .catch(() => undefined);
        window.sessionStorage.removeItem(activeKey);
      }
      const next = await visitorApi.startPresenceSession(
        {
          consentVersion: 'demo-login-synthetic-v1',
          shareIdentity: false,
          visibleToVisitors: true,
          locationMode: 'simulated',
        },
        session.accessToken,
      );
      const initialPoint = simulatedGatePoint(next.id);
      try {
        await visitorApi.updatePresence(
          next.id,
          {
            sessionId: next.id,
            sequence: 1,
            ...initialPoint,
            accuracyMeters: 12,
            occurredAt: new Date().toISOString(),
          },
          session.accessToken,
        );
      } catch (cause) {
        await visitorApi
          .stopPresenceSession(next.id, session.accessToken)
          .catch(() => undefined);
        throw cause;
      }
      if (cancelled) {
        await visitorApi
          .stopPresenceSession(next.id, session.accessToken)
          .catch(() => undefined);
        return;
      }
      sequence.current = 1;
      const startedAt = Date.now();
      lastSent.current = { position: initialPoint, at: startedAt };
      lastAttemptAt.current = startedAt;
      setMode('login');
      setPresence(next);
      onPresenceChange(next.id);
      window.sessionStorage.setItem(activeKey, next.id);
    };
    const refreshPayments = async () => {
      const loyalty = await visitorApi.getMyLoyalty(session.accessToken);
      if (cancelled) return;
      const paymentEntries = loyalty.entries.filter(
        (entry: LoyaltyLedgerEntry) => entry.entryType === 'payment_credit',
      );
      const nextIds = new Set(paymentEntries.map((entry) => entry.id));
      if (!knownPaymentEntries.current) {
        const paidTodayId = paidLedgerEntryIdToday(paymentEntries);
        if (paidTodayId) {
          requestOnboarding(
            `reopen:${paidTodayId}:${pageVisitId.current ?? 'current'}`,
          );
        }
      } else {
        const added = paymentEntries.find(
          (entry) => !knownPaymentEntries.current?.has(entry.id),
        );
        if (added) requestOnboarding(`ledger:${added.id}`);
      }
      knownPaymentEntries.current = nextIds;
    };
    void startLoginMarker().catch((cause) => {
      if (!cancelled) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Không thể tạo vị trí mô phỏng khi đăng nhập',
        );
      }
    });
    void refreshPayments().catch(() => undefined);
    const timer = window.setInterval(
      () => void refreshPayments().catch(() => undefined),
      LOYALTY_POLL_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      socket.off('loyalty.balance_changed.v1', onBalance);
      realtime.release();
      if (publishTimer.current !== null) {
        window.clearTimeout(publishTimer.current);
        publishTimer.current = null;
      }
      const current = activePresence.current;
      if (current) {
        void visitorApi
          .stopPresenceSession(current.id, session.accessToken)
          .catch(() => undefined);
      }
    };
  }, [activeKey, onPresenceChange, requestOnboarding, session]);

  const startAt = useCallback(
    async (
      nextMode: PresenceMode,
      requestedPoint: GeoPoint,
      accuracyMeters = 8,
    ) => {
      if (!session) throw new Error('Bạn chưa đăng nhập.');
      const previous = activePresence.current;
      const next = await visitorApi.startPresenceSession(
        {
          consentVersion: 'demo-v1',
          shareIdentity: false,
          visibleToVisitors: true,
          locationMode: nextMode === 'simulated' ? 'simulated' : 'shared',
        },
        session.accessToken,
      );
      const initialPoint =
        nextMode === 'simulated' ? simulatedGatePoint(next.id) : requestedPoint;
      try {
        await visitorApi.updatePresence(
          next.id,
          {
            sessionId: next.id,
            sequence: 1,
            ...initialPoint,
            accuracyMeters,
            occurredAt: new Date().toISOString(),
            ...(destinationPoiId ? { destinationPoiId } : {}),
          },
          session.accessToken,
        );
      } catch (cause) {
        await visitorApi
          .stopPresenceSession(next.id, session.accessToken)
          .catch(() => undefined);
        throw cause;
      }
      sequence.current = 1;
      const startedAt = Date.now();
      lastSent.current = { position: initialPoint, at: startedAt };
      lastAttemptAt.current = startedAt;
      setMode(nextMode);
      setPresence(next);
      onPresenceChange(next.id);
      window.sessionStorage.setItem(activeKey, next.id);
      if (previous && previous.id !== next.id) {
        await visitorApi
          .stopPresenceSession(previous.id, session.accessToken)
          .catch(() => undefined);
      }
      if (nextMode === 'simulated') onUseSimulation(initialPoint);
      const paymentId = pendingPayment.current;
      if (paymentId) markHandled(paymentId);
      pendingPayment.current = null;
      setPaymentPromptOpen(false);
      return next;
    },
    [
      activeKey,
      destinationPoiId,
      markHandled,
      onPresenceChange,
      onUseSimulation,
      session,
    ],
  );

  async function startSimulation(reason?: string) {
    setStarting(true);
    setError('');
    try {
      const next = await startAt('simulated', GATE_1_POINT, 12);
      setMessage(reason ?? `Đã tạo ${next.pseudonym} mô phỏng tại Cổng số 1.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Không thể tạo nhân vật mô phỏng',
      );
    } finally {
      setStarting(false);
    }
  }

  async function shareDeviceLocation() {
    setStarting(true);
    setError('');
    try {
      const point = await requestDevicePosition();
      await startAt('device', point);
      setMessage('Đang chia sẻ vị trí thiết bị với bản đồ vận hành.');
    } catch {
      setStarting(false);
      await startSimulation(
        'Không lấy được vị trí phù hợp; đã tạo nhân vật mô phỏng tại Cổng số 1.',
      );
    } finally {
      setStarting(false);
    }
  }

  async function toggle() {
    if (!session) {
      setError('Đăng nhập tài khoản demo trước khi chia sẻ vị trí.');
      return;
    }
    setError('');
    setMessage('');
    if (presence) {
      await visitorApi.stopPresenceSession(presence.id, session.accessToken);
      window.sessionStorage.removeItem(activeKey);
      setPresence(null);
      onPresenceChange(null);
      setMode(null);
      sequence.current = 0;
      lastSent.current = null;
      return;
    }
    if (!position) {
      setError('Hãy bật vị trí hoặc đặt người mô phỏng trên bản đồ trước.');
      return;
    }
    try {
      await startAt('manual', position);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Không thể bắt đầu chia sẻ',
      );
    }
  }

  return (
    <>
      <div className={`presence-share${presence ? ' active' : ''}`}>
        <button type="button" onClick={() => void toggle()}>
          {presence
            ? mode === 'login'
              ? `● ${presence.pseudonym} · mô phỏng khi đăng nhập`
              : mode === 'simulated'
                ? `● ${presence.pseudonym} · mô phỏng Cổng 1`
                : '● Đang chia sẻ vị trí demo'
            : '○ Chia sẻ vị trí với vận hành'}
        </button>
        <small>
          {presence
            ? mode === 'login'
              ? simulatedPosition
                ? 'Nhân vật đang di chuyển realtime · không phải GPS thật'
                : 'Vị trí Cổng 1 là mô phỏng · không phải GPS thật'
              : 'Tắt bất kỳ lúc nào · tự hết hạn sau 45 giây'
            : 'Tự nguyện · ẩn danh với khách khác · không lưu GPS thô'}
        </small>
        {message ? <span className="presence-message">{message}</span> : null}
        {error ? <span>{error}</span> : null}
      </div>

      {paymentPromptOpen ? (
        <div className="modal-backdrop presence-consent-backdrop">
          <section
            className="presence-consent-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="presence-consent-title"
          >
            <p className="eyebrow">Thanh toán và cộng điểm thành công</p>
            <h2 id="presence-consent-title">Bạn muốn xuất hiện ở đâu?</h2>
            <p>
              Bạn có thể tự nguyện chia sẻ vị trí hiện tại với bản đồ vận hành.
              Khách đã đăng nhập chỉ thấy biệt danh và vị trí được làm mờ; hệ
              thống chỉ giữ điểm mới nhất trong 45 giây và không lưu hành trình
              GPS thô. Trong lúc bạn chưa chọn, nhân vật mô phỏng vẫn ở Cổng số
              1 và không dùng GPS thật.
            </p>
            <div className="presence-consent-actions">
              <button
                type="button"
                className="primary"
                disabled={starting}
                onClick={() => void shareDeviceLocation()}
              >
                {starting ? 'Đang xử lý…' : 'Chia sẻ vị trí của tôi'}
              </button>
              <button
                type="button"
                disabled={starting}
                onClick={() => void startSimulation()}
              >
                Dùng nhân vật mô phỏng tại Cổng 1
              </button>
            </div>
            {error ? <div className="form-error">{error}</div> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
