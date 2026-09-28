import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuthSessionPanel } from './auth-session-panel';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span>DS</span>
          <strong>Đầm Sen Guide</strong>
        </Link>
        <nav>
          <Link href="/pois" className="active">
            Điểm khám phá
          </Link>
          <span>
            Kiểm duyệt <small>Sắp có</small>
          </span>
          <span>
            Media <small>Sắp có</small>
          </span>
        </nav>
        <AuthSessionPanel />
        <div className="role-note">
          <strong>Vai trò hiển thị: Editor</strong>
          <p>
            UI chỉ gợi ý quyền. API phải xác thực và áp dụng RBAC cho mọi thao
            tác.
          </p>
        </div>
      </aside>
      <main className="content">
        <header>
          <div>
            <b>Trang quản trị nội dung</b>
            <span>Đầm Sen • VI / EN</span>
          </div>
          <div className="avatar">ED</div>
        </header>
        {children}
      </main>
    </div>
  );
}
