# API

NestJS modular monolith entry point. Foundation exposes `GET /health`, assigns/propagates `x-request-id`, validates request DTOs globally and returns errors as `{ code, message, details, requestId }`.

```bash
npm run dev --workspace @damsen/api
npm test --workspace @damsen/api
```

The health route deliberately has no database, cache or object-storage dependency.

# API authentication notes

The MVP sends access and refresh tokens explicitly in JSON and uses
`Authorization: Bearer <accessToken>` for protected routes. Since credentials
are not stored in cookies, cookie-based CSRF is not applicable. Browser clients
must avoid persistent JavaScript-accessible storage where possible and still
protect against XSS. Refresh tokens are opaque, stored hashed server-side and
rotated on every successful refresh.

Production must set a strong `JWT_SECRET`. The development fallback is not
appropriate for a deployed environment.
