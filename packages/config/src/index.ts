export * from './narration-locales.js';

export interface RuntimeConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  redisUrl: string;
  realtime: {
    redisEnabled: boolean;
  };
  objectStorage: {
    enabled: boolean;
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
  };
  auth: {
    accessTokenSecret: string;
    refreshTokenSecret: string;
  };
  demo: {
    enabled: boolean;
    phoneAuthEnabled: boolean;
    paymentsEnabled: boolean;
    phoneHmacSecret: string;
    paymentProcessingDelayMs: number;
  };
}

const LOCAL_DEFAULTS = {
  databaseUrl: 'postgresql://damsen:damsen_local_only@127.0.0.1:64321/damsen',
  redisUrl: 'redis://localhost:6379',
  s3Endpoint: 'http://localhost:9000',
  s3Region: 'us-east-1',
  s3Bucket: 'damsen-media',
  s3AccessKey: 'damsen_local',
  s3SecretKey: 'damsen_local_password',
  accessTokenSecret: 'development-access-secret-change-before-production',
  refreshTokenSecret: 'development-refresh-secret-change-before-production',
  phoneHmacSecret: 'development-demo-phone-hmac-change-before-production',
} as const;

function required(
  environment: NodeJS.ProcessEnv,
  name: string,
  localDefault: string,
  production: boolean,
): string {
  const value = environment[name]?.trim();
  if (value) return value;
  if (!production) return localDefault;
  throw new Error(`${name} is required in production`);
}

function validUrl(name: string, value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

function secureSecret(
  name: string,
  value: string,
  production: boolean,
): string {
  if (production && value.length < 32) {
    throw new Error(
      `${name} must contain at least 32 characters in production`,
    );
  }
  return value;
}

function booleanValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  defaultValue: boolean,
): boolean {
  const value = environment[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  const production = nodeEnv === 'production';
  const parsedPort = Number(environment.PORT ?? 3000);
  const demoEnabled = booleanValue(environment, 'DEMO_MODE', false);
  const demoPhoneAuthEnabled = booleanValue(
    environment,
    'DEMO_PHONE_AUTH_ENABLED',
    false,
  );
  const demoPaymentsEnabled = booleanValue(
    environment,
    'DEMO_PAYMENTS_ENABLED',
    false,
  );
  const paymentProcessingDelayMs = Number(
    environment.DEMO_PAYMENT_PROCESSING_DELAY_MS ?? 2_000,
  );

  if (
    production &&
    (demoEnabled || demoPhoneAuthEnabled || demoPaymentsEnabled)
  ) {
    throw new Error(
      'Demo phone and payment features are forbidden in production',
    );
  }
  if ((demoPhoneAuthEnabled || demoPaymentsEnabled) && !demoEnabled) {
    throw new Error(
      'DEMO_MODE=true is required for demo phone or payment features',
    );
  }
  if (
    !Number.isInteger(paymentProcessingDelayMs) ||
    paymentProcessingDelayMs < 0 ||
    paymentProcessingDelayMs > 30_000
  ) {
    throw new Error(
      'DEMO_PAYMENT_PROCESSING_DELAY_MS must be an integer from 0 to 30000',
    );
  }

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const databaseUrl = validUrl(
    'DATABASE_URL',
    required(
      environment,
      'DATABASE_URL',
      LOCAL_DEFAULTS.databaseUrl,
      production,
    ),
  );
  const redisUrl = validUrl(
    'REDIS_URL',
    required(environment, 'REDIS_URL', LOCAL_DEFAULTS.redisUrl, production),
  );
  const endpoint = validUrl(
    'S3_ENDPOINT',
    required(environment, 'S3_ENDPOINT', LOCAL_DEFAULTS.s3Endpoint, production),
  );

  return {
    nodeEnv: nodeEnv as RuntimeConfig['nodeEnv'],
    port: parsedPort,
    databaseUrl,
    redisUrl,
    realtime: {
      redisEnabled: booleanValue(environment, 'REALTIME_REDIS_ENABLED', false),
    },
    objectStorage: {
      enabled: booleanValue(environment, 'S3_ENABLED', true),
      endpoint,
      region: required(
        environment,
        'S3_REGION',
        LOCAL_DEFAULTS.s3Region,
        production,
      ),
      bucket: required(
        environment,
        'S3_BUCKET',
        LOCAL_DEFAULTS.s3Bucket,
        production,
      ),
      accessKey: required(
        environment,
        'S3_ACCESS_KEY',
        LOCAL_DEFAULTS.s3AccessKey,
        production,
      ),
      secretKey: required(
        environment,
        'S3_SECRET_KEY',
        LOCAL_DEFAULTS.s3SecretKey,
        production,
      ),
    },
    auth: {
      accessTokenSecret: secureSecret(
        'ACCESS_TOKEN_SECRET',
        required(
          environment,
          'ACCESS_TOKEN_SECRET',
          LOCAL_DEFAULTS.accessTokenSecret,
          production,
        ),
        production,
      ),
      refreshTokenSecret: secureSecret(
        'REFRESH_TOKEN_SECRET',
        required(
          environment,
          'REFRESH_TOKEN_SECRET',
          LOCAL_DEFAULTS.refreshTokenSecret,
          production,
        ),
        production,
      ),
    },
    demo: {
      enabled: demoEnabled,
      phoneAuthEnabled: demoPhoneAuthEnabled,
      paymentsEnabled: demoPaymentsEnabled,
      phoneHmacSecret: secureSecret(
        'DEMO_PHONE_HMAC_SECRET',
        required(
          environment,
          'DEMO_PHONE_HMAC_SECRET',
          LOCAL_DEFAULTS.phoneHmacSecret,
          production,
        ),
        production,
      ),
      paymentProcessingDelayMs,
    },
  };
}
