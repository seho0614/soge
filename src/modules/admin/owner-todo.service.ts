import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { AlertChannelsService } from './alert-channels.service';
import { RequestCtx } from '../../core/request-context';
import { PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.240 (docs/379) — 대표 할 일 자동 점검표(운영 화면 첫 화면 카드 · 읽기만)
 *
 *   인계 메모의 대표 할 일 가운데 DB 로 확인되는 것은 저절로 「됨」(done true · false),
 *   DB 로 알 수 없는 것(요금제 금액 확정 · 법무 · 세무 · EBS 스냅샷 예약)은 done null = 「직접 확인」.
 *   go 는 운영 화면 탭 이름(누르면 그 화면) — 운영 상태 한눈에(state-check)와 같은 방식.
 *
 * v10.241 (D201 · docs/381) — 직접 확인 줄 「끝남」 기록: SUPER 가 메모와 함께 끝남 · 다시 아직을 적으면(audit.owner_todo_marks ·
 *   쌓기만) 가장 최근 줄이 상태 — 적은 줄도 done true · false 가 되어 끝남 수에 셈(manual: true 는 그대로 · 누가 언제는 mark).
 * v10.242 (docs/381) — 정기 점검 기한 줄 3개(지난달 개인정보 접속기록 · 지난 분기 운영자 권한 · 기한 2일 안 권리 요청).
 *   경보(PII_REVIEW_DUE · ROLE_REVIEW_DUE · PRIVACY_REQUEST_DUE)는 그대로 — 이 줄은 다음 기한을 보여 줄 뿐.
 * ------------------------------------------------------------------- */
export type TodoMark = { done: boolean; note: string; at: string; by: string | null };
export type TodoRow = { key: string; label: string; done: boolean | null; now: string; go: string; manual?: boolean; mark?: TodoMark | null };
const HOLE = /〔[^〕]*〕/g;
export const MANUAL_KEYS = ['plans', 'legal', 'ebs'] as const;
const KST = `(now() AT TIME ZONE 'Asia/Seoul')`;

@Injectable()
export class OwnerTodoService {
  constructor(private readonly db: DatabaseService, private readonly channels: AlertChannelsService) {}

  async rows(): Promise<{ rows: TodoRow[]; done: number; total: number }> {
    const set = (k: string) => `nullif(trim(coalesce((SELECT value FROM site_settings WHERE key = '${k}'), '')), '')`;
    const [ch, [s], [ig], seller, marks, [rv]] = await Promise.all([
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
      this.db.query<{ key: string; done: boolean; note: string; at: string; by: string | null }>(
        `SELECT DISTINCT ON (m.item_key) m.item_key AS key, m.done, m.note,
                to_char(m.marked_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at, a.name AS by
           FROM audit.owner_todo_marks m LEFT JOIN accounts a ON a.id = m.marked_by
          ORDER BY m.item_key, m.marked_at DESC, m.id DESC`),
      this.db.query<any>(
        `WITH p AS (SELECT (date_trunc('month', ${KST}) - interval '1 month')::date AS m, (date_trunc('quarter', ${KST}) - interval '3 months')::date AS q)
         SELECT to_char(p.m, 'YYYY-MM') AS month, to_char(date_trunc('month', ${KST})::date + 4, 'YYYY-MM-DD') AS "monthDue",
                (${KST}::date > date_trunc('month', ${KST})::date + 4) AS "monthLate",
                (SELECT to_char(r.reviewed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') FROM audit.pii_reviews r WHERE r.month = p.m) AS "monthAt",
                to_char(p.q, 'YYYY') || '-Q' || extract(quarter FROM p.q)::int AS quarter,
                to_char(date_trunc('quarter', ${KST})::date + 14, 'YYYY-MM-DD') AS "quarterDue",
                (${KST}::date > date_trunc('quarter', ${KST})::date + 14) AS "quarterLate",
                (SELECT to_char(r.reviewed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') FROM audit.role_reviews r WHERE r.quarter = p.q) AS "quarterAt",
                (SELECT count(*)::int FROM privacy_requests WHERE status IN ('OPEN', 'EXTENDED')) AS "reqOpen",
                (SELECT count(*)::int FROM privacy_requests WHERE status IN ('OPEN', 'EXTENDED') AND due_on - ${KST}::date BETWEEN 0 AND 2) AS "reqSoon",
                (SELECT count(*)::int FROM privacy_requests WHERE status IN ('OPEN', 'EXTENDED') AND due_on < ${KST}::date) AS "reqLate",
                (SELECT to_char(min(due_on), 'YYYY-MM-DD') FROM privacy_requests WHERE status IN ('OPEN', 'EXTENDED')) AS "reqNext"
           FROM p`),
    ]);
    const mk = new Map(marks.map((m) => [m.key, { done: m.done, note: m.note, at: m.at, by: m.by }]));
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
      { key: 'pii-review', label: '지난달 개인정보 접속기록 점검', go: 'pii-review', done: !!rv.monthAt,
        now: rv.monthAt ? `${rv.month} 점검 끝(${rv.monthAt})` : `${rv.month} 점검 아직 — 기한 ${rv.monthDue}${rv.monthLate ? '(지남)' : ''} · 점검 완료(SUPER)` },
      { key: 'role-review', label: '지난 분기 운영자 권한 점검', go: 'role-review', done: !!rv.quarterAt,
        now: rv.quarterAt ? `${rv.quarter} 점검 끝(${rv.quarterAt})` : `${rv.quarter} 점검 아직 — 기한 ${rv.quarterDue}${rv.quarterLate ? '(지남)' : ''} · 점검 완료(SUPER)` },
      { key: 'privacy-due', label: '개인정보 권리 요청 기한 2일 안 · 넘김 0건', go: 'privacy-requests', done: rv.reqSoon + rv.reqLate === 0,
        now: rv.reqOpen === 0 ? '열린 요청 없음' : `열린 요청 ${rv.reqOpen} · 기한 2일 안 ${rv.reqSoon} · 넘김 ${rv.reqLate} · 가장 빠른 기한 ${rv.reqNext}` },
      ...([
        { key: 'plans', label: '요금제 금액 확정', go: 'billing', hint: '운영 화면 › 요금제에서 금액을 정한 뒤' },
        { key: 'legal', label: '법무 · 세무 확인(약관 · 제휴 3.3% 등)', go: 'terms', hint: '결정 기록 terms-publishing 미정 항목' },
        { key: 'ebs', label: 'EBS 스냅샷 예약(AWS DLM)', go: 'home', hint: 'AWS 콘솔 › EC2 › 수명 주기 관리자' },
      ].map(({ hint, ...r }) => {
        const m = mk.get(r.key) ?? null;
        return { ...r, manual: true, mark: m, done: m ? m.done : null,
                 now: m ? `${m.done ? '끝남' : '다시 아직'} — ${m.at} ${m.by ?? ''} · ${m.note}` : `직접 확인 — ${hint}` };
      })),
    ];
    /* v10.241 — 전체는 모든 줄(직접 확인 포함 15) · 끝남은 ✓ 인 줄(직접 확인은 「끝남」을 적어야 셈) */
    return { rows, done: rows.filter((r) => r.done === true).length, total: rows.length };
  }

  /** v10.241 — 직접 확인 줄 끝남 · 다시 아직 적기(SUPER · 메모 5자 이상 · 쌓기만) */
  async mark(key: unknown, done: unknown, note: unknown) {
    if (typeof key !== 'string' || !(MANUAL_KEYS as readonly string[]).includes(key))
      throw new PolicyViolation('OWNER_TODO_KEY', '직접 확인 줄(요금제 · 법무 · EBS)만 적을 수 있습니다.');
    if (typeof done !== 'boolean') throw new PolicyViolation('OWNER_TODO_DONE', '끝남인지 다시 아직인지 골라 주십시오.');
    const n = typeof note === 'string' ? note.trim() : '';
    if (n.length < 5 || n.length > 500) throw new PolicyViolation('OWNER_TODO_NOTE', '메모를 5 ~ 500자로 적어 주십시오.');
    await this.db.query(`INSERT INTO audit.owner_todo_marks (item_key, done, note, marked_by) VALUES ($1, $2, $3, $4)`,
      [key, done, n, RequestCtx.actorId()]);
    return { ok: true, key, done, note: done ? '끝남으로 적었습니다.' : '다시 아직으로 적었습니다.' };
  }
}
