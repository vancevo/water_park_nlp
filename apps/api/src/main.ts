import 'reflect-metadata';

import { loadRuntimeConfig } from '@damsen/config';

import { createApp } from './bootstrap.js';

const config = loadRuntimeConfig();
const app = await createApp();

await app.listen(config.port);
