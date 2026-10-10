'use client';
import { DamSenApiClient } from '@damsen/api-client';
import { useEffect, useState } from 'react';
import { apiBase } from '@/lib/api-poi-client';
import {
  AUTH_SESSION_EVENT,
  clearAuthSession,
  readAuthSession,
  saveAuthSession,
  type AdminAuthSession,
} from '@/lib/auth-session';

const authApi = new DamSenApiClient({ baseUrl: apiBase });
export function AuthSessionPanel() {
  const [session, setSession] = useState<AdminAuthSession | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const sync = () => setSession(readAuthSession());
    sync();
    window.addEventListener(AUTH_SESSION_EVENT, sync);
    return () => window.removeEventListener(AUTH_SESSION_EVENT, sync);
  }, []);
  async function login() {
    setLoading(true);
    setError('');
    try {
      const response = await authApi.login({ email, password });
      saveAuthSession({
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        accessTokenExpiresAt: Date.now() + response.accessTokenExpiresIn * 1000,
        user: response.user,
      });
      setPassword('');
      window.location.reload();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Đăng nhập thất bại.',
      );
    } finally {
      setLoading(false);
    }
  }
  if (session)
    return (
      <div className="auth-session">
        <b>{session.user.email}</b>
        <small>{session.user.roles.join(' · ')}</small>
        <button
          onClick={() => {
            clearAuthSession();
            window.location.reload();
          }}
        >
          Xóa phiên
        </button>
      </div>
    );
  return (
    <div className="auth-session">
      <b>Phiên quản trị MVP</b>
      <input
        aria-label="Email quản trị"
        type="email"
        placeholder="admin@damsen.local"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        aria-label="Mật khẩu quản trị"
        type="password"
        placeholder="Mật khẩu"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button disabled={loading || !email || !password} onClick={login}>
        {loading ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </button>
      {error && <small className="field-error">{error}</small>}
      <small>
        Access token chỉ lưu trong sessionStorage và mất khi đóng tab.
      </small>
    </div>
  );
}
