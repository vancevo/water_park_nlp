'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="panel state">
      <b>Trang quản trị gặp lỗi</b>
      <p>Hãy thử tải lại phần nội dung này.</p>
      <button className="button primary" onClick={reset}>
        Thử lại
      </button>
    </div>
  );
}
