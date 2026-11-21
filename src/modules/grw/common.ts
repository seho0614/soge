import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.597 ~ 601 (docs/739 ~ 743) 16차 회원 · 성장 — 공통(설정 · 작은 도우미)
 *   ⑬ v10.597 가입 퍼널 분석(읽기만)            grw.signup_steps(가입 단계 수 세기 · 처음 off)
 *   ⑭ v10.598 첫 거래 안내 체크리스트(나의공간)  grw.first_steps(on — 본인 것만 보여 주는 표시 · 새로 모으는 정보 없음) · grw.first_steps_days(60)
 *   ⑮ v10.599 알림 하루 요약 받기(회원 설정)      grw.digest(처음 off)
 *   ⑯ v10.600 여러 단계 추천 보상                grw.tier_reward(처음 off) · grw.tier_legal_ok(법무 확인 끝 표시 · 처음 off) · grw.tier_points(300)
 *                                                **법무 확인 필요 — 방문판매법 다단계판매 해당 여부**(11/9 「다단계 해당 안 됨」은 1단계 기준)
 *   ⑰ v10.601 매물 충실도 점수 · 등록 도우미     grw.fill_helper(on — 본인 매물에 고칠 곳 안내만) · **노출 순위 · 소개비에 쓰지 않음**
 *   설정 값 검사 정규식 = DB site_settings.value_pattern(sql/grw_*.sql)과 같은 글자(계약 규칙 2 · test_v1597 이 대조)
 *   바꾸기는 SUPER(PUT /admin/grw/settings · 사유 · 설정 바뀐 기록)
 * ------------------------------------------------------------------- */

export const GRW_KEYS = {
  signupSteps: 'grw.signup_steps',
  firstSteps: 'grw.first_steps',
  firstStepsDays: 'grw.first_steps_days',
  digest: 'grw.digest',
  tierReward: 'grw.tier_reward',
  tierLegalOk: 'grw.tier_legal_ok',
  tierPoints: 'grw.tier_points',
  fillHelper: 'grw.fill_helper',
} as const;

/** 설정 키 → DB value_pattern 과 같은 정규식 글자 */
export const GRW_PATTERNS: Record<string, string> = {
  'grw.signup_steps': '^(on|off)$',
  'grw.first_steps': '^(on|off)$',
  'grw.first_steps_days': '^([7-9]|[1-9][0-9]|[12][0-9]{2}|3[0-5][0-9]|36[0-5])$',
  'grw.digest': '^(on|off)$',
  'grw.tier_reward': '^(on|off)$',
  'grw.tier_legal_ok': '^(on|off)$',
  'grw.tier_points': '^[1-9][0-9]{0,4}(,[1-9][0-9]{0,4}){0,2}$',
  'grw.fill_helper': '^(on|off)$',
};
/** 여러 단계 보상 점수(2단계부터 · 쉼표로 최대 3단계 = 2 · 3 · 4단계) — DB CHECK(value_pattern)와 같은 정규식 */
export const TIER_POINTS_RE = /^[1-9][0-9]{0,4}(,[1-9][0-9]{0,4}){0,2}$/;

export interface GrwSettings {
  signupSteps: boolean; firstSteps: boolean; firstStepsDays: number; digest: boolean;
  tierReward: boolean; tierLegalOk: boolean; tierPoints: string; fillHelper: boolean;
}

const int = (v: string | undefined, def: number, lo: number, hi: number) => {
  const x = Number(v);
  return Number.isInteger(x) && x >= lo && x <= hi ? x : def;
};
export const num = (v: unknown) => Number(v ?? 0);
export const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
export const me = () => RequestCtx.actorId()!;

