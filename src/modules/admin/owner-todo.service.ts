import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { AlertChannelsService } from './alert-channels.service';

/* ---------------------------------------------------------------------
 * v10.240 (docs/379) — 대표 할 일 자동 점검표(운영 화면 첫 화면 카드 · 읽기만)
 *
 *   인계 메모의 대표 할 일 가운데 DB 로 확인되는 것은 저절로 「됨」(done true · false),
 *   DB 로 알 수 없는 것(요금제 금액 확정 · 법무 · 세무 · EBS 스냅샷 예약)은 done null = 「직접 확인」.
 *   go 는 운영 화면 탭 이름(누르면 그 화면) — 운영 상태 한눈에(state-check)와 같은 방식.
 * ------------------------------------------------------------------- */
export type TodoRow = { key: string; label: string; done: boolean | null; now: string; go: string };
const HOLE = /〔[^〕]*〕/g;

@Injectable()
export class OwnerTodoService {
  constructor(private readonly db: DatabaseService, private readonly channels: AlertChannelsService) {}

  async rows(): Promise<{ rows: TodoRow[]; done: number; total: number }> {
    const set = (k: string) => `nullif(trim(coalesce((SELECT value FROM site_settings WHERE key = '${k}'), '')), '')`;
    const [ch, [s], [ig], seller] = await Promise.all([
      this.channels.channels(),
      this.db.query<any>(
        `SELECT (SELECT count(*)::int FROM ops_alerts WHERE acknowledged_at IS NULL AND resolved_at IS NULL AND severity = 'CRITICAL') AS critical,
                ${set('admin.ip_verify')} AS "ipVerify", coalesce(${set('admin.mfa_required')}, 'off') AS mfa,
                ${set('mall.biz_report_no')} AS "bizNo", ${set('mall.biz_report_at')} AS "bizAt",
                ${set('seo.verify_google')} AS google, ${set('seo.verify_naver')} AS naver, ${set('community.lbs_report_no')} AS lbs`),
      this.db.query<{ open: number; noDate: number; overdue: number }>(
        `SELECT count(*)::int AS open, count(*) FILTER (WHERE ip_requested_at IS NULL)::int AS "noDate",
                count(*) FILTER (WHERE ip_requested_at IS NOT NULL AND lead_time_weeks IS NOT NULL
                                   AND ip_requested_at + make_interval(weeks => lead_time_weeks) < now())::int AS overdue
           FROM integrations WHERE status <> 'LIVE'`),
      this.db.query<{ cur: boolean; version: string | null; body: string | null }>(
        `SELECT EXISTS (SELECT 1 FROM v_terms_current WHERE code = 'HLT_SELLER') AS cur, d.version, d.body
           FROM (SELECT 1) one
           LEFT JOIN LATERAL (SELECT version, coalesce(body, '') AS body FROM terms
                               WHERE code = 'HLT_SELLER' AND status IN ('DRAFT', 'LEGAL_REVIEW') ORDER BY version DESC LIMIT 1) d ON true`),
    ]);
    const sl = seller[0];
    const holes = sl?.body ? [...new Set(sl.body.match(HOLE) ?? [])].filter((h) => h !== '〔시행일〕').length : 0;
    const rows: TodoRow[] = [
      { key: 'channels', label: '급한 알림 받는 길(메일 · 텔레그램 · 슬랙)', go: 'ops-alerts', done: ch.ready > 0,
        now: `${ch.ready} / 3 준비 — ${AlertChannelsService.line(ch.list)}` },
      { key: 'critical', label: '확인 안 한 CRITICAL 알림 0건', go: 'ops-alerts', done: s.critical === 0,
        now: s.critical === 0 ? '없음' : `${s.critical}건 — 하나씩 보고 「확인」` },
      { key: 'ip-verify', label: '운영 화면 접속 인증 켜기', go: 'staff-access', done: s.ipVerify === 'on',
        now: s.ipVerify === 'on' ? '켜짐' : '꺼짐 — 허용 IP · 받을 곳을 넣은 뒤 켬(docs/363 9절)' },
      { key: 'mfa', label: '운영자 2단계 인증', go: 'my-mfa', done: s.mfa !== 'off',
        now: s.mfa !== 'off' ? `켜짐(${s.mfa})` : '꺼짐 — 「내 2단계 인증」에서 본인 등록 뒤 설정(켜기 전 점검)' },
      { key: 'integ-dates', label: '외부 연동 IP 신청일 · 예상일', go: 'integrations', done: ig.noDate === 0 && ig.overdue === 0,
        now: `LIVE 아닌 연동 ${ig.open} · 신청일 비어 있음 ${ig.noDate} · 예상일 지남 ${ig.overdue}` },
      { key: 'biz-report', label: '업종 정정신고(통신판매중개) 기록', go: 'hlt-sellers', done: !!(s.bizNo && s.bizAt),
        now: s.bizNo && s.bizAt ? `${s.bizAt} · 접수번호 있음` : '기록 없음 — 신고 뒤 「입점 열기 준비」 › 「적기」(SUPER)' },
      { key: 'seller-terms', label: '입점 약관(HLT_SELLER) 게시', go: 'terms', done: !!sl?.cur,
        now: sl?.cur ? '시행 중' : sl?.version ? `초안 ${sl.version} · 빈칸 ${holes}곳 — 법무 확인 뒤 게시` : '초안 없음' },
      { key: 'seo', label: '검색 사이트 소유 확인 값(구글 · 네이버)', go: 'policy', done: !!(s.google && s.naver),
        now: `구글 ${s.google ? '있음' : '없음'} · 네이버 ${s.naver ? '있음' : '없음'}` },
      { key: 'lbs', label: '위치기반서비스사업 신고번호', go: 'community', done: !!s.lbs,
        now: s.lbs ? '있음' : '없음 — 동네 인증을 켤 수 없음' },
      { key: 'plans', label: '요금제 금액 확정', go: 'billing', done: null, now: '직접 확인 — 운영 화면 › 요금제에서 금액을 정한 뒤' },
      { key: 'legal', label: '법무 · 세무 확인(약관 · 제휴 3.3% 등)', go: 'terms', done: null, now: '직접 확인 — 결정 기록 terms-publishing 미정 항목' },
      { key: 'ebs', label: 'EBS 스냅샷 예약(AWS DLM)', go: 'home', done: null, now: '직접 확인 — AWS 콘솔 › EC2 › 수명 주기 관리자' },
    ];
    const auto = rows.filter((r) => r.done !== null);
    return { rows, done: auto.filter((r) => r.done).length, total: auto.length };
  }
}
