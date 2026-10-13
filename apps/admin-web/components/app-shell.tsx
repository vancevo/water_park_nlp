import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuthSessionPanel } from './auth-session-panel';
import { AdminNav } from './admin-nav';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span>DS</span>
          <strong>Đầm Sen Guide</strong>
        </Link>
        <AdminNav />
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
            <span>Đầm Sen • Nội dung VI / EN · Thuyết minh theo cấu hình</span>
          </div>
          <div className="avatar">ED</div>
        </header>
        {children}
      </main>
    </div>
  );
}
