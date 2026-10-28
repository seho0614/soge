import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound } from '../../core/errors';
import { INTEGRATIONS } from './registry';

/* ---------------------------------------------------------------------
 * v10.128 (D128 · docs/192) — 외부 연동 키를 운영 화면에서(외부 연동 › 연동 키 · SUPER)
 *
 * 대표 「외부 연동에서 key 등록 관리를 관리자에서 · .env 관리가 아님」.
 *   키는 integration_secrets 에 암호문으로(fn_integ_secret_set — 형식 검사 · 끝 4자리) · 화면 · 응답에는 끝 4자리만.
 *
 * ── 어떻게 쓰이나 ─────────────────────────────────────────────────
 *   연동 코드(결제 · 계좌 · 국세청 · 중개사 · 세금계산서 · 메일 · 본인인증 · 전자계약 · 알림톡)는 전부터 process.env 의 키를 읽습니다.
 *   그 코드를 하나하나 고치지 않고, **이 서비스가 운영 화면 키를 process.env 에 얹습니다** — 띄울 때 · 1분마다 · 저장 · 지운 직후.
 *   운영 화면 키가 없으면 띄울 때의 .env 값으로 되돌립니다(운영 화면 키가 먼저, 없으면 .env).
 *   카카오맵 · 날씨 · AI 키는 그 서비스가 이미 DB 를 먼저 읽으므로 얹지 않습니다(ENV 칸이 null).
 *   ★ 키 값을 로그 · 응답 · 오류 글에 내보내지 않습니다.
 * ------------------------------------------------------------------- */

interface KeyDef { code: string; name: string; label: string; env: string | null; envRead: string; isPublic: boolean }

/** 운영 화면에서 받는 키 — DB ck_integ_secret_name 과 같은 목록(D128). env = 얹을 환경 변수(null 이면 얹지 않음) */
export const INTEG_KEYS: KeyDef[] = [
  { code: 'PG', name: 'TOSS_SECRET_KEY', label: '시크릿 키', env: 'TOSS_SECRET_KEY', envRead: 'TOSS_SECRET_KEY', isPublic: false },
  { code: 'PG', name: 'TOSS_CLIENT_KEY', label: '결제창 클라이언트 키(공개)', env: 'NEXT_PUBLIC_TOSS_CLIENT_KEY', envRead: 'NEXT_PUBLIC_TOSS_CLIENT_KEY', isPublic: true },
  { code: 'BANK', name: 'BANK_VERIFY_KEY', label: 'API 키', env: 'BANK_VERIFY_KEY', envRead: 'BANK_VERIFY_KEY', isPublic: false },
  { code: 'NTS', name: 'NTS_SERVICE_KEY', label: '공공데이터포털 인증키', env: 'NTS_SERVICE_KEY', envRead: 'NTS_SERVICE_KEY', isPublic: false },
  { code: 'BROKER', name: 'BROKER_LOOKUP_KEY', label: 'API 키', env: 'BROKER_LOOKUP_KEY', envRead: 'BROKER_LOOKUP_KEY', isPublic: false },
  { code: 'ETAX', name: 'ETAX_KEY', label: 'API 키', env: 'ETAX_KEY', envRead: 'ETAX_KEY', isPublic: false },
  { code: 'MAIL', name: 'SMTP_USER', label: 'SMTP 사용자 이름', env: 'SMTP_USER', envRead: 'SMTP_USER', isPublic: false },   // v10.140 (D136)
  { code: 'MAIL', name: 'SMTP_PASS', label: 'SMTP 비밀번호', env: 'SMTP_PASS', envRead: 'SMTP_PASS', isPublic: false },
  { code: 'PASS', name: 'PASS_API_KEY', label: 'API 키', env: 'PASS_API_KEY', envRead: 'PASS_API_KEY', isPublic: false },
  { code: 'PASS', name: 'NICE_CLIENT_ID', label: 'NICE 클라이언트 ID', env: 'NICE_CLIENT_ID', envRead: 'NICE_CLIENT_ID', isPublic: false },   // v10.141 (D137)
  { code: 'PASS', name: 'NICE_CLIENT_SECRET', label: 'NICE 클라이언트 비밀값', env: 'NICE_CLIENT_SECRET', envRead: 'NICE_CLIENT_SECRET', isPublic: false },
  { code: 'PASS', name: 'NICE_PRODUCT_ID', label: 'NICE 상품 ID', env: 'NICE_PRODUCT_ID', envRead: 'NICE_PRODUCT_ID', isPublic: false },
  { code: 'ESIGN', name: 'ESIGN_API_KEY', label: 'API 키', env: 'ESIGN_API_KEY', envRead: 'ESIGN_API_KEY', isPublic: false },
  { code: 'ESIGN', name: 'ESIGN_WEBHOOK_SECRET', label: '웹훅 비밀값', env: 'ESIGN_WEBHOOK_SECRET', envRead: 'ESIGN_WEBHOOK_SECRET', isPublic: false },   // v10.143 (D139)
  { code: 'ALIMTALK', name: 'ALIMTALK_KEY', label: 'API 키', env: 'ALIMTALK_KEY', envRead: 'ALIMTALK_KEY', isPublic: false },
  { code: 'ALIMTALK', name: 'ALIMTALK_SENDER_KEY', label: '발신 프로필 키', env: 'ALIMTALK_SENDER_KEY', envRead: 'ALIMTALK_SENDER_KEY', isPublic: false },   // v10.142 (D138)
  { code: 'SAFENUM', name: 'SAFENUM_KEY', label: 'API 키', env: 'SAFENUM_KEY', envRead: 'SAFENUM_KEY', isPublic: false },
  /* 전부터 운영 화면에서 넣던 키 — 그 서비스가 DB 를 먼저 읽음(얹지 않음) · 이 화면에서도 같은 함수로 넣고 지움 */
  { code: 'MAP', name: 'KAKAO_REST_KEY', label: 'REST API 키', env: null, envRead: 'KAKAO_REST_KEY', isPublic: false },
  { code: 'MAP', name: 'KAKAO_JS_KEY', label: 'JavaScript 키(공개)', env: null, envRead: 'NEXT_PUBLIC_KAKAO_JS_KEY', isPublic: true },
  { code: 'WEATHER', name: 'KMA_SERVICE_KEY', label: '공공데이터포털 인증키', env: null, envRead: 'KMA_SERVICE_KEY', isPublic: false },
  { code: 'AGENT', name: 'ANTHROPIC_API_KEY', label: 'API 키', env: null, envRead: 'ANTHROPIC_API_KEY', isPublic: false },
];

