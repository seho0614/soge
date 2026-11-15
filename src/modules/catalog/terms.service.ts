import { Injectable } from '@nestjs/common';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { DatabaseService } from '../../db/database.service';
import { blockerOwner } from './open-blocker-owner';
import { buildReviewPack, PackTerm } from './terms-review-pack';
import { article17, RATE_TYPES, SLOT_TEXT, slotState, termRateCell } from './terms-rate-check';
import { rateNoticeSection, withRateNotice } from './terms-rate-notice-pack';
import { NOTICE_DAYS } from '../health/health-rate-schedule.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { RATE_NOTICE_QUESTIONS } from './terms-rate-notice-pack';
import { LEGAL_TOPIC_LABEL, LEGAL_TOPIC_TERM } from './terms.dto';
import { AgentService } from '../agent/agent.service';
import { GeoService } from '../../common/geo/geo.service';

/**
 * 약관 관리 (B-12).
 *
 * 법무 회신이 오면 여기로 들어옵니다. SQL 을 직접 치지 않게 하는 것이 목적입니다 —
 * 직접 치면 status 만 바꾸고 body 를 빼먹거나, 시행일을 과거로 넣습니다.
 *
 * 발행 조건은 DB 트리거(fn_assert_term_publish)가 강제합니다.
 */
/** v10.206 — 위탁 목록이 있는 글(처리방침 제5조 · 위탁 안내 제2조) */
const OUTSOURCE_CODES = ['PRIVACY', 'OUTSOURCE'];

/**
 * v10.304 (docs/426) — 약관 초안의 「개발 원문」: 킷에 든 게시용 완성본 문서(docs/NNN_*.md)의 「## 4. 전문」 ````markdown 칸.
 *   운영 초안을 운영 화면에서 고쳐 D207 이 덮어쓰지 않았을 때(11/15 운영 NOTICE) 차이를 화면에서 보려는 것 — 읽기만.
 */
export const TERM_SOURCES: { code: string; version: string; prefix: string }[] = [
  { code: 'HLT_SELLER', version: '1.0', prefix: '400_' },
  { code: 'PRIVACY', version: '1.1', prefix: '401_' },
];

/** v10.304 — 완성본 문서에서 붙여 넣을 전문만(「## 4. 전문」 아래 첫 ````markdown 칸) · 없으면 null */
export function termSourceBody(doc: string): string | null {
  const h = doc.indexOf('## 4. 전문');
  if (h < 0) return null;
  const open = doc.indexOf('````markdown\n', h);
  if (open < 0) return null;
  const from = open + '````markdown\n'.length;
  const end = doc.indexOf('\n````', from);
  return end < 0 ? null : doc.slice(from, end);
}

@Injectable()
export class TermsService {
  constructor(private readonly db: DatabaseService, private readonly agent: AgentService, private readonly geo: GeoService) {}

