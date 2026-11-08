import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { TermsService } from '../catalog/terms.service';
import { TownVerifyService } from '../community/town-verify.service';

/* ---------------------------------------------------------------------
 * v10.212 (docs/340) — 운영 상태 한눈에(운영 화면 첫 화면 카드 · 읽기만)
 *
 *   운영 적용 뒤 화면 확인(절차서 4-1)에서 여러 화면을 돌아다니던 것을 한 표로 —
 *   AI 잠금 · 약관 빈칸 · 위탁 목록 · 공휴일 · 요금제 금액 · 개봉 반품 재고 · 메일 반송 · 동네 인증 · 동네픽 · 운영 알림.
 *   state: ok(할 일 없음) · todo(대표 · 법무가 할 일 남음 — 오픈 전에는 정상) · warn(바로 볼 것) · info(값만).
 *   go 는 운영 화면 탭 이름(누르면 그 화면).
 *   v10.214 (docs/344) — 「약관 시행 예정」 줄(날짜별 · 며칠 뒤) · AI 줄은 「게시」 기준이라 「시행 중」 대신 「게시됨」.
 *     새 판 시행 예정(v_terms_upcoming — 그날 앞 판이 바뀜)과 첫 판 · 적힌 시행일 전(v_terms_current — 게시 순간부터 지금 판 · 동의 기준)을 나눔.
 * ------------------------------------------------------------------- */
export type StateRow = { key: string; label: string; state: 'ok' | 'todo' | 'warn' | 'info'; now: string; go: string };
const HOLE = /〔[^〕]*〕/g;
const won = (v: number) => `${v.toLocaleString('ko-KR')}원`;

@Injectable()
export class StateCheckService {
  constructor(private readonly db: DatabaseService, private readonly terms: TermsService, private readonly town: TownVerifyService) {}