const EVERY_MS = 60_000;

@Injectable()
export class IntegrationSecretService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(IntegrationSecretService.name);
  /** 띄울 때의 .env 값 — 운영 화면 키를 지우면 이 값으로 되돌림 */
  private readonly envAtBoot = new Map<string, string | undefined>(INTEG_KEYS.map((k) => [k.envRead, process.env[k.envRead]]));
  private readonly applied = new Set<string>();   // 지금 운영 화면 값이 얹힌 환경 변수
  private timer: NodeJS.Timeout | null = null;
  /** 다시 읽기를 한 줄로 — 1분 타이머와 저장 · 지우기가 겹쳐 늦게 끝난 옛 결과가 지운 키를 되살리지 않게 */
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly db: DatabaseService) {}

  /* DB 연결(DatabaseService.onModuleInit)이 만들어진 뒤 — onModuleInit 에서는 모듈 순서에 따라 연결이 아직 없음 */
  async onApplicationBootstrap() {
    /* 띄울 때 못 읽으면(DB 잠깐 끊김 · ENC_KEY 다름) .env 값(없으면 시험)으로 돌므로 몇 번 곧바로 다시 읽음 */
    for (let i = 0; i < 5 && !(await this.refresh()); i++) await new Promise((r) => setTimeout(r, 3000));
    this.timer = setInterval(() => { void this.refresh(); }, EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** 운영 화면 키를 process.env 에 얹고, 없어진 키는 .env 값으로 되돌림. 실패해도 이전 상태를 둠(키 값은 기록하지 않음) */
  refresh(): Promise<boolean> {
    const run = this.chain.then(() => this.load());
    this.chain = run.then(() => undefined);
    return run;
  }

  private async load(): Promise<boolean> {
    const targets = INTEG_KEYS.filter((k) => k.env);
    try {
      const rows = await this.db.query<{ code: string; name: string; v: string | null }>(
        `SELECT integration_code AS code, name, public.fn_integ_secret_get(integration_code, name) AS v
           FROM integration_secrets WHERE name = ANY($1::text[])`, [targets.map((k) => k.name)]);
      for (const k of targets) {
        const env = k.env as string;
        const r = rows.find((x) => x.code === k.code && x.name === k.name);
        if (r?.v) { process.env[env] = r.v; this.applied.add(env); }
        else if (this.applied.has(env)) {
          const boot = this.envAtBoot.get(env);
          if (boot === undefined) delete process.env[env]; else process.env[env] = boot;
          this.applied.delete(env);
        }
      }
      return true;
    } catch (e: any) {
      this.log.error(`연동 키를 다시 읽지 못함(이전 값 유지): ${String(e?.code ?? e?.name ?? 'error')}`);
      return false;
    }
  }

  /** 넣기 · 지우기는 이 구역 키만 — 카카오맵 · 날씨 · AI 키는 그 서비스 구역에서(그쪽 기억을 바로 비움) */
  private def(code: string, name: string): KeyDef {
    const k = INTEG_KEYS.find((x) => x.code === code && x.name === name);
    if (!k) throw new NotFound('없는 키 이름입니다.');
    if (!k.env) throw new NotFound('이 키는 카카오맵 · 날씨 · AI 구역에서 넣습니다.');
    return k;
  }

  /** 운영 화면 › 외부 연동 › 연동 키 — 값은 내보내지 않음(끝 4자리 · 어디서 왔는지만) */
  async list() {
    const rows = await this.db.query<{ code: string; name: string; last4: string; updated_at: Date }>(
      `SELECT integration_code AS code, name, last4, updated_at FROM integration_secrets`);
    const names = await this.db.query<{ code: string; name: string }>(`SELECT code, name FROM integrations`);
    return INTEG_KEYS.map((k) => {
      const r = rows.find((x) => x.code === k.code && x.name === k.name);
      const env = this.envAtBoot.get(k.envRead)?.trim();
      const reg = INTEGRATIONS.find((i) => i.code === k.code);
      return {
        code: k.code, integration: names.find((n) => n.code === k.code)?.name ?? reg?.name ?? k.code,
        name: k.name, label: k.label, isPublic: k.isPublic, adapter: reg?.adapter ?? 'NONE',
        source: r ? 'ADMIN' : env ? 'ENV' : 'NONE',
        masked: r ? `••••••${r.last4}` : env ? `••••••${env.slice(-4)}` : null,
        updatedAt: r?.updated_at ?? null,
      };
    });
  }

  async set(code: string, name: string, value: string) {
    this.def(code, name);
    await this.db.query(`SELECT * FROM public.fn_integ_secret_set($1, $2, $3, $4)`, [code, name, value, RequestCtx.actorId() ?? null]);
    await this.refresh();
    return this.list();
  }

  async clear(code: string, name: string) {
    const k = this.def(code, name);
    await this.db.query(`DELETE FROM integration_secrets WHERE integration_code = $1 AND name = $2`, [code, name]);
    if (!k.isPublic && !this.envAtBoot.get(k.envRead)?.trim()) {
      /* 비공개 키를 지웠고 .env 에도 없으면 「키 등록」 표시를 내림(.env 에 있으면 그대로 — 전과 같은 수동 표시) */
      await this.db.query(`UPDATE integrations SET secret_registered = false WHERE code = $1`, [code]);
    }
    await this.refresh();
    return this.list();
  }

  /** 사용자 웹 결제창(토스) 공개 키 — 운영 화면 값 → .env(NEXT_PUBLIC_TOSS_CLIENT_KEY) · 없으면 null(시험 결제).
   *  ★ 서버 승인(TOSS_SECRET_KEY)과 짝이 맞을 때만 줌 — 시크릿 키가 없거나 test/live 가 다르면 null.
   *    한쪽만 있으면 결제창은 실제인데 승인은 시험(스텁)이 「결제됨」으로 처리하거나, 그 반대로 모든 결제가 실패합니다. */
  tossClientKey(): string | null {
    const ck = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim(), sk = process.env.TOSS_SECRET_KEY?.trim();
    const mode = (k: string) => k.split('_')[0];   // test · live
    return ck && sk && mode(ck) === mode(sk) ? ck : null;
  }
}