  /** v10.304 — 킷 docs 폴더에서 원문 파일 찾기(앱 폴더 기준 · 없으면 null) */
  private sourceFile(prefix: string): string | null {
    try {
      const dir = join(process.cwd(), 'docs');
      const f = readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith('.md')).sort()[0];
      return f ? join(dir, f) : null;
    } catch { return null; }
  }

  /** v10.304 (docs/426) — 개발 원문이 있는 약관 판 목록(파일이 있고 전문 칸을 읽을 수 있는 것만) */
  sources() {
    return TERM_SOURCES.flatMap((t) => {
      const f = this.sourceFile(t.prefix);
      if (!f) return [];
      try { return termSourceBody(readFileSync(f, 'utf8')) != null ? [{ code: t.code, version: t.version, file: f.split('/').pop()! }] : []; } catch { return []; }
    });
  }

  /** v10.304 — 그 약관 판의 개발 원문 전문(읽기만) · 없으면 404 */
  source(code: string, version: string) {
    const t = TERM_SOURCES.find((x) => x.code === String(code ?? '').toUpperCase() && x.version === String(version ?? ''));
    const f = t && this.sourceFile(t.prefix);
    let body: string | null = null;
    if (f) { try { body = termSourceBody(readFileSync(f, 'utf8')); } catch { body = null; } }
    if (!t || !f || body == null) throw new NotFound('이 약관 판의 개발 원문이 없습니다.');
    return { code: t.code, version: t.version, file: f.split('/').pop()!, body };
  }

  /** 관리자용. 미발행 약관도 보입니다. */
  async listAll() {
    /* v10.161 (D151) — 새 판이 시행된 약관의 앞 판을 먼저 보관으로(매시간 작업이 늦어도 화면은 지금 상태) */
    await this.db.query(`SELECT fn_terms_archive_due()`);
    return this.db.query(
      `SELECT t.code, t.version, t.title, coalesce(t.body,'') AS body, t.status,
              t.is_required AS "isRequired", t.blocked_by AS "blockedBy", t.change_note AS "changeNote",
              CASE WHEN t.effective_from = 'infinity' THEN NULL
                   ELSE t.effective_from END AS "effectiveFrom",
              /* v10.161 — 시행 예정(게시됐지만 시행 전 · 앞 판이 아직 시행 중) */
              EXISTS (SELECT 1 FROM v_terms_upcoming u WHERE u.code = t.code AND u.version = t.version) AS scheduled,
              /* v10.162 (D152) — 대상(제휴 약관은 회원 알림 없음) · 게시한 때 · 불리한 변경 */
              t.audience, t.published_at AS "publishedAt", t.is_adverse AS "isAdverse",
              /* v10.204 (D181 · docs/326) — 필수 약관 지금 시행 중인 판의 동의 현황(활동 중 계정 · v_term_not_agreed 와 같은 셈) */
              CASE WHEN t.is_required AND EXISTS (SELECT 1 FROM v_terms_current c WHERE c.code = t.code AND c.version = t.version) THEN json_build_object(
                'target', (SELECT count(*)::int FROM accounts WHERE status = 'ACTIVE'),
                'agreed', (SELECT count(*)::int FROM accounts a WHERE a.status = 'ACTIVE'
                             AND EXISTS (SELECT 1 FROM v_term_consent_current g
                                          WHERE g.account_id = a.id AND g.term_code = t.code AND g.term_version = t.version AND g.agreed)),
                'missing', (SELECT count(*)::int FROM v_term_not_agreed n WHERE n.code = t.code)) END AS consent
         FROM terms t ORDER BY t.display_order, t.code, t.effective_from DESC`);
  }

  /**
   * 초안 저장. 기존 버전을 덮지 않고 새 버전을 만듭니다 —
   * 이미 동의받은 문서를 고치면 동의 이력의 근거가 사라집니다.
   */
  async upsertDraft(code: string, dto: {
    version: string; title: string; body: string; isRequired?: boolean; changeNote?: string;
  }) {
    /* v10.159 (docs/243) — 새 판은 앞 판의 알림 여부(is_notice) · 대상(audience)을 이어받음.
     *   전에는 기본값(동의 항목 · 전체 회원)으로 만들어, 파트너 이용약관 새 판을 게시하면 모든 회원에게 동의를 받고 위탁 안내가 동의 항목이 될 수 있었음 */
    const [base] = await this.db.query<{ is_required: boolean; display_order: number; is_notice: boolean; audience: string }>(
      `SELECT is_required, display_order, is_notice, audience FROM terms WHERE code = $1
        ORDER BY (status = 'PUBLISHED') DESC, effective_from DESC LIMIT 1`, [code]);
    if (!base) throw new NotFound('약관 코드를 찾을 수 없습니다.');
    /* v10.157 (docs/239 · D150) — 운영 화면 「약관」 › 「고치기」가 부름.
     *   게시 · 보관된 판은 동의 기록의 근거라 같은 번호로 덮지 않음(전에는 ON CONFLICT 로 덮었음) → 새 번호로만. DB 트리거도 막음 */
    if (!/^\d{1,3}(\.\d{1,3}){0,2}$/.test(dto.version)) {
      throw new PolicyViolation('TERM_VERSION', '판 번호는 1.1 처럼 숫자와 점으로 적으십시오.');
    }
    const [same] = await this.db.query<{ status: string }>(
      `SELECT status FROM terms WHERE code = $1 AND version = $2`, [code, dto.version]);
    if (same && (same.status === 'PUBLISHED' || same.status === 'ARCHIVED')) {
      throw new PolicyViolation('TERM_LOCKED', `게시되었거나 보관된 판(${dto.version})은 고칠 수 없습니다 — 새 판 번호로 저장하십시오.`);
    }

    const [row] = await this.db.query(
      `INSERT INTO terms (code, version, title, body, is_required,
                          effective_from, status, display_order, is_notice, audience, change_note)
       VALUES ($1,$2,$3,$4,$5,'infinity','LEGAL_REVIEW',$6,$7,$8,$9)
       ON CONFLICT (code, version) DO UPDATE
         SET title = EXCLUDED.title, body = EXCLUDED.body,
             is_required = EXCLUDED.is_required, change_note = coalesce(EXCLUDED.change_note, terms.change_note)
       RETURNING code, version, status`,
      [code, dto.version, dto.title, dto.body,
       dto.isRequired ?? base.is_required, base.display_order, base.is_notice, base.audience,
       /* 재동의 화면 「바뀐 점」(D041) */ dto.changeNote?.trim() || null]);
    return { ...row, holes: TermsService.holes(dto.body).length };
  }

  /**
   * v10.205 (docs/328) — 게시 전 영향. 앞 판이 없으면(처음 게시) 시행일을 미래로 넣어도 게시하는 순간 「지금 판」(D151 v_terms_current) —
   *   필수 약관이면 활동 중 계정 모두 다음 로그인 때 동의 · 국외 이전 조항이 든 처리방침이면 AI 잠금이 바로 풀림. 게시 규칙은 바꾸지 않음(보여 주기만).
   */
  async publishPreview(code: string, version: string) {
    const [t] = await this.db.query<{ title: string; required: boolean; body: string; status: string }>(
      `SELECT title, is_required AS required, coalesce(body, '') AS body, status FROM terms WHERE code = $1 AND version = $2`, [code, version]);
    if (!t) throw new NotFound('해당 버전의 약관이 없습니다.');
    /* 게시(publish)와 같은 글(영어 사전에 있음) */
    if (t.status === 'PUBLISHED') throw new PolicyViolation('TERM_PUBLISHED', '이미 게시된 판입니다 — 시행일을 바꾸려면 「예정 취소」 뒤 다시 게시하십시오.');
    if (t.status === 'ARCHIVED') throw new PolicyViolation('TERM_ARCHIVED', '보관된 판은 게시할 수 없습니다 — 새 판을 만들어 게시하십시오.');
    const [r] = await this.db.query<{ current: string | null; target: number; ready: boolean; cap: string; enabled: boolean; review: boolean; chat: boolean }>(
      `SELECT (SELECT version FROM v_terms_current WHERE code = $1 AND version <> $2) AS current,
              (SELECT count(*)::int FROM accounts WHERE status = 'ACTIVE') AS target,
              public.fn_privacy_ai_ready() AS ready,
              coalesce(nullif((SELECT value FROM site_settings WHERE key = 'agent.monthly_cap_usd'), ''), '0') AS cap,
              coalesce((SELECT value FROM site_settings WHERE key = 'agent.enabled'), 'off') = 'on' AS enabled,
              coalesce((SELECT value FROM site_settings WHERE key = 'agent.review_shadow.enabled'), 'off') = 'on' AS review,
              coalesce((SELECT value FROM site_settings WHERE key = 'agent.chat.enabled'), 'off') = 'on' AS chat`, [code, version]);
    /* 국외 이전 조항 = fn_privacy_ai_ready 와 같은 규칙(제목 줄) */
    const aiUnlock = code === 'PRIVACY' && !r.ready && /(^|\n)#{1,4}[^\n]*국외 이전/.test(t.body);
    const aiGaps = aiUnlock
      ? [(await this.agent.keySource()) === 'NONE' ? 'AI 키 없음' : null, Number(r.cap) > 0 ? null : '월 상한 0', r.enabled ? null : 'AI 전체 꺼짐']
          .filter((x): x is string => !!x)
      : [];
    /* v10.206 (docs/330) — 처리방침 · 위탁 안내를 게시할 때 지금 쓰는 외부 서비스가 이 판의 위탁 목록에 없으면 */
    const outsourceGaps = OUTSOURCE_CODES.includes(code)
      ? (await this.outsourceUsed()).filter((x) => x.used && !x.re.test(t.body)).map((x) => `${x.name}(${x.why})`)
      : [];
    /* v10.310 (docs/433) — 입점 약관 게시 전 제17조 2항 요율 표가 운영 「입점 유형 요율」과 다르면(빈칸은 〔미확정〕으로 이미 막힘) */
    const rateGaps = code === 'HLT_SELLER'
      ? ((await this.rateCheck()).terms.find((x) => x.version === version)?.slots ?? [])
          .filter((x) => x.state === 'mismatch' || x.state === 'unset' || x.state === 'missing')
          .map((x) => `${x.label} — 약관 ${x.termText ?? '줄 없음'} · 운영 ${x.rate === null ? '비어 있음' : `${x.rate}%`}${x.scheduledRate !== null ? ` (예정 ${x.scheduledRate}% · ${x.scheduledDate})` : ''}: ${x.note}`)
      : [];
    return {
      code, version, title: t.title, first: !r.current, current: r.current, required: t.required, target: t.required ? r.target : 0,
      aiUnlock, aiGaps, aiSwitches: aiUnlock ? `검수 보조 ${r.review ? '켜짐' : '꺼짐'} · AI 상담 ${r.chat ? '켜짐' : '꺼짐'}` : '',
      outsourceGaps, rateGaps,
    };
  }

  /**
   * v10.310 (docs/433) — 입점 약관(HLT_SELLER) 게시 안 된 판 · 시행 중 판의 제17조 2항 요율 표 ↔ 운영 「입점 유형 요율」 · 예정 예약.
   *   ok = 판마다 두 줄이 모두 「같음」 또는 「예정 예약 값과 같음」. 읽기만.
   */
  async rateCheck() {
    const terms = await this.db.query<{ version: string; status: string; body: string; scheduled: boolean }>(
      `SELECT version, status, coalesce(body, '') AS body, (status = 'PUBLISHED' AND effective_from > now()) AS scheduled FROM terms
        WHERE code = 'HLT_SELLER' AND status <> 'ARCHIVED'
        ORDER BY string_to_array(regexp_replace(version, '[^0-9.]', '', 'g'), '.')::int[] DESC`);
    const rates = await this.db.query<{ type: string; rate: string | null; toRate: string | null; effectiveDate: string | null }>(
      `SELECT t.seller_type AS type, t.rate::text AS rate, s.to_rate::text AS "toRate",
              to_char(s.effective_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS "effectiveDate"
         FROM hlt_seller_type_rates t
         LEFT JOIN LATERAL (SELECT to_rate, effective_at FROM hlt_rate_schedules x
                             WHERE x.scope = 'TYPE' AND x.target = t.seller_type AND x.status = 'SCHEDULED' AND x.effective_at > now()
                             ORDER BY x.effective_at LIMIT 1) s ON true`);
    const num = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));
    const rateOf = (type: string) => rates.find((r) => r.type === type);
    const out = terms.map((t) => {
      const slots = RATE_TYPES.map(({ type, label }) => {
        const cell = termRateCell(t.body, label);
        const r = rateOf(type);
        const rate = num(r?.rate), sched = num(r?.toRate);
        const state = slotState(cell, rate, sched);
        return { type, label, termText: cell?.text ?? null, termValue: cell?.value ?? null, rate,
                 scheduledRate: sched, scheduledDate: r?.effectiveDate ?? null, state, note: SLOT_TEXT[state] };
      });
      return { version: t.version, status: t.status, scheduled: t.scheduled, slots, ok: slots.every((x) => x.state === 'match' || x.state === 'scheduled') };
    });
    return { terms: out, ok: out.length > 0 && out.every((x) => x.ok) };
  }

  /**
   * v10.313 (docs/437) — 게시 준비 한 장(읽기만): 빈칸 · 가장 이른 시행일 · 재동의 대상 · 회원 알림 · 위탁 목록 · 국외 이전(AI) · 제17조 요율 ·
   *   게시 뒤 켤 수 있게 되는 것. state = ok(준비됨) · todo(게시 전에 할 것) · info(알아 둘 것). ready = todo 가 없음.
   */
  async publishReady(code: string, version: string) {
    const pv = await this.publishPreview(code, version);
    const [t] = await this.db.query<{ body: string; audience: string | null; today: string; d7: string; d30: string; notify: boolean; taxId: boolean; tenant: boolean; town: boolean }>(
      `SELECT coalesce(t.body, '') AS body, t.audience, to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS today,
              to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 7, 'YYYY-MM-DD') AS d7, to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 30, 'YYYY-MM-DD') AS d30,
              coalesce((SELECT value FROM site_settings WHERE key = 'terms.notify_members'), 'on') = 'on' AS notify,
              coalesce((SELECT value FROM site_settings WHERE key = 'point.cashout_tax_id'), 'off') = 'on' AS "taxId",
              coalesce((SELECT value FROM site_settings WHERE key = 'mall.tenant_apply'), 'off') = 'on' AS tenant,
              coalesce((SELECT value FROM site_settings WHERE key = 'community.town_verify'), 'off') = 'on' AS town
         FROM terms t WHERE t.code = $1 AND t.version = $2`, [code, version]);
    const hs = [...new Set(TermsService.holes(t.body))];
    const items: Array<{ key: string; label: string; state: 'ok' | 'todo' | 'info'; text: string }> = [];
    items.push({ key: 'holes', label: '빈칸(〔미확정〕)', state: hs.length ? 'todo' : 'ok',
                 text: hs.length ? `${hs.length}곳 — ${hs.slice(0, 6).join(' · ')}${hs.length > 6 ? ' …' : ''} · 「고치기」 빈칸 도우미로 채움(법무가 정한 글)` : '없음' });
    items.push({ key: 'date', label: '시행일', state: 'info',
                 text: pv.first ? '앞 판이 없어 게시하는 순간 시행됩니다(시행일을 미래로 넣어도) — 시행하려는 날 게시'
                   : `넣을 수 있는 가장 이른 날 — 보통 ${t.d7}(시행 7일 전 고지) · 회원에게 불리한 변경이면 ${t.d30}(30일 전) · 이용약관 제14조 · 그때까지 지금 판 ${pv.current} 그대로` });
    items.push({ key: 'consent', label: '재동의', state: 'info',
                 text: pv.required ? `필수 약관 — 활동 중 계정 ${pv.target.toLocaleString('ko-KR')}명이 ${pv.first ? '게시 뒤' : '시행일부터'} 다음 로그인 때 동의` : '필수 약관이 아님 — 재동의 화면 없음' });
    items.push({ key: 'notify', label: '회원 알림', state: 'info',
                 text: pv.first ? '처음 게시 — 「약관 변경 안내」 알림 없음' : t.audience === 'PARTNER' ? '제휴 약관 — 회원 알림 없음'
                   : t.notify ? '게시하면 회원마다 「약관 변경 안내」 1건(사이트 안 · 메일 · 알림톡은 켜진 길로)' : '설정 terms.notify_members = off — 알림 안 보냄' });
    if (OUTSOURCE_CODES.includes(code))
      items.push({ key: 'outsource', label: '처리를 맡기는 곳(위탁) 표', state: pv.outsourceGaps.length ? 'todo' : 'ok',
                   text: pv.outsourceGaps.length ? `지금 쓰는데 표에 없음 — ${pv.outsourceGaps.join(' · ')}` : '지금 쓰는 외부 서비스가 모두 표에 있음' });
    if (code === 'PRIVACY')
      items.push({ key: 'ai', label: '국외 이전 조항 · AI', state: 'info',
                   text: pv.aiUnlock ? `시행되면 AI 잠금이 풀림 — ${pv.aiGaps.length ? `빠진 것: ${pv.aiGaps.join(' · ')}` : '키 · 월 상한 · AI 전체 갖춰짐'} · ${pv.aiSwitches}` : '이 판으로 AI 잠금이 바뀌지 않음' });
    if (code === 'HLT_SELLER')
      items.push({ key: 'rate', label: '제17조 요율 ↔ 입점 유형 요율', state: pv.rateGaps.length ? 'todo' : 'ok',
                   text: pv.rateGaps.length ? pv.rateGaps.join(' / ') : '빈칸이 아니면 운영 요율과 같음(빈칸은 위 「빈칸」)' });
    /* v10.316 (docs/441) — 법무 회신(D219): 이 약관에 이어진 주제(처리방침 → PRIVACY · 입점 약관 · 요율 인상 공지 방식 → HLT_SELLER)의 물음마다 가장 최근 답 */
    const lt = Object.entries(LEGAL_TOPIC_TERM).filter(([, c]) => c === code).map(([tp]) => tp);
    if (lt.length) {
      const [lg] = await this.db.query<{ answered: number; fix: number; fixQ: string | null }>(
        `SELECT count(*)::int AS answered, count(*) FILTER (WHERE answer = 'FIX')::int AS fix,
                string_agg(CASE WHEN answer = 'FIX' THEN topic || ' ' || q_no END, ' · ' ORDER BY topic, q_no) AS "fixQ"
           FROM (SELECT DISTINCT ON (topic, q_no) topic, q_no, answer FROM legal_replies WHERE topic = ANY($1::text[])
                  ORDER BY topic, q_no, created_at DESC, id DESC) l`, [lt]);
      const nm = (q: string) => q.replace(/^(\w+) (\d+)$/, (_m, tp: string, n: string) => `${LEGAL_TOPIC_LABEL[tp] ?? tp} ${n}번`);
      items.push({ key: 'legal', label: '법무 회신', state: lg.fix ? 'todo' : lg.answered ? 'ok' : 'info',
                   text: lg.fix ? `고쳐야 함 ${lg.fix}건 — ${(lg.fixQ ?? '').split(' · ').map(nm).join(' · ')} · 「법무 회신」 줄의 「이 약관 고치기」로 고친 뒤 같은 물음에 새 답을 적음`
                     : lg.answered ? `답 ${lg.answered}건 — 고쳐야 함 없음` : `아직 적은 답이 없음(${lt.map((tp) => LEGAL_TOPIC_LABEL[tp]).join(' · ')}) — 법무 답을 받으면 「법무 회신」에 적음` });
    }
    const after: string[] = [];
    if (code === 'PRIVACY') {
      const tax = t.body.includes('주민등록번호(암호화)');
      after.push(tax ? `포인트 출금 「주민등록번호 받기」(point.cashout_tax_id · 지금 ${t.taxId ? '켜짐' : '꺼짐'}) — 이 판이 시행된 뒤 켤 수 있음(SUPER)`
                     : '「주민등록번호 받기」 — 이 판에도 「주민등록번호(암호화)」 수집 줄이 없어 켤 수 없음');
      if (pv.aiUnlock) after.push('AI 상담 · 검수 보조 — 국외 이전 조항이 시행되면 잠금이 풀림(AI 전체 · 키 · 월 상한은 따로)');
    }
    if (code === 'HLT_SELLER') after.push(`소개몰 입점 신청 받기(mall.tenant_apply · 지금 ${t.tenant ? '켜짐' : '꺼짐'}) — 입점 약관이 게시된 뒤 켤 수 있음(SUPER)`);
    if (code === 'LOCATION') after.push(`동네 인증(community.town_verify · 지금 ${t.town ? '켜짐' : '꺼짐'}) — 위치기반 약관 시행 · 신고번호가 있어야 켬`);
    return { code, version, title: pv.title, first: pv.first, current: pv.current, ready: !items.some((x) => x.state === 'todo'), items, after };
  }

  /** v10.206 (docs/330) — 지금 쓰는 외부 서비스(처리를 맡기는 곳) · re = 위탁 표의 그 줄 */
  private async outsourceUsed() {
    const [mapOn, kakaoKey, aiKey] = await Promise.all([this.geo.enabled(), this.geo.restKey(), this.agent.keySource()]);
    return [
      { name: 'Amazon Web Services', used: true, why: '서버 · 저장소 · 메일', re: /Amazon Web Services/ },
      { name: 'Anthropic', used: aiKey !== 'NONE', why: aiKey !== 'NONE' ? 'AI 키 있음' : 'AI 키 없음', re: /\|\s*Anthropic/ },
      { name: '카카오', used: mapOn || !!kakaoKey, why: mapOn ? '지도 켜짐' : kakaoKey ? '카카오 키 있음' : '키 없음 · 지도 꺼짐', re: /\|\s*카카오\s*\|/ },
    ];
  }

  /**
   * v10.206 (docs/330) — 위탁 목록 점검(운영 화면 › 약관 맨 위). 지금 쓰는 외부 서비스가
   *   시행 중인 처리방침 · 위탁 안내(v_terms_current)의 표에 있나 · 없으면 게시 전 초안(DRAFT · LEGAL_REVIEW 가장 높은 판)에는 있나.
   *   글은 고치지 않음(법무) — 보여 주기만.
   */
  async outsourceCheck() {
    const docs = await this.db.query<{ code: string; title: string; current: string | null; curBody: string | null; draft: string | null; draftBody: string | null }>(
      `SELECT x.code, coalesce(c.title, d.title, x.code) AS title, c.version AS current, c.body AS "curBody", d.version AS draft, d.body AS "draftBody"
         FROM unnest($1::text[]) AS x(code)
         LEFT JOIN v_terms_current c ON c.code = x.code
         LEFT JOIN LATERAL (SELECT version, title, body FROM terms t WHERE t.code = x.code AND t.status IN ('DRAFT','LEGAL_REVIEW')
                             ORDER BY string_to_array(version, '.')::int[] DESC LIMIT 1) d ON true`, [OUTSOURCE_CODES]);
    const used = await this.outsourceUsed();
    const where = (re: RegExp, d: (typeof docs)[number]) =>
      d.curBody != null && re.test(d.curBody) ? 'CURRENT' : d.draftBody != null && re.test(d.draftBody) ? 'DRAFT' : 'NONE';
    const services = used.map((u) => ({ name: u.name, used: u.used, why: u.why,
      docs: docs.map((d) => ({ code: d.code, title: d.title, current: d.current, draft: d.draft, state: where(u.re, d) })) }));
    const lines: string[] = [];
    const pending: string[] = [];
    for (const s of services.filter((x) => x.used)) {
      for (const d of s.docs) {
        if (d.state === 'NONE') lines.push(`${s.name} — 쓰는 중(${s.why}) · ${d.title}에 없음${d.draft ? `(초안 ${d.draft} 에도 없음)` : ''}`);
        else if (d.state === 'DRAFT') pending.push(`${s.name} — ${d.title} 초안 ${d.draft} 에만 있음(게시하면 해소)`);
      }
    }
    return { services, lines, pending };
  }

  /**
   * 발행. 이 시점부터 가입 화면과 푸터에 나타납니다.
   * 내용이 비었거나 시행일이 없으면 DB 가 거부합니다.
   */
  async publish(code: string, dto: { version: string; effectiveFrom: string; adverse?: boolean }) {
    if (new Date(dto.effectiveFrom) < new Date(Date.now() - 86_400_000)) {
      throw new PolicyViolation(
        'EFFECTIVE_DATE_IN_PAST',
        '시행일을 과거로 지정할 수 없습니다. 동의 이력의 기준이 되는 날짜입니다.');
    }
    /* v10.156 (docs/237) — 운영 화면 「약관」 게시 단추가 부름. scripts/publish-terms.sh 와 같은 규칙:
     *   〔시행일〕 말고 〔…〕(미확정 표시)가 남아 있으면 거절(이용자에게 그 표시가 그대로 보임) · 본문의 〔시행일〕은 시행일로 채움 · 보관된 판은 게시하지 않음 */
    const [cur] = await this.db.query<{ body: string | null; status: string }>(
      `SELECT body, status FROM terms WHERE code = $1 AND version = $2`, [code, dto.version]);
    if (!cur) throw new NotFound('해당 버전의 약관이 없습니다.');
    if (cur.status === 'ARCHIVED') throw new PolicyViolation('TERM_ARCHIVED', '보관된 판은 게시할 수 없습니다 — 새 판을 만들어 게시하십시오.');
    /* v10.161 — 게시된 판을 다시 게시하면 시행일이 덮임(동의 기록의 기준 날짜가 바뀜) → 시행 예정이면 「예정 취소」 뒤 다시 */
    if (cur.status === 'PUBLISHED') throw new PolicyViolation('TERM_PUBLISHED', '이미 게시된 판입니다 — 시행일을 바꾸려면 「예정 취소」 뒤 다시 게시하십시오.');
    const holes = TermsService.holes(cur.body);
    if (holes.length) {
      throw new PolicyViolation('TERM_HOLES',
        `미확정 표시 ${holes.length}곳이 남아 있습니다(${holes.slice(0, 3).join(' · ')}${holes.length > 3 ? ' …' : ''}) — 법무 확인 뒤 채운 다음 게시하십시오.`);
    }
    const day = String(dto.effectiveFrom).slice(0, 10);
    /* v10.161 (D151) — 새 판 시행일은 지금 시행 중인(또는 첫 판으로 예정된) 판보다 뒤. 앞이면 그 날짜가 지난 뒤 옛 판이 다시 「지금 판」이 됨 */
    const [now_] = await this.db.query<{ version: string; later: boolean; day: string }>(
      `SELECT version, effective_from >= $3::timestamptz AS later, to_char(effective_from AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day
         FROM v_terms_current WHERE code = $1 AND version <> $2`, [code, dto.version, dto.effectiveFrom]);
    if (now_?.later) throw new PolicyViolation('TERM_DATE_BEFORE_CURRENT', `지금 판(${now_.version})의 시행일(${now_.day})보다 뒤의 날짜로 게시하십시오.`);
    /* v10.162 (D152 · docs/248) — 회원에게 불리한 변경은 시행 30일 전 고지(이용약관 제14조) · 앞 판이 있을 때만(처음 게시는 바꾸는 것이 아님) */
    if (dto.adverse && now_ && new Date(dto.effectiveFrom).getTime() < Date.now() + 30 * 86_400_000) {
      throw new PolicyViolation('TERM_ADVERSE_30D', '회원에게 불리한 변경은 시행일을 오늘부터 30일 뒤 이후로 정하십시오(이용약관 제14조).');
    }
    /* v10.161 (D151 · docs/246) — 시행 예정 판은 약관마다 하나. 둘이면 어느 글이 언제 시행되는지 회원이 알 수 없음 */
    const [dup] = await this.db.query<{ version: string }>(
      `SELECT version FROM v_terms_upcoming WHERE code = $1 AND version <> $2`, [code, dto.version]);
    if (dup) throw new PolicyViolation('TERM_SCHEDULED_EXISTS', `시행 예정인 판(${dup.version})이 이미 있습니다 — 먼저 그 판의 「예정 취소」를 하십시오.`);
    /* v10.318 (docs/443) — 게시하는 때의 게시 준비 결과를 응답 · 감사 기록(TERM_PUBLISH after_data)에 남김 · 막지는 않음(빈칸은 위에서 이미 거절) */
    const rd = await this.publishReady(code, dto.version);
    const readyCheck = { ready: rd.ready, todo: rd.items.filter((x) => x.state === 'todo').map((x) => x.label), info: rd.items.filter((x) => x.state === 'info').length };

    return this.db.transaction(async () => {
      const [row] = await this.db.query<{ code: string; version: string; status: string }>(
        `UPDATE terms
            SET status = 'PUBLISHED', effective_from = $3, blocked_by = NULL, body = replace(body, '〔시행일〕', $4),
                published_at = now(), is_adverse = $5
          WHERE code = $1 AND version = $2
        RETURNING code, version, status`,
        [code, dto.version, dto.effectiveFrom, day, !!dto.adverse]);
      if (!row) throw new NotFound('해당 버전의 약관이 없습니다.');

      /* 앞 판은 보관 처리 — 삭제하지 않습니다(동의 이력이 참조). v10.161 (D151): 시행일이 지난 판만 지금, 시행 예정이면 앞 판은
       *   시행일까지 게시 그대로(그동안 회원은 앞 판 기준 · 재동의는 시행일부터) — 시행일이 되면 매시간 작업이 보관으로 바꿈 */
      const [a] = await this.db.query<{ n: number }>(`SELECT fn_terms_archive_due() AS n`);
      const [sc] = await this.db.query<{ scheduled: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM v_terms_upcoming WHERE code = $1 AND version = $2) AS scheduled`, [code, dto.version]);

      const notified = sc.scheduled ? await this.notifyMembers(code, dto.version, day, now_?.version ?? null) : 0;

      const [n] = await this.db.query<{ c: string }>(
        `SELECT count(*) AS c FROM v_open_blockers`);
      return { ...row, scheduled: sc.scheduled, archived: a.n, notified, remainingBlockers: Number(n.c), readyCheck };
    });
  }

  /**
   * v10.161 (D151 · docs/246) — 시행 예정 판 게시 취소(SUPER · 감사 TERM_UNSCHEDULE).
   *   시행일 전이고 그 판에 받은 동의가 없을 때만. 법무 검토로 되돌리고(시행일 없음) 본문의 시행일 날짜는 〔시행일〕로 되돌림 — 다시 게시할 때 새 날짜로 채움
   */
  async unschedule(code: string, version: string) {
    const [t] = await this.db.query<{ status: string; future: boolean; day: string; agreed: string }>(
      `SELECT status, EXISTS (SELECT 1 FROM v_terms_upcoming u WHERE u.code = t.code AND u.version = t.version) AS future, to_char(effective_from AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day,
              (SELECT count(*) FROM term_agreements a WHERE a.term_code = t.code AND a.term_version = t.version) AS agreed
         FROM terms t WHERE code = $1 AND version = $2`, [code, version]);
    if (!t) throw new NotFound('해당 버전의 약관이 없습니다.');
    if (t.status !== 'PUBLISHED' || !t.future) throw new PolicyViolation('TERM_NOT_SCHEDULED', '시행 예정인 게시 판만 취소할 수 있습니다 — 이미 시행된 판은 새 판으로 바꾸십시오.');
    if (Number(t.agreed) > 0) throw new PolicyViolation('TERM_HAS_CONSENT', `이 판에 이미 동의한 기록이 ${t.agreed}건 있어 취소할 수 없습니다 — 새 판으로 바꾸십시오.`);
    return this.db.transaction(async () => {
      /* 상태 먼저(게시 판은 글을 못 고침 · D150) → 법무 검토가 된 뒤 글의 날짜를 되돌림 */
      await this.db.query(`UPDATE terms SET status = 'LEGAL_REVIEW', effective_from = 'infinity', published_at = NULL, is_adverse = false WHERE code = $1 AND version = $2`, [code, version]);
      await this.db.query(`UPDATE terms SET body = replace(body, $3, '〔시행일〕') WHERE code = $1 AND version = $2`, [code, version, t.day]);
      /* v10.162 (D152) — 변경 안내를 받은 회원에게 취소 안내 */
      const notified = await this.notifyMembers(code, version, t.day, null, true);
      return { code, version, status: 'LEGAL_REVIEW', notified };
    });
  }

  /**
   * v10.162 (D152 · docs/248) — 시행 예정 게시 · 예정 취소 때 회원마다 「약관 변경 안내」 알림 1건(사이트 안).
   *   전체 회원 대상 약관만(제휴 약관은 빼고) · 설정 terms.notify_members = off 면 만들지 않음 · 메일 · 알림톡은 그 채널이 켜진 뒤 notify_dispatch 가 보냄.
   *   알림 링크 /terms?notice={code}@{version}#upcoming-terms 가 판을 가리킴(template_code 는 알림 양식 표를 가리켜 쓰지 않음) — 예정 취소 안내는 그 링크로 알림을 받은 회원에게만. 만든 수를 돌려줌
   */
  private async notifyMembers(code: string, version: string, day: string, prev: string | null, cancel = false) {
    const [t] = await this.db.query<{ title: string; is_required: boolean; change_note: string | null; audience: string; notify_on: boolean }>(
      `SELECT title, is_required, change_note, audience,
              coalesce((SELECT value FROM site_settings WHERE key = 'terms.notify_members'), 'on') = 'on' AS notify_on
         FROM terms WHERE code = $1 AND version = $2`, [code, version]);
    if (!t || !t.notify_on || t.audience !== 'ALL') return 0;
    const link = `/terms?notice=${code}@${version}`;   // 약관 코드 · 판 번호는 영문 대문자 · 숫자 · 점(TERM_VERSION)이라 그대로
    /* 알림 본문의 {영문} 은 DB 가 「치환 안 된 변수」로 거절(fn_assert_no_unresolved_vars) — 바뀐 점 글의 중괄호는 괄호로 */
    const note = (t.change_note ?? '').replace(/\{([a-zA-Z]+)\}/g, '($1)').trim();
    const title = cancel ? `[약관 변경 취소] ${t.title}` : `[약관 변경 안내] ${t.title} ${version}`;
    const body = cancel
      ? `${day} 시행 예정이던 ${t.title} ${version} 변경이 취소되었습니다. 지금 약관이 그대로 적용됩니다.`
      : [`${t.title}이(가) ${day}부터 바뀝니다${prev ? `(지금 판 ${prev} → ${version})` : ''}.`,
         note ? `바뀐 점: ${note.slice(0, 300)}` : '바뀐 점은 약관 화면에서 확인하십시오.',
         t.is_required ? '시행일 전까지는 지금 약관이 적용되고, 시행일부터 다시 동의를 받습니다.' : '시행일 전까지는 지금 약관이 적용됩니다.'].join(' ');
    const rows = await this.db.query(
      cancel
        ? `INSERT INTO notifications (account_id, event_code, template_code, title, body, link_url)
           SELECT DISTINCT n.account_id, 'TERM_CHANGE_NOTICE', NULL, $2, $3, $1::text || '&cancel=1'
             FROM notifications n JOIN accounts a ON a.id = n.account_id
            WHERE n.event_code = 'TERM_CHANGE_NOTICE' AND n.link_url = $1::text || '#upcoming-terms' AND a.status = 'ACTIVE' AND a.withdrawn_at IS NULL
           RETURNING id`
        : `INSERT INTO notifications (account_id, event_code, template_code, title, body, link_url)
           SELECT a.id, 'TERM_CHANGE_NOTICE', NULL, $2, $3, $1::text || '#upcoming-terms'
             FROM accounts a WHERE a.status = 'ACTIVE' AND a.withdrawn_at IS NULL
           RETURNING id`,
      [link, title, body]);
    return rows.length;
  }

  /** v10.156 — 본문의 미확정 표시(〔…〕 · 〔시행일〕 은 게시가 채우므로 뺌) */
  static holes(body: string | null | undefined): string[] {
    return (String(body ?? '').match(/〔[^〕]*〕/g) ?? []).filter((m) => m !== '〔시행일〕');
  }

  /**
   * v10.201 (docs/318) — 법무 검토 묶음: 약관마다 가장 높은 번호의 게시 안 된 판(초안 · 법무 검토)을 지금 시행 중인 게시판과 비교해
   *   HTML 한 파일로(읽기만). 화면이 받아서 파일로 내려받게 함 — fileName · html · items(요약)
   */
  async reviewPack() {
    const rows = await this.db.query<{ code: string; title: string; version: string; status: string; body: string; blockedBy: string | null; changeNote: string | null; baseVersion: string | null; baseBody: string | null; day: string }>(
      `SELECT d.code, d.title, d.version, d.status, coalesce(d.body, '') AS body, d.blocked_by AS "blockedBy", d.change_note AS "changeNote",
              p.version AS "baseVersion", p.body AS "baseBody", to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day
         FROM (SELECT DISTINCT ON (code) * FROM terms WHERE status IN ('DRAFT', 'LEGAL_REVIEW')
                ORDER BY code, string_to_array(regexp_replace(version, '[^0-9.]', '', 'g'), '.')::int[] DESC, effective_from DESC) d
         LEFT JOIN LATERAL (SELECT t.version, coalesce(t.body, '') AS body FROM terms t
                             WHERE t.code = d.code AND t.status = 'PUBLISHED'
                             ORDER BY (t.effective_from <= now()) DESC, t.effective_from DESC LIMIT 1) p ON true
        ORDER BY d.display_order, d.code`);
    const [{ day }] = rows.length ? rows : await this.db.query<{ day: string }>(`SELECT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day`);
    const terms: PackTerm[] = rows.map((r) => ({
      code: r.code, title: r.title, version: r.version, status: r.status, body: r.body, blockedBy: r.blockedBy, changeNote: r.changeNote,
      base: r.baseVersion ? { version: r.baseVersion, body: r.baseBody ?? '' } : null,
    }));
    const { items, html } = buildReviewPack(terms, day);
    /* v10.311 (docs/434) — 부록 「요율 인상 공지 방식」(입점 약관 제17조 4항 · 법무에 묻는 것) */
    const rn = await this.rateNoticeInfo();
    return { fileName: `sogaebank_terms_legal_review_${day.replace(/-/g, '')}.html`, day, items, html: withRateNotice(html, rateNoticeSection(rn)), rateNotice: true };
  }

  /** v10.314 (D219 · docs/438) — 법무 회신 목록(최근 200) · 주제마다 물음별 가장 최근 답 수 */
  async legalReplies() {
    const rows = await this.db.query<{ id: string; topic: string; qNo: number; answer: string; opinion: string | null; reviewer: string; repliedOn: string; by: string | null; at: string; latest: boolean }>(
      `SELECT r.id::text AS id, r.topic, r.q_no AS "qNo", r.answer, r.opinion, r.reviewer, to_char(r.replied_on, 'YYYY-MM-DD') AS "repliedOn",
              a.name AS by, to_char(r.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at,
              NOT EXISTS (SELECT 1 FROM legal_replies x WHERE x.topic = r.topic AND x.q_no = r.q_no AND (x.created_at, x.id) > (r.created_at, r.id)) AS latest
         FROM legal_replies r LEFT JOIN accounts a ON a.id = r.created_by
        ORDER BY r.created_at DESC, r.id DESC LIMIT 200`);
    const topics = await this.db.query<{ topic: string; answered: number; ok: number; fix: number; note: number }>(
      `SELECT topic, count(*)::int AS answered, count(*) FILTER (WHERE answer = 'OK')::int AS ok,
              count(*) FILTER (WHERE answer = 'FIX')::int AS fix, count(*) FILTER (WHERE answer = 'NOTE')::int AS note
         FROM (SELECT DISTINCT ON (topic, q_no) topic, q_no, answer FROM legal_replies ORDER BY topic, q_no, created_at DESC, id DESC) l
        GROUP BY topic ORDER BY topic`);
    return { rows: rows.map((r) => ({ ...r, termCode: LEGAL_TOPIC_TERM[r.topic] ?? null })), topics, rateNoticeQuestions: RATE_NOTICE_QUESTIONS.length };
  }

  /** v10.314 — 법무 회신 한 줄 적기(SUPER · 쌓기만 · 답한 날은 오늘(한국)까지) */
  async addLegalReply(dto: { topic: string; qNo: number; answer: string; opinion?: string; reviewer: string; repliedOn: string }) {
    const reviewer = dto.reviewer.trim();
    if (!reviewer) throw new PolicyViolation('REVIEWER_REQUIRED', '확인한 사람을 적어 주십시오.');
    if (dto.topic === 'RATE_NOTICE' && dto.qNo > RATE_NOTICE_QUESTIONS.length)
      throw new PolicyViolation('LEGAL_Q_RANGE', `요율 인상 공지 방식 물음은 1 ~ ${RATE_NOTICE_QUESTIONS.length}번입니다.`);
    const [r] = await this.db.query<{ id: string; future: boolean }>(
      `WITH chk AS (SELECT $6::date > (now() AT TIME ZONE 'Asia/Seoul')::date AS future)
       INSERT INTO legal_replies (topic, q_no, answer, opinion, reviewer, replied_on, created_by)
       SELECT $1, $2, $3, nullif(btrim($4), ''), $5, $6::date, $7 FROM chk WHERE NOT chk.future
       RETURNING id::text AS id, false AS future`,
      [dto.topic, dto.qNo, dto.answer, dto.opinion ?? '', reviewer, dto.repliedOn.slice(0, 10), RequestCtx.actorId()]);
    if (!r) throw new PolicyViolation('REPLIED_ON_FUTURE', '답한 날은 오늘(한국 날짜)까지만 적을 수 있습니다.');
    return { ok: true, id: r.id, note: '법무 회신을 적었습니다(고치거나 지울 수 없음 — 바꾸려면 같은 물음에 다시 적으면 그 줄이 지금 답).' };
  }

  /** v10.311 — 부록에 넣을 지금 값(설정 · 숫자 · 제17조 4항 글 · 요율 표 대조) */
  private async rateNoticeInfo() {
    const [c] = await this.db.query<{ total: number; scheduled: number; applied: number; canceled: number; noticed: number; reminds: number; autoReminds: number; snaps: number; days: number; email: boolean; sms: boolean; body: string | null }>(
      `SELECT (SELECT count(*)::int FROM hlt_rate_schedules) AS total,
              (SELECT count(*)::int FROM hlt_rate_schedules WHERE status = 'SCHEDULED') AS scheduled,
              (SELECT count(*)::int FROM hlt_rate_schedules WHERE status = 'APPLIED') AS applied,
              (SELECT count(*)::int FROM hlt_rate_schedules WHERE status = 'CANCELED') AS canceled,
              (SELECT count(*)::int FROM hlt_rate_schedules r JOIN notices n ON n.id = r.notice_id WHERE n.published_at <= now()) AS noticed,
              (SELECT count(*)::int FROM hlt_rate_reminds) AS reminds,
              (SELECT count(*)::int FROM hlt_rate_reminds WHERE auto) AS "autoReminds",
              (SELECT count(*)::int FROM hlt_rate_read_snaps) AS snaps,
              coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'hlt.rate_auto_remind_days'), 0) AS days,
              coalesce((SELECT value FROM site_settings WHERE key = 'notify.email_verified'), 'off') = 'on' AS email,
              coalesce((SELECT value FROM site_settings WHERE key = 'notify.alimtalk_ready'), 'off') = 'on' AS sms,
              (SELECT coalesce(body, '') FROM terms WHERE code = 'HLT_SELLER' AND status <> 'ARCHIVED'
                ORDER BY string_to_array(regexp_replace(version, '[^0-9.]', '', 'g'), '.')::int[] DESC LIMIT 1) AS body`);
    const clause4 = article17(c.body ?? '').split('\n').map((l) => l.trim()).find((l) => /^4\.\s/.test(l)) ?? null;
    const rc = await this.rateCheck();
    return {
      noticeDays: NOTICE_DAYS, autoRemindDays: c.days, clause4,
      counts: { total: c.total, scheduled: c.scheduled, applied: c.applied, canceled: c.canceled, noticed: c.noticed, reminds: c.reminds, autoReminds: c.autoReminds, snaps: c.snaps },
      channels: `사이트 안 알림 켜짐 · 메일 ${c.email ? '켜짐' : '꺼짐'} · 문자(알림톡) ${c.sms ? '켜짐' : '꺼짐'}`,
      slots: rc.terms.flatMap((t) => t.slots.map((x) => ({ version: t.version, status: t.status, label: x.label, termText: x.termText, rate: x.rate, note: x.note }))),
    };
  }

  /** 오픈 차단 항목. 설정·약관·푸터를 함께 봅니다. v10.200 — 줄마다 누가(owner) · 풀리는 방법(how) */
  async blockers() {
    const rows = await this.db.query<{ kind: string; item: string; reason: string }>(`SELECT kind, item, reason FROM v_open_blockers`);
    return rows.map((r) => ({ ...r, ...blockerOwner(r.kind, r.item) }));
  }

  /** v10.146 (D142) — 오픈 준비 점검 8줄(꼭 4 · 권장 4). 설정 값만 읽습니다. */
  readiness() {
    return this.db.query(
      `SELECT code, label, required, ok, now_value AS "nowValue", todo, go FROM v_open_readiness ORDER BY sort`);
  }

  /** v10.150 (D144 · docs/230) — 오픈일 · 홍보 기간 종료일 · 약관 게시 마감(한국 시간) */
  async openDate() {
    const [r] = await this.db.query<Record<string, any>>(
      `WITH v AS (
         SELECT nullif(btrim((SELECT value FROM site_settings WHERE key = 'service.open_date')), '')::date AS od,
                nullif(btrim((SELECT value FROM site_settings WHERE key = 'request.view.limit_from')), '') AS pe,
                (now() AT TIME ZONE 'Asia/Seoul')::date AS today)
       SELECT to_char(od, 'YYYY-MM-DD') AS "openDate", pe AS "promoEndsOn",
              to_char(od - 7, 'YYYY-MM-DD') AS "termsPublishBy", to_char(od - 30, 'YYYY-MM-DD') AS "termsUnfavorableBy",
              (od - today) AS "daysLeft",
              CASE WHEN od IS NULL THEN 0 ELSE (SELECT count(*) FROM (SELECT DISTINCT ON (code) effective_from FROM terms
                WHERE status = 'PUBLISHED' ORDER BY code, effective_from DESC) t
                WHERE (t.effective_from AT TIME ZONE 'Asia/Seoul')::date <> od) END::int AS "termsOtherDate"
         FROM v`);
    return r;
  }

  /** v10.150 — 오픈일 넣기(SUPER). 날짜를 넣으면 홍보 기간 종료일 = 오픈 + 3개월 을 함께 넣음 · 빈 값이면 오픈일만 지움 */
  async setOpenDate(date: string) {
    const d = (date ?? '').trim();
    if (d) {
      const [chk] = await this.db.query<{ past: boolean; valid: boolean }>(
        `SELECT to_char($1::date, 'YYYY-MM-DD') = $2::text AS valid, $1::date < (now() AT TIME ZONE 'Asia/Seoul')::date AS past`, [d, d])
        .catch(() => [{ valid: false, past: false }]);
      if (!chk.valid) throw new PolicyViolation('OPEN_DATE_INVALID', '없는 날짜입니다.');
      if (chk.past) throw new PolicyViolation('OPEN_DATE_PAST', '오픈일은 오늘 이후여야 합니다.');
    }
    await this.db.transaction(async () => {
      await this.db.query(`UPDATE site_settings SET value = $1 WHERE key = 'service.open_date'`, [d]);
      if (d) {
        await this.db.query(
          `UPDATE site_settings SET value = to_char($1::date + interval '3 months', 'YYYY-MM-DD') WHERE key = 'request.view.limit_from'`, [d]);
      }
    });
    return this.openDate();
  }
}

