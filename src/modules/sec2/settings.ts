/* ---------------------------------------------------------------------
 * v10.590 ~ 593 (docs/732 ~ 735) 15차 보안 설정 저장 — SUPER · 사유(설정 바뀜 기록 site_setting_changes 에 남음)
 *   값 검사 = DB value_pattern 과 같은 정규식(common.ts SEC2_PATTERNS) · LIVE 는 법무 확인(sec2.pwned_legal_ok on)이 먼저
 *   선택 칸은 보낸 것만 바꿈(undefined 는 건드리지 않음 — 계약 규칙 11)
 * ------------------------------------------------------------------- */
import { Forbidden, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { SEC2_PATTERNS, Sec2Db, sec2CacheClear, sec2Settings } from './common';

export interface Sec2SettingsInput {
  anomalyWatch?: boolean; viewMin?: number; exportMin?: number; nightMin?: number; factor?: number;
  pwnedMode?: string; pwnedMin?: number; pwnedLegalOk?: boolean; memberMfa?: boolean; notMeSurge?: number; reason: string;
}

export async function sec2SetSettings(db: Sec2Db & { transaction<T>(fn: () => Promise<T>): Promise<T> }, d: Sec2SettingsInput) {
  if (RequestCtx.get()?.actorRole !== 'SUPER') throw new Forbidden('FORBIDDEN', '최고 관리자(SUPER)만 바꿉니다.');
  const why = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (why.length < 2 || why.length > 200) throw new PolicyViolation('SEC2_REASON', '사유는 2 ~ 200자입니다.');
  const onoff = (b: boolean) => (b ? 'on' : 'off');
  const want: Array<[string, string]> = [];
  if (d.anomalyWatch !== undefined) want.push(['sec2.anomaly_watch', onoff(d.anomalyWatch)]);
  if (d.viewMin !== undefined) want.push(['sec2.anomaly_view_min', String(d.viewMin)]);
  if (d.exportMin !== undefined) want.push(['sec2.anomaly_export_min', String(d.exportMin)]);
  if (d.nightMin !== undefined) want.push(['sec2.anomaly_night_min', String(d.nightMin)]);
  if (d.factor !== undefined) want.push(['sec2.anomaly_factor', String(d.factor)]);
  if (d.pwnedMode !== undefined) want.push(['sec2.pwned_check', String(d.pwnedMode)]);
  if (d.pwnedMin !== undefined) want.push(['sec2.pwned_min', String(d.pwnedMin)]);
  if (d.pwnedLegalOk !== undefined) want.push(['sec2.pwned_legal_ok', onoff(d.pwnedLegalOk)]);
  if (d.memberMfa !== undefined) want.push(['sec2.member_mfa', onoff(d.memberMfa)]);
  if (d.notMeSurge !== undefined) want.push(['sec2.not_me_surge', String(d.notMeSurge)]);
  if (!want.length) throw new PolicyViolation('SEC2_NOTHING', '바꿀 값이 없습니다.');
  for (const [k, v] of want) {
    if (!SEC2_PATTERNS[k]!.test(v)) throw new PolicyViolation('SEC2_VALUE', `${k} 값이 범위를 벗어났습니다(${v}).`);
  }
  sec2CacheClear();
  const cur = await sec2Settings(db);
  const legal = d.pwnedLegalOk !== undefined ? d.pwnedLegalOk : cur.pwnedLegalOk;
  const mode = d.pwnedMode !== undefined ? d.pwnedMode : cur.pwnedMode;
  if (mode === 'LIVE' && !legal) {
    throw new PolicyViolation('SEC2_PWNED_LEGAL', 'LIVE(바깥 범위 조회)는 법무 확인(sec2.pwned_legal_ok) 뒤에만 켭니다 — 처리방침 1.2 게시 뒤.');
  }
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [why]);
    for (const [k, v] of want) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  sec2CacheClear();
  return { ok: true, settings: await sec2Settings(db), note: '보안 설정을 바꿨습니다(다른 서버 프로세스는 30초 안에 따라옴).' };
}
