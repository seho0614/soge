import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.542 ~ 545 (D284 · docs/680 ~ 683) (54) 매물 · 파트너 — 설정 12개 한 곳
 *   스위치 4개(vsx.enabled · map.cluster_enabled · ptn.export_enabled · papi.bill_enabled)는 처음 off
 *   map.cluster_grid 도 처음 off(정확 좌표를 격자로 묶는 단계 — 법무 확인 뒤)
 *   범위 끝값은 D284 site_settings.value_pattern 과 같음(규칙 2)
 * ------------------------------------------------------------------- */

/** 방문 예약을 쓰는 관 — DB site_settings.value_pattern 과 같음(규칙 2 · 대표 11/21 「관별로 설정」 · 처음 NONE = 모두 꺼짐) */
export const VSX_GWANS_RE = /^(NONE|[A-Z][A-Z0-9_]{1,19}(,[A-Z][A-Z0-9_]{1,19}){0,29})$/;
export const VSX_GWAN_RE = /^[A-Z][A-Z0-9_]{1,19}$/;

export interface VsxSettings {
  visitOn: boolean; visitGwans: string[]; slotDays: number; maxOpen: number;
  mapOn: boolean; mapGrid: boolean; mapMin: number;
  exportOn: boolean; exportMaxRows: number;
  billOn: boolean; billFreeCalls: number; billPrice1k: number; billDay: number;
}

const KEYS = ['vsx.enabled', 'vsx.gwans', 'vsx.slot_days', 'vsx.max_open', 'map.cluster_enabled', 'map.cluster_grid', 'map.cluster_min',
  'ptn.export_enabled', 'ptn.export_max_rows', 'papi.bill_enabled', 'papi.bill_free_calls', 'papi.bill_price_1k', 'papi.bill_day'] as const;

/** 범위 [최소, 최대, 처음 값] — value_pattern 과 같은 끝값 */
export const VSX_RANGES: Record<string, [number, number, number]> = {
  'vsx.slot_days': [1, 90, 30], 'vsx.max_open': [1, 200, 60], 'map.cluster_min': [2, 20, 3], 'ptn.export_max_rows': [100, 20000, 5000],
  'papi.bill_free_calls': [0, 10_000_000, 10000], 'papi.bill_price_1k': [0, 100_000, 1000], 'papi.bill_day': [1, 28, 3],
};

const num = (raw: string, key: string) => {
  const [lo, hi, d] = VSX_RANGES[key]!;
  const v = Number(raw);
  return raw !== '' && Number.isInteger(v) && v >= lo && v <= hi ? v : d;
};

export async function vsxSettings(db: DatabaseService): Promise<VsxSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`, [KEYS as unknown as string[]]);
  const v = (k: string) => (rows.find((r) => r.key === k)?.value ?? '').trim();
  return {
    visitOn: v('vsx.enabled') === 'on', visitGwans: VSX_GWANS_RE.test(v('vsx.gwans')) && v('vsx.gwans') !== 'NONE' ? v('vsx.gwans').split(',') : [], slotDays: num(v('vsx.slot_days'), 'vsx.slot_days'), maxOpen: num(v('vsx.max_open'), 'vsx.max_open'),
    mapOn: v('map.cluster_enabled') === 'on', mapGrid: v('map.cluster_grid') === 'on', mapMin: num(v('map.cluster_min'), 'map.cluster_min'),
    exportOn: v('ptn.export_enabled') === 'on', exportMaxRows: num(v('ptn.export_max_rows'), 'ptn.export_max_rows'),
    billOn: v('papi.bill_enabled') === 'on', billFreeCalls: num(v('papi.bill_free_calls'), 'papi.bill_free_calls'),
    billPrice1k: num(v('papi.bill_price_1k'), 'papi.bill_price_1k'), billDay: num(v('papi.bill_day'), 'papi.bill_day'),
  };
}

export interface VsxSettingsInput {
  visitOn?: boolean; visitGwans?: string[]; slotDays?: number; maxOpen?: number; mapOn?: boolean; mapGrid?: boolean; mapMin?: number;
  exportOn?: boolean; exportMaxRows?: number; billOn?: boolean; billFreeCalls?: number; billPrice1k?: number; billDay?: number; reason: string;
}

/** SUPER — 보낸 칸만 바꿈(안 보낸 칸은 undefined 로 들어오므로 거름 · 규칙 11) · 사유는 설정 바뀜 기록(app.setting_reason) */
export async function setVsxSettings(db: DatabaseService, d: VsxSettingsInput) {
  const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('VSX_REASON', '사유는 2 ~ 200자입니다.');
  const set: Array<[string, string]> = [];
  const sw = (k: string, b: boolean | undefined) => { if (b !== undefined) set.push([k, b ? 'on' : 'off']); };
  const n = (k: string, x: number | undefined) => {
    if (x === undefined) return;
    const [lo, hi] = VSX_RANGES[k]!;
    if (!Number.isInteger(x) || x < lo || x > hi) throw new PolicyViolation('VSX_RANGE', `${k} 는 ${lo} ~ ${hi} 입니다.`);
    set.push([k, String(x)]);
  };
  sw('vsx.enabled', d.visitOn);
  if (d.visitGwans !== undefined) {
    const list = [...new Set((Array.isArray(d.visitGwans) ? d.visitGwans : []).map(String))].sort();
    if (list.some((g) => !VSX_GWAN_RE.test(g))) throw new PolicyViolation('VSX_GWANS', '관 코드가 맞지 않습니다.');
    const val = list.length ? list.join(',') : 'NONE';
    if (!VSX_GWANS_RE.test(val)) throw new PolicyViolation('VSX_GWANS', '관은 30개까지입니다.');
    set.push(['vsx.gwans', val]);
  }
  n('vsx.slot_days', d.slotDays); n('vsx.max_open', d.maxOpen);
  sw('map.cluster_enabled', d.mapOn); sw('map.cluster_grid', d.mapGrid); n('map.cluster_min', d.mapMin);
  sw('ptn.export_enabled', d.exportOn); n('ptn.export_max_rows', d.exportMaxRows);
  sw('papi.bill_enabled', d.billOn); n('papi.bill_free_calls', d.billFreeCalls); n('papi.bill_price_1k', d.billPrice1k); n('papi.bill_day', d.billDay);
  if (!set.length) throw new PolicyViolation('VSX_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, changed: set.map(([k]) => k), settings: await vsxSettings(db), note: '설정을 바꿨습니다 — 바로 반영됩니다.' };
}

/** 한국 날짜(YYYY-MM-DD) · 지난달(YYYY-MM) */
export const vsxToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
export const vsxPrevYm = () => { const d = new Date(Date.now() + 9 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
