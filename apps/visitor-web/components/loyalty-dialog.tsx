'use client';

import type {
  AuthResponse,
  LoyaltyAccountSummary,
  RewardCatalogItem,
  RealtimeEvent,
} from '@damsen/shared-types';
import { RealtimeInvalidationGate } from '@damsen/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { visitorApi } from '@/lib/api';
import { acquireRealtime } from '@/lib/realtime';

export function LoyaltyDialog({
  session,
  onClose,
  onLogout,
}: {
  session: AuthResponse;
  onClose(): void;
  onLogout(): void;
}) {
  const [account, setAccount] = useState<LoyaltyAccountSummary | null>(null);
  const [rewards, setRewards] = useState<RewardCatalogItem[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busyReward, setBusyReward] = useState<string | null>(null);
  const previousBalance = useRef<number | null>(null);
  const realtimeGate = useRef(new RealtimeInvalidationGate());

  const refresh = useCallback(async () => {
    const next = await visitorApi.getMyLoyalty(session.accessToken);
    if (
      previousBalance.current !== null &&
      next.balance > previousBalance.current
    ) {
      setMessage(
        `Thanh toán demo thành công · +${next.balance - previousBalance.current} điểm`,
      );
    }
    previousBalance.current = next.balance;
    setAccount(next);
  }, [session.accessToken]);

  useEffect(() => {
    void Promise.all([
      refresh(),
      visitorApi.listRewards().then(setRewards),
    ]).catch((cause) =>
      setError(
        cause instanceof Error ? cause.message : 'Không tải được điểm thưởng',
      ),
    );
    const timer = window.setInterval(
      () => void refresh().catch(() => undefined),
      2_000,
    );
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const realtime = acquireRealtime(session.accessToken);
    const { socket } = realtime;
    const refreshSnapshot = () => {
      realtimeGate.current.reset();
      void refresh().catch(() => undefined);
    };
    const onBalance = (event: RealtimeEvent) => {
      if (realtimeGate.current.accept(event)) {
        void refresh().catch(() => undefined);
      }
    };
    socket.on('connect', refreshSnapshot);
    socket.on('loyalty.balance_changed.v1', onBalance);
    return () => {
      socket.off('connect', refreshSnapshot);
      socket.off('loyalty.balance_changed.v1', onBalance);
      realtime.release();
    };
  }, [refresh, session.accessToken]);

  async function redeem(reward: RewardCatalogItem) {
    setBusyReward(reward.id);
    setError('');
    setMessage('');
    try {
      const result = await visitorApi.createRewardRedemption(
        { rewardId: reward.id, idempotencyKey: crypto.randomUUID() },
        session.accessToken,
      );
      setMessage(`Đổi quà thành công · mã nhận quà ${result.fulfillmentCode}`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không đổi được quà');
    } finally {
      setBusyReward(null);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="loyalty-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loyalty-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="close-button" onClick={onClose} aria-label="Đóng">
          ×
        </button>
        <p className="eyebrow">Tài khoản demo · không xác minh OTP</p>
        <h2 id="loyalty-title">
          Điểm của {account?.phoneMasked ?? session.user.phoneMasked}
        </h2>
        <div className="loyalty-balance">
          <strong>{account?.balance ?? '…'}</strong>
          <span>điểm hiện có</span>
        </div>
        <p className="loyalty-live-note">
          Tự cập nhật sau vài giây khi quầy vé hoàn tất thanh toán mô phỏng.
        </p>
        {message ? (
          <div className="loyalty-success" role="status">
            {message}
          </div>
        ) : null}
        {error ? <div className="form-error">{error}</div> : null}

        <h3>Đổi quà</h3>
        <div className="reward-list">
          {rewards.map((reward) => (
            <div className="reward-item" key={reward.id}>
              <span>
                <strong>{reward.name}</strong>
                <small>{reward.pointsCost} điểm</small>
              </span>
              <button
                type="button"
                disabled={
                  busyReward !== null ||
                  !account ||
                  account.balance < reward.pointsCost
                }
                onClick={() => void redeem(reward)}
              >
                {busyReward === reward.id ? 'Đang đổi…' : 'Đổi quà'}
              </button>
            </div>
          ))}
        </div>

        <h3>Lịch sử gần đây</h3>
        <div className="loyalty-history">
          {account?.entries.length ? (
            account.entries.map((entry) => (
              <div key={entry.id}>
                <span>
                  <strong>{entry.description}</strong>
                  <small>
                    {new Date(entry.createdAt).toLocaleString('vi-VN')}
                  </small>
                </span>
                <b className={entry.delta >= 0 ? 'positive' : 'negative'}>
                  {entry.delta >= 0 ? '+' : ''}
                  {entry.delta}
                </b>
              </div>
            ))
          ) : (
            <p>Chưa có giao dịch điểm.</p>
          )}
        </div>
        <button type="button" className="text-action" onClick={onLogout}>
          Đăng xuất tài khoản
        </button>
      </section>
    </div>
  );
}
