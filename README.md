# Dam Sen Smart Guide

Monorepo TypeScript cho ứng dụng hướng dẫn và dẫn đường tại Công viên Đầm Sen.

## Yêu cầu

- Node.js 24.x (`nvm use 24`)
- npm 11.x

## Kiến trúc và tài liệu

- [Kế hoạch sản phẩm và kiến trúc](PROJECT_PLAN.md)
- [Kế hoạch thực thi theo agent](docs/AGENT_EXECUTION_PLAN.md)
- [Checklist/trạng thái](docs/STATUS.md)
- [Registry để tái sử dụng feature](docs/FEATURE_REGISTRY.md)
- [Phạm vi MVP](docs/product/MVP_SCOPE.md)

Project dùng monorepo npm: NestJS API, Next.js visitor web + admin web, prototype
Expo/React Native, worker cho embedding, PostgreSQL với
PostGIS/pgRouting/pgvector, Redis và MinIO. Visitor web là client chính theo
ADR-0006; mobile native chỉ còn là prototype tham khảo.

## Chạy demo một chạm (Windows)

Xem [`demo/HUONG-DAN-DEMO.md`](demo/HUONG-DAN-DEMO.md): cài Node.js 24 +
Docker Desktop + Python, rồi bấm đúp `demo/1-CAI-DAT-LAN-DAU.cmd` (một lần) và
`demo/2-CHAY-DEMO.cmd`. Lệnh tương đương: `node scripts/demo/demo.mjs
setup|start|stop|status`.

## Khởi động local

```bash
source ~/.nvm/nvm.sh
nvm use 24
npm install
docker compose -f infra/docker/docker-compose.yml up -d
cp .env.example .env
set -a
source .env
set +a
npm run db:migrate
npm run dev:api
# terminal khác, khi API đã chạy: nạp đồ thị đường đi + 50 địa điểm của bản đồ (xem dưới)
ADMIN_PASSWORD="$DEV_ADMIN_PASSWORD" npm run seed:park
npm run dev:visitor
```

**Quan trọng:** migration chỉ nạp 5 địa điểm giả để test. 50 địa điểm của bản đồ và đồ thị đường đi
nằm trong database, không nằm trong repo (nội dung mô tả/thuyết minh của các địa điểm cũng vậy: `data/pois/poi-content.source.txt` → `scripts/import-poi-content.mjs`), nên sau khi kéo code phải chạy `npm run seed:park`
(cần API đang chạy và tài khoản admin; chạy lại nhiều lần vẫn an toàn). Chạy demo một chạm
(`demo.mjs start`) đã tự gọi bước này. Không có `DATABASE_URL` thì API dùng bộ nhớ tạm chỉ có 5 địa điểm giả.

Nạp biến từ `.env` theo cách phù hợp với shell/process manager trước khi chạy
API với database. Visitor web mặc định ở `http://localhost:3002` và admin ở
`http://localhost:3001`. Nếu không có `DATABASE_URL`, API dùng repository in-memory để
phát triển và test. API mặc định ở `http://localhost:3000`; kiểm tra bằng
`GET /health`.

Trong development, `DEV_SEED_ADMIN=true` tạo tài khoản `ADMIN` từ
`DEV_ADMIN_EMAIL` và `DEV_ADMIN_PASSWORD`. Seed bị vô hiệu hóa cứng khi
`NODE_ENV=production`; không dùng mật khẩu trong `.env.example` cho môi trường
chia sẻ.

Visitor web chạy trực tiếp trên desktop/mobile browser; xem
[`apps/visitor-web/README.md`](apps/visitor-web/README.md). Prototype mobile
native vẫn được giữ tại [`apps/mobile/README.md`](apps/mobile/README.md). Dữ liệu POI và walkway hiện tại
là fixture tổng hợp, không phải dữ liệu Đầm Sen thật và không được dùng để dẫn
đường ngoài thực địa.

## Kiểm định

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
python3 data/geojson/validate.py
python3 data/research-damsen/validate.py
python3 data/pois/validate.py
python3 data/search-evaluation/validate.py
python3 data/search-evaluation/test_evaluation.py
```

Khi object storage đã chạy, `npm run smoke:media` kiểm tra signed PUT, metadata
HEAD và signed GET bằng object synthetic rồi xóa object ngay sau test.

`data/research-damsen/` chứa catalogue 24 địa điểm có tên tham khảo từ website
chính thức, nhưng toàn bộ tọa độ/lối đi vẫn là giả lập và POI ở trạng thái
`draft`. Dataset này chỉ để nghiên cứu giao diện/search; không được nhập làm dữ
liệu dẫn đường thật trước khi khảo sát hiện trường.

GitHub Actions chạy cùng quality gate. Trước production còn phải giải quyết bản
quyền dữ liệu/bản đồ, nâng Expo theo security audit, gắn secure token storage và
kiểm thử GPS tại hiện trường.
