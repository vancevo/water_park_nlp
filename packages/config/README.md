# @damsen/config

Điểm truy cập duy nhất cho cấu hình runtime dùng chung. Package validate `NODE_ENV`, `PORT`, PostgreSQL, Redis và S3-compatible object storage. Development/test dùng đúng local defaults trong `infra/docker/docker-compose.yml`; production bắt buộc truyền mọi endpoint và credential qua environment/secrets manager.

Không log object cấu hình này vì nó chứa object-storage credential.
