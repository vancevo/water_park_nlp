# Local infrastructure

Start the local services from the repository root:

```bash
docker compose -f infra/docker/docker-compose.yml up -d
docker compose -f infra/docker/docker-compose.yml ps
```

Apply pending migrations after PostgreSQL is healthy:

```bash
npm run db:migrate
```

The runner records applied `*.up.sql` files in `schema_migrations`. Do not edit an applied migration; add a new numbered migration instead.

Services:

- PostgreSQL 16 with PostGIS, pgvector and pgRouting on `127.0.0.1:64321`. The non-default host port avoids collisions with locally installed PostgreSQL instances. The image is built from the official PostGIS image plus Debian PostgreSQL extension packages in `postgres/Dockerfile`.
- Redis on `localhost:6379`.
- MinIO S3 API on `localhost:9000`, console on `localhost:9001`.

The credentials in this Compose file are local-development defaults only. Production credentials must come from a secrets manager.

To stop services without deleting data:

```bash
docker compose -f infra/docker/docker-compose.yml down
```

Deleting named volumes is intentionally not included in a convenience script because it destroys local data.
