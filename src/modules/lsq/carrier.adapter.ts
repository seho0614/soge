import { createHash } from 'node:crypto';
import { envInt, FetchLike, getPath, httpJson } from '../../common/http-json';

/* ---------------------------------------------------------------------
 * v10.607 (docs/749) ㉓ 택배사 배송 조회 어댑터 — 외부 연동 CARRIER(처음 꺼짐 · 간주)
 *
 *   ASSUME  밖으로 부르지 않음 — 발송 뒤 지난 시간으로 단계를 간주(6시간 집화 · 18시간 간선 · 36시간 배송 출발 · 48시간 배송 완료)
 *           · 결과 source = ASSUME · 주문 「배송 완료」로는 넣지 않음(tracking.ts)
 *   LIVE    조회 대행(스마트택배 · 굿스플로 등) 주소 틀 CARRIER_TRACK_BASE({carrier} · {no} · {key} 자리 · https 만)
 *           · 키 CARRIER_TRACK_KEY(운영 화면 › 외부 연동 › 연동 키 — 없으면 NOT_READY) · 제한 시간 CARRIER_TRACK_TIMEOUT_MS(5000)
 *           · 응답 칸 지도 CARRIER_TRACK_MAP(JSON · 처음 스마트택배 모양: list = trackingDetails · status = kind · place = where · at = timeString)
 *   보내는 것: 택배사 코드 · 송장번호 · 키만 — 받는 사람 이름 · 연락처 · 주소는 보내지 않음
 *   ★ 점검판(개발)에서는 LIVE 를 부르지 않음(설정 lsq.track_mode = ASSUME 그대로)
 * ------------------------------------------------------------------- */

export type TrackStatus = 'PICKED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'UNKNOWN';
export interface TrackEvent { status: TrackStatus; place: string | null; detail: string | null; at: string }
export interface TrackResult { source: 'ASSUME' | 'LIVE' | 'NOT_READY' | 'ERROR'; events: TrackEvent[]; delivered: boolean; error?: string }

/** 운영자가 고르는 택배사 이름(health-orders CARRIERS) → 조회 대행 택배사 코드(스마트택배 t_code 모양 · 업체가 다르면 CARRIER_TRACK_MAP.codes 로 바꿈) */
export const CARRIER_CODES: Record<string, string> = {
  'CJ대한통운': '04', '한진택배': '05', '롯데택배': '08', '우체국택배': '01', '로젠택배': '06',
};

const DEFAULT_MAP = { list: 'trackingDetails', status: 'kind', place: 'where', at: 'timeString', codes: {} as Record<string, string> };

/** 업체 단계 글 → 우리 단계 */
export function mapStatus(raw: unknown): TrackStatus {
  const s = String(raw ?? '').replace(/\s/g, '').toLowerCase();
  if (!s) return 'UNKNOWN';
  if (/배달완료|배송완료|delivered|완료/.test(s)) return 'DELIVERED';
  if (/배달출발|배송출발|outfordelivery|배달중/.test(s)) return 'OUT_FOR_DELIVERY';
  if (/집화|접수|picked|pickup|인수/.test(s)) return 'PICKED';
  if (/간선|이동|도착|상차|하차|transit|터미널|발송/.test(s)) return 'IN_TRANSIT';
  if (/미배달|반송|실패|failed|사고/.test(s)) return 'FAILED';
  return 'UNKNOWN';
}

export class CarrierTrackHttp {
  constructor(private readonly fetchFn?: FetchLike) {}

  static ready() { return !!process.env.CARRIER_TRACK_KEY?.trim() && /^https:\/\/\S+$/.test(process.env.CARRIER_TRACK_BASE?.trim() ?? ''); }

  async track(carrier: string, trackingNo: string): Promise<TrackResult> {
    if (!CarrierTrackHttp.ready()) return { source: 'NOT_READY', events: [], delivered: false, error: 'CARRIER_TRACK_KEY · CARRIER_TRACK_BASE 없음' };
    let map = DEFAULT_MAP;
    try { const raw = process.env.CARRIER_TRACK_MAP?.trim(); if (raw) map = { ...DEFAULT_MAP, ...(JSON.parse(raw) as Partial<typeof DEFAULT_MAP>) }; } catch { /* 지도가 틀리면 처음 모양 */ }
    const code = map.codes[carrier] ?? CARRIER_CODES[carrier];
    if (!code) return { source: 'ERROR', events: [], delivered: false, error: '조회 코드를 모르는 택배사' };
    const tpl = process.env.CARRIER_TRACK_BASE!.trim();
    if (!tpl.includes('{no}')) return { source: 'ERROR', events: [], delivered: false, error: 'CARRIER_TRACK_BASE 에 {no} 자리가 없음' };
    const url = tpl.replace('{carrier}', encodeURIComponent(code)).replace('{no}', encodeURIComponent(trackingNo))
      .replace('{key}', encodeURIComponent(process.env.CARRIER_TRACK_KEY!.trim()));
    const r = await httpJson({ url, method: 'GET', timeoutMs: envInt('CARRIER_TRACK_TIMEOUT_MS', 5000), fetchFn: this.fetchFn });
    if (!r.ok) return { source: 'ERROR', events: [], delivered: false, error: r.error ?? r.errorKind ?? '조회 실패' };
    const list = getPath(r.body, map.list);
    const events: TrackEvent[] = (Array.isArray(list) ? list : []).slice(0, 50).map((x: unknown) => {
      const at = new Date(String(getPath(x, map.at) ?? '').replace(' ', 'T') + (/[zZ+]/.test(String(getPath(x, map.at) ?? '')) ? '' : '+09:00'));
      return {
        status: mapStatus(getPath(x, map.status)),
        place: String(getPath(x, map.place) ?? '').slice(0, 60) || null,
        detail: String(getPath(x, map.status) ?? '').slice(0, 120) || null,
        at: Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString(),
      };
    });
    return { source: 'LIVE', events, delivered: events.some((e) => e.status === 'DELIVERED') };
  }
}

/** ASSUME — 발송 시각에서 지난 시간으로 단계를 간주(송장마다 장소 이름은 고정 목록에서) */
export function assumeTrack(trackingNo: string, pickedAt: Date, now = new Date()): TrackResult {
  const h = (now.getTime() - pickedAt.getTime()) / 3600e3;
  const hubs = ['서울 영업소', '경기 허브', '대전 허브', '부산 영업소', '광주 영업소'];
  const k = parseInt(createHash('sha256').update(trackingNo).digest('hex').slice(0, 2), 16) % hubs.length;
  const at = (hrs: number) => new Date(pickedAt.getTime() + hrs * 3600e3).toISOString();
  const steps: Array<[number, TrackStatus, string, string]> = [
    [0, 'PICKED', hubs[k]!, '집화 처리(간주)'], [6, 'IN_TRANSIT', '경기 허브', '간선 상차(간주)'],
    [18, 'IN_TRANSIT', hubs[(k + 2) % hubs.length]!, '간선 하차(간주)'], [36, 'OUT_FOR_DELIVERY', hubs[(k + 2) % hubs.length]!, '배송 출발(간주)'],
    [48, 'DELIVERED', hubs[(k + 2) % hubs.length]!, '배송 완료(간주)'],
  ];
  const events = steps.filter(([hr]) => h >= hr).map(([hr, status, place, detail]) => ({ status, place, detail, at: at(hr) }));
  return { source: 'ASSUME', events, delivered: events.some((e) => e.status === 'DELIVERED') };
}