/** 설정 한 번에 읽기 — 캐시 없음(끄면 바로 멈추게) · 값이 비거나 틀리면 처음 값 */
export async function grwSettings(db: DatabaseService): Promise<GrwSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key LIKE 'grw.%'`);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value ?? ''])) as Record<string, string>;
  const pts = m[GRW_KEYS.tierPoints] ?? '';
  return {
    signupSteps: m[GRW_KEYS.signupSteps] === 'on',
    firstSteps: m[GRW_KEYS.firstSteps] === 'on',
    firstStepsDays: int(m[GRW_KEYS.firstStepsDays], 60, 7, 365),
    digest: m[GRW_KEYS.digest] === 'on',
    tierReward: m[GRW_KEYS.tierReward] === 'on',
    tierLegalOk: m[GRW_KEYS.tierLegalOk] === 'on',
    tierPoints: TIER_POINTS_RE.test(pts) ? pts : '300',
    fillHelper: m[GRW_KEYS.fillHelper] === 'on',
  };
}

/** 사용자 웹이 상자를 그릴지 정할 때 — 개인정보 없음(GET /site/grw/switches) */
export async function grwSwitches(db: DatabaseService) {
  const s = await grwSettings(db);
  return { signupSteps: s.signupSteps, firstSteps: s.firstSteps, digest: s.digest, fillHelper: s.fillHelper };
}

export interface GrwSettingsInput {
  signupSteps?: boolean; firstSteps?: boolean; firstStepsDays?: number; digest?: boolean;
  tierReward?: boolean; tierLegalOk?: boolean; tierPoints?: string; tierMonthlyCap?: number; fillHelper?: boolean; reason?: string;
}

/** PUT /admin/grw/settings (SUPER) — 사유 2 ~ 200자 · 안 보낸 칸(undefined)은 그대로(계약 규칙 11) */
export async function setGrwSettings(db: DatabaseService, d: GrwSettingsInput) {
  const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('GRW_REASON', '사유는 2 ~ 200자입니다.');
  const cur = await grwSettings(db);
  const set: Array<[string, string]> = [];
  const sw = (v: boolean | undefined, key: string) => { if (v !== undefined) set.push([key, v ? 'on' : 'off']); };
  sw(d.signupSteps, GRW_KEYS.signupSteps); sw(d.firstSteps, GRW_KEYS.firstSteps); sw(d.digest, GRW_KEYS.digest);
  sw(d.tierLegalOk, GRW_KEYS.tierLegalOk); sw(d.tierReward, GRW_KEYS.tierReward); sw(d.fillHelper, GRW_KEYS.fillHelper);
  if (d.firstStepsDays !== undefined) {
    if (!Number.isInteger(d.firstStepsDays) || d.firstStepsDays < 7 || d.firstStepsDays > 365) throw new PolicyViolation('GRW_RANGE', '첫 거래 안내를 보여 주는 날 수는 7 ~ 365 입니다.');
    set.push([GRW_KEYS.firstStepsDays, String(d.firstStepsDays)]);
  }
  if (d.tierPoints !== undefined) {
    if (!TIER_POINTS_RE.test(d.tierPoints)) throw new PolicyViolation('GRW_TIER_POINTS', '여러 단계 보상 점수는 1 ~ 99999 를 쉼표로 최대 3개(2 · 3 · 4단계)까지 적습니다.');
    set.push([GRW_KEYS.tierPoints, d.tierPoints]);
  }
  /* ⑯ 여러 단계 보상 — 법무 확인 끝 표시 없이는 켤 수 없음(DB 함수도 둘 다 봄) · 법무 확인을 끄면 보상도 함께 끔 */
  const legal = d.tierLegalOk ?? cur.tierLegalOk;
  if ((d.tierReward ?? cur.tierReward) && !legal) {
    if (d.tierReward === true) throw new PolicyViolation('GRW_TIER_LEGAL', '여러 단계 추천 보상은 법무 확인(방문판매법 다단계판매 해당 여부)을 끝냈다고 먼저 표시해야 켤 수 있습니다.');
    set.push([GRW_KEYS.tierReward, 'off']);
  }
  if (d.tierMonthlyCap !== undefined && (!Number.isInteger(d.tierMonthlyCap) || d.tierMonthlyCap < 0 || d.tierMonthlyCap > 1000)) {
    throw new PolicyViolation('GRW_RANGE', '한 사람 한 달 여러 단계 보상 횟수는 0(제한 없음) ~ 1,000 입니다.');
  }
  if (!set.length && d.tierMonthlyCap === undefined) throw new PolicyViolation('GRW_NOTHING', '바꿀 것이 없습니다.');
  const who = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, who]);
    if (d.tierMonthlyCap !== undefined) {
      await db.query(`UPDATE point_rules SET monthly_cap = $1::int WHERE code = 'REFERRAL_TIER'`, [d.tierMonthlyCap === 0 ? null : d.tierMonthlyCap]);
    }
    /* 보상 규칙 표의 켜짐 칸은 화면 표시용으로 스위치와 맞춤(지급 여부는 DB 함수가 설정 두 줄로 정함) */
    const after = Object.fromEntries(set);
    if (after[GRW_KEYS.tierReward] !== undefined) {
      await db.query(`UPDATE point_rules SET is_active = $1::boolean WHERE code = 'REFERRAL_TIER'`, [after[GRW_KEYS.tierReward] === 'on']);
    }
  });
  return { ok: true, settings: await grwSettings(db), note: '회원 · 성장 설정을 바꿨습니다.' };
}

/** 이름 가리기 — 김OO(두 글자면 김O) */
export const maskName = (s: string | null | undefined) => {
  const t = [...String(s ?? '').trim()];
  if (!t.length) return '—';
  return t[0] + 'O'.repeat(Math.max(1, Math.min(2, t.length - 1)));
};
