# @damsen/api-client

Typed client for the static contract in `apps/api/openapi.yaml`.

```ts
import { DamSenApiClient } from '@damsen/api-client';

const api = new DamSenApiClient({ baseUrl: 'http://localhost:3000' });
const nearby = await api.listPois({ lat: 10.767, lng: 106.635, radius: 500 });
```

The package uses the platform `fetch` implementation and throws
`ApiClientError` for non-2xx error envelopes.
