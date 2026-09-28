import type {
  AuthResponse,
  AuthUser,
  LoginRequest,
  RegisterRequest,
} from '@damsen/api-client';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  user: AuthUser;
}

export interface SessionStore {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

export interface AuthClient {
  login(input: LoginRequest): Promise<AuthResponse>;
  register(input: RegisterRequest): Promise<AuthResponse>;
  refresh(refreshToken: string): Promise<AuthResponse>;
  logout(refreshToken: string): Promise<void>;
}

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'login_failed'
  | 'registration_failed'
  | 'session_expired'
  | 'logout_failed'
  | 'storage_failed';

export type AuthSnapshot =
  | { status: 'restoring'; error: null }
  | { status: 'guest'; error: AuthErrorCode | null }
  | {
      status: 'authenticating';
      operation: 'login' | 'register';
      error: null;
    }
  | {
      status: 'authenticated';
      user: AuthUser;
      accessToken: string;
      accessTokenExpiresAt: number;
      isRefreshing: boolean;
      error: AuthErrorCode | null;
    };