  async rows(): Promise<StateRow[]> {
    const q = async <T>(sql: string) => (await this.db.query<T>(sql))[0] as T;
    const [ai, drafts, oc, hol, plans, stock, mail, town, pick, alerts, upcoming] = await Promise.all([
      q<{ ready: boolean; enabled: string | null }>(`SELECT fn_privacy_ai_ready() AS ready, (SELECT value FROM site_settings WHERE key = 'agent.enabled') AS enabled`),
      this.db.query<{ code: string; title: string; version: string; body: string }>(
        `SELECT code, title, version, coalesce(body, '') AS body FROM terms WHERE status IN ('DRAFT', 'LEGAL_REVIEW') ORDER BY display_order, code`),
      this.terms.outsourceCheck(),
      q<{ next: string | null; name: string | null; n: number }>(
        `SELECT to_char(min(day), 'YYYY-MM-DD') AS next, (SELECT name FROM public_holidays WHERE day >= (now() AT TIME ZONE 'Asia/Seoul')::date ORDER BY day LIMIT 1) AS name,
                count(*)::int AS n FROM public_holidays WHERE day >= (now() AT TIME ZONE 'Asia/Seoul')::date`),
      this.db.query<{ code: string; price: number }>(`SELECT code, monthly_price::float8 AS price FROM subscription_plans WHERE is_active ORDER BY monthly_price`),
      q<{ hold: number }>(`SELECT count(*)::int AS hold FROM hlt_open_stock WHERE state = 'HOLD'`),
      q<{ on: string | null; blocked: number }>(`SELECT (SELECT value FROM site_settings WHERE key = 'notify.ses_feedback') AS on,
                (SELECT count(*)::int FROM mail_suppressions WHERE released_at IS NULL) AS blocked`),
      this.town.readiness(),
      q<{ on: string | null; pending: number }>(`SELECT (SELECT value FROM site_settings WHERE key = 'agent.town_pick.enabled') AS on,
                (SELECT count(*)::int FROM town_pick_candidates WHERE state = 'PENDING') AS pending`),
      q<{ open: number; critical: number }>(`SELECT count(*)::int AS open, count(*) FILTER (WHERE severity = 'CRITICAL')::int AS critical FROM ops_alerts WHERE acknowledged_at IS NULL`),
      this.db.query<{ first: boolean; day: string; d: number; n: number; titles: string }>(
        `SELECT first, to_char(effective_from AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day,
                ((effective_from AT TIME ZONE 'Asia/Seoul')::date - (now() AT TIME ZONE 'Asia/Seoul')::date)::int AS d,
                count(*)::int AS n, string_agg(title || ' ' || version, ' · ' ORDER BY display_order, code) AS titles
           FROM (SELECT false AS first, effective_from, title, version, display_order, code FROM v_terms_upcoming
                 UNION ALL
                 SELECT true, effective_from, title, version, display_order, code FROM v_terms_current WHERE effective_from > now()) x
          GROUP BY 1, 2, 3 ORDER BY 1, 2`),
    ]);
    const holed = drafts.map((d) => ({ ...d, n: [...new Set(d.body.match(HOLE) ?? [])].filter((h) => h !== '〔시행일〕').length })).filter((d) => d.n > 0);
    const rows: StateRow[] = [
      { key: 'ai', label: 'AI 잠금', go: 'ai-ops',
        state: ai.ready ? 'ok' : 'todo',
        now: ai.ready ? `풀림 — 국외 이전 조항 처리방침 게시됨 · AI 스위치 ${ai.enabled === 'on' ? '켜짐' : '꺼짐'}`
                      : `잠김 — 국외 이전 조항이 든 처리방침이 게시되기 전(AI 스위치 ${ai.enabled === 'on' ? '켜짐 · 게시 순간 동작' : '꺼짐'})` },
      { key: 'terms', label: '약관 초안 빈칸', go: 'terms',
        state: holed.length ? 'todo' : 'ok',
        now: holed.length ? holed.map((d) => `${d.title} ${d.version} 〔미확정〕 ${d.n}곳`).join(' · ') : `초안 ${drafts.length}개 · 빈칸 없음` },
      /* v10.214 — 새 판 시행 예정(그날 앞 판이 바뀜) · 첫 판 적힌 시행일 전(이미 동의 기준) · 그날 3종 넘으면 수만 */
      { key: 'terms-upcoming', label: '약관 시행 예정', go: 'terms', state: 'info',
        now: [
          upcoming.some((u) => !u.first)
            ? '새 판 ' + upcoming.filter((u) => !u.first).map((u) => `${u.day}(${u.d}일 뒤) ${u.n > 3 ? `${u.n}종` : u.titles}`).join(' · ') + ' — 그날 앞 판이 바뀜'
            : '새 판 시행 예정 없음',
          ...(upcoming.some((u) => u.first)
            ? ['첫 판 ' + upcoming.filter((u) => u.first).map((u) => `${u.day}(${u.d}일 뒤) ${u.n > 3 ? `${u.n}종` : u.titles}`).join(' · ') + ' — 적힌 시행일 전이지만 게시 때부터 동의 기준']
            : []),
        ].join(' / ') },
      { key: 'outsource', label: '위탁 목록', go: 'terms',
        state: oc.lines.length ? 'warn' : oc.pending.length ? 'todo' : 'ok',
        now: oc.lines.length ? oc.lines.join(' · ') : oc.pending.length ? `초안에만 있음 ${oc.pending.length}줄(게시하면 해소)` : '쓰는 외부 서비스가 모두 시행 중인 글에 있음' },
      { key: 'holidays', label: '공휴일', go: 'siteinfo',
        state: hol.n > 0 ? 'ok' : 'warn',
        now: hol.n > 0 ? `다음 ${hol.next} ${hol.name} · 앞으로 ${hol.n}일` : '앞으로 남은 공휴일 없음 — 영업일 계산이 주말만 건너뜀' },
      { key: 'plans', label: '요금제 금액', go: 'billing', state: 'info',
        now: plans.map((p) => `${p.code} ${won(p.price)}`).join(' · ') || '없음' },
      { key: 'open-stock', label: '개봉 반품 재고', go: 'hlt-open',
        state: stock.hold > 0 ? 'todo' : 'ok', now: stock.hold > 0 ? `보관(폐기 대기) ${stock.hold}줄` : '보관 중인 것 없음' },
      { key: 'mail', label: '메일 반송 · 수신 거부', go: 'integrations', state: 'info',
        now: `받기 ${mail.on === 'on' ? '켜짐' : '꺼짐'} · 막힌 주소 ${mail.blocked}` },
      { key: 'town', label: '동네 인증', go: 'community',
        state: town.ready ? 'ok' : 'todo',
        now: `스위치 ${town.switchOn ? '켜짐' : '꺼짐'} · 약관 ${town.terms.published ? `${town.terms.version} 시행 중` : town.terms.draft ? `${town.terms.draft.version} 초안(빈칸 ${town.terms.draft.holes.length})` : '없음'}`
           + ` · 신고번호 ${town.reportNo.set ? '있음' : '없음'} · 카카오 키 ${town.kakao.set ? '있음' : '없음'}` },
      { key: 'town-pick', label: '동네픽 후보', go: 'community',
        state: pick.pending > 0 ? 'todo' : 'ok', now: `스위치 ${pick.on === 'on' ? '켜짐' : '꺼짐'} · 기다리는 후보 ${pick.pending}` },
      { key: 'alerts', label: '운영 알림', go: 'ops-alerts',
        state: alerts.critical > 0 ? 'warn' : alerts.open > 0 ? 'todo' : 'ok',
        now: alerts.open > 0 ? `확인 안 한 알림 ${alerts.open}건(CRITICAL ${alerts.critical})` : '확인 안 한 알림 없음' },
    ];
    return rows;
  }
}
