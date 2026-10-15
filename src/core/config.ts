/**
 * 환경변수는 부팅 시 한 번 검증합니다.
 * 누락된 키를 런타임에 발견하면 이미 트래픽을 받은 뒤입니다.
 */
const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'] as const;

export interface AppConfig {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  dbPoolMax: number;
  nodeEnv: 'development' | 'staging' | 'production';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`필수 환경변수 누락: ${missing.join(', ')}`);
  }
  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];

  if (nodeEnv === 'production' && (env.JWT_SECRET ?? '').length < 32) {
    throw new Error('운영 환경의 JWT_SECRET 은 32자 이상이어야 합니다.');
  }
  return {
    databaseUrl: env.DATABASE_URL!,
    jwtSecret: env.JWT_SECRET!,
    port: Number(env.PORT ?? 3000),
    dbPoolMax: Number(env.DB_POOL_MAX ?? 10),
    nodeEnv,
  };
}
