import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { recentServerErrors, serverErrorsSince } from '../../common/server-error-count';
import { serverHealth } from '../../common/server-health';
import { rateLimitedSince } from '../../common/api-rate-limit';
import { cspReportsDay, restoreCspPending, takeCspPending } from '../../common/csp-report';
import { slowSince } from '../../common/response-time';
import { slowSqlSince } from '../../common/slow-sql';
import { uploadsBackupState, uploadsBackupVerified } from '../../common/uploads-backup-state';
import { AgentService } from '../agent/agent.service';
import { AlertChannelsService, ChannelState } from './alert-channels.service';

/* ---------------------------------------------------------------------
 * v10.170 (D159 · docs/262) — 공개 직후 지켜보기
 *
 *   사용자 웹을 전체 공개(11/1 · open-blockers #27)한 뒤 오늘(한국 날짜) 무엇이 들어오는지 한눈에 —
 *   가입 · 로그인 · 소개광장 글 · 매물 · 소개몰 주문 · **시험 결제(stub)로 결제 완료된 주문** · 확인 안 한 운영 알림 · 스위치 상태.
 *   시험 결제 주문은 돈을 받지 않은 주문입니다(결제대행사 연결 전) — 생기면 정기 작업 launch_watch 가 운영 알림을 남깁니다.
 * ------------------------------------------------------------------- */
const TODAY = `(now() AT TIME ZONE 'Asia/Seoul')::date`;
const KST = (col: string) => `(${col} AT TIME ZONE 'Asia/Seoul')::date = ${TODAY}`;
const diskLine = (h: ReturnType<typeof serverHealth>) => (h.disk
  ? `서버 디스크 ${h.disk.usedPct}% 사용 · 남은 ${h.disk.freeGB}GB${h.disk.usedPct >= 85 ? ' — 정리 · 늘리기 필요' : ''} · 메모리 ${h.mem.usedPct}%`
  : '서버 디스크 — 잴 수 없음');


/* v10.238 (docs/379) — 하루 요약 「급한 알림 받는 길」 한 줄 · 하나도 없으면 그 뜻까지 */
function channelLine(c: { list: ChannelState[]; ready: number }): string {
  return `급한 알림 받는 길 ${c.ready} / 3: ${AlertChannelsService.line(c.list)}${c.ready ? '' : ' — 하나도 없어 급한 알림이 운영 화면 밖으로 나가지 않습니다'}`;
}

/* v10.204 (D181 · docs/326) — 하루 요약 · 공개 직후 지켜보기의 AI 줄
 *   v10.215 (docs/345) — 잠금 글을 「지금 판」 기준으로(첫 판은 게시 · 새 판은 시행일부터 · 운영 상태 한눈에 AI 줄과 같음) */
export type AgentDay = { enabled: boolean; unlocked: boolean; chats: number; answers: number; handoffs: number; reviews: number;
  requests: number; cost: string; month: string; cap: string };
export const agentLines = (a: AgentDay, label: string): string[] => {
  if (!a.unlocked && a.requests === 0) return ['AI — 잠김(국외 이전 조항이 든 처리방침이 지금 판이 되기 전 — 첫 판은 게시 · 새 판은 시행일부터)'];
  if (!a.enabled && a.requests === 0) return ['AI — 꺼짐'];
  const cap = Number(a.cap);
  return [
    `AI — ${label} 상담 대화 ${a.chats} · 답 ${a.answers} · 사람에게 넘김 ${a.handoffs} · 검수 보조 ${a.reviews}건 · 비용 $${a.cost}${a.enabled ? '' : ' · 지금 꺼짐'}`,
    `     이번 달 $${a.month} / 상한 $${a.cap}${cap > 0 ? ` (${Math.floor((100 * Number(a.month)) / cap)}%)` : ' — 상한 0 이면 부르지 않음'}`,
  ];
};
/* v10.204 — 필수 약관(지금 시행 중인 판)마다 동의 안 한 활동 중 계정이 있으면 한 줄씩 */
export type Reconsent = { code: string; title: string; version: string; target: number; agreed: number; missing: number };
export const reconsentLines = (rows: Reconsent[]): string[] => rows.filter((r) => r.missing > 0).map((r) =>
  `재동의 — ${r.title} ${r.version}: ${r.agreed} / ${r.target} (${r.target ? Math.floor((100 * r.agreed) / r.target) : 0}%) · 남음 ${r.missing}`);
/* v10.205 (docs/328) — AI 켜기 단계(GET /admin/agent/rollout 과 같은 셈) 한 줄 · 처리방침 시행 전이면 줄 없음(위 「AI — 잠김」) */
export type AgentStep = { step: number; code: string; label: string; on: boolean; state: string; now: string };
export const agentStepLine = (steps: AgentStep[]): string[] => {
  if (!steps.length || steps[0].state !== 'DONE') return [];
  const cur = [...steps].reverse().find((x) => x.on) ?? steps[0];
  const next = steps.find((x) => x.step > cur.step && !x.on);
  if (!next) return [`AI 켜기 단계 — 모두 켜짐 · 마지막 ${cur.step} ${cur.label}: ${cur.now}`];
  return [`AI 켜기 단계 — 지금 ${cur.step} ${cur.label}: ${cur.now} · 다음 ${next.step} ${next.label}: ${next.state === 'READY' ? '할 차례' : '앞 단계 기준 전'}`];
};
/* v10.206 (D183 · docs/330) — AI 첫 주 보고(GET /admin/agent/week) 7일 합 한 줄 · 7일 동안 쓴 것이 없으면 줄 없음 */
export type AgentWeekTotal = { used: boolean; below: string[]; total: { answeredPct: number | null; agreePct: number | null; costUsd: number; chats: number; opinions: number } };
export const agentWeekLine = (w: AgentWeekTotal): string[] => {
  if (!w.used) return [];
  const t = w.total;
  return [`AI 7일 — 상담 대화 ${t.chats} · 답 ${t.answeredPct ?? '—'}% · 검수 의견 ${t.opinions} · 일치율 ${t.agreePct ?? '—'}% · 비용 $${t.costUsd}${w.below.length ? ` · 기준 미달: ${w.below.join(' · ')}` : ''}`];
};
/** 「할 차례」 알림을 보내는 단계 — 처리방침 · 키 단계는 AGENT_LIVE 가 알림 */
const STEP_ALERT = ['REVIEW', 'CHAT', 'LOOKUP', 'DRAFTS'];

@Injectable()
export class LaunchWatchService {
  constructor(private readonly db: DatabaseService, private readonly agent: AgentService, private readonly channels: AlertChannelsService) {}

  async today() {
    const [c] = await this.db.query<any>(
      `SELECT (SELECT count(*)::int FROM accounts WHERE ${KST('created_at')}) AS signups,
              (SELECT count(*)::int FROM accounts WHERE last_login_at IS NOT NULL AND ${KST('last_login_at')}) AS logins,
              (SELECT count(*)::int FROM posts WHERE ${KST('created_at')}) AS posts,
              (SELECT count(*)::int FROM listings WHERE ${KST('created_at')}) AS listings,
              (SELECT count(*)::int FROM hlt_orders WHERE ${KST('created_at')}) AS orders,
              (SELECT count(*)::int FROM hlt_orders WHERE paid_at IS NOT NULL AND ${KST('paid_at')}) AS "paidOrders",
              (SELECT count(DISTINCT p.order_id)::int FROM hlt_payments p WHERE p.stub AND p.state = 'PAID' AND ${KST('coalesce(p.approved_at, p.created_at)')}) AS "stubPaidOrders",
              (SELECT count(*)::int FROM ops_alerts WHERE acknowledged_at IS NULL AND resolved_at IS NULL AND severity IN ('WARN', 'CRITICAL')) AS "openAlerts",
              coalesce((SELECT value FROM site_settings WHERE key = 'mall.order_open'), 'on') AS "orderOpen",
              coalesce((SELECT value FROM site_settings WHERE key = 'assume.payment'), 'off') AS "assumePayment",
              (SELECT nullif(value, '') FROM site_settings WHERE key = 'mall.order_open_until') AS "orderOpenUntil",
              (SELECT count(DISTINCT kind)::int FROM v_poll_home) AS "homePolls",
              coalesce((SELECT value FROM site_settings WHERE key = 'ops.digest_to'), '') AS "digestTo",
              coalesce((SELECT value FROM site_settings WHERE key = 'signup.open'), 'on') AS "signupOpen",
              coalesce((SELECT value FROM site_settings WHERE key = 'site.notice_bar'), '') AS "noticeBar",
              coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'ops.slow_p95_ms'), 1500) AS "slowLimitMs",
              coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'ops.disk_warn_pct'), 85) AS "diskWarnPct",
              (SELECT count(*)::int FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE p.status = 'ON_SALE' AND s.type = 'DIRECT') AS "directOnSale"`);
    const stubOrders = await this.db.query(
      `SELECT o.order_no AS "orderNo", o.total, o.status, coalesce(p.approved_at, p.created_at) AS "paidAt"
         FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id
        WHERE p.stub AND p.state = 'PAID' AND coalesce(p.approved_at, p.created_at) > now() - interval '7 days'
        ORDER BY coalesce(p.approved_at, p.created_at) DESC LIMIT 10`);
    return { ...c, stubOrders, serverErrorsHour: serverErrorsSince(60).n,   // v10.174 (D163) — 이 API 프로세스가 지난 1시간 보낸 5xx
      rateLimitedHour: rateLimitedSince(60),   // v10.176 (D165) — 지난 1시간 요청 한도(429)에 걸린 요청 · IP 수
      cspDay: cspReportsDay(),                 // v10.177 — 보안 정책 「보고만 하기」 지난 24시간(건수 · 많이 걸린 출처 10)
      csp30: await this.csp30(),               // v10.221 (D191) — 같은 보고를 DB 에 30일(출처마다 처음 · 마지막 본 날 · 막기 판단 줄)
      uploadsBackup: uploadsBackupState(),     // v10.177 — 올린 파일 백업 묶음(가장 최근 · 몇 시간 전 · 개수)
      slowSql: slowSqlSince(60),               // v10.179 — 300ms 넘은 DB 조회(모양 · 건수 · 가장 느림)
      slowHour: slowSince(60),                 // v10.178 (D167) — 지난 1시간 API 요청 수 · p95(ms) · 느린 주소 5곳
      server: serverHealth(),                  // v10.182 (D171) — 디스크 · 메모리 · 올린 파일 · 백업 폴더(10분마다 잰 값)
      diskWarnPct: c.diskWarnPct,
      ai: agentLines(await this.agentDay('today'), '오늘'),   // v10.204 (D181) — AI 상담 · 검수 보조 · 비용 · 상한
      reconsent: reconsentLines(await this.reconsent()),     // v10.204 — 필수 약관 동의 안 한 회원
      aiStep: agentStepLine(await this.agentSteps()),        // v10.205 (docs/328) — AI 켜기 단계 지금 · 다음
      warn: c.stubPaidOrders > 0 ? '시험 결제로 결제 완료된 주문이 있습니다 — 돈을 받지 않은 주문입니다. 소개몰 「주문 받기」를 끄거나 직판 상품을 판매 중지하십시오.' : undefined };
  }

  /* ── v10.171 (D160 · docs/264) 하루 요약 · 가입 급증 ─────────────────── */

  /** 어제(한국 날짜) 요약 — 정기 작업 launch_digest(매일 09:00)가 운영 알림 · 메일로 */
  async digest() {
    const Y = `((now() AT TIME ZONE 'Asia/Seoul')::date - 1)`;
    const D = (col: string) => `(${col} AT TIME ZONE 'Asia/Seoul')::date = ${Y}`;
    const [c] = await this.db.query<any>(
      `SELECT ${Y}::text AS day,
              (SELECT count(*)::int FROM accounts WHERE ${D('created_at')}) AS signups,
              (SELECT count(*)::int FROM posts WHERE ${D('created_at')}) AS posts,
              (SELECT count(*)::int FROM listings WHERE ${D('created_at')}) AS listings,
              (SELECT count(*)::int FROM hlt_orders WHERE ${D('created_at')}) AS orders,
              (SELECT count(DISTINCT p.order_id)::int FROM hlt_payments p WHERE p.stub AND p.state = 'PAID' AND ${D('coalesce(p.approved_at, p.created_at)')}) AS "stubPaidOrders",
              (SELECT count(*)::int FROM ops_alerts WHERE ${D('raised_at')} AND severity IN ('WARN', 'CRITICAL')) AS alerts,
              (SELECT count(*)::int FROM ops_alerts WHERE acknowledged_at IS NULL AND resolved_at IS NULL AND severity IN ('WARN', 'CRITICAL')) AS "openAlerts",
              (SELECT count(*)::int FROM ops_alerts WHERE acknowledged_at IS NULL AND resolved_at IS NULL AND severity = 'CRITICAL') AS "openCritical",
              coalesce((SELECT value FROM site_settings WHERE key = 'mall.order_open'), 'on') AS "orderOpen",
              coalesce((SELECT value FROM site_settings WHERE key = 'ops.digest_to'), '') AS "to",
              (SELECT count(DISTINCT kind)::int FROM v_poll_home) AS "homePolls",
              coalesce((SELECT string_agg(title, E'\n' ORDER BY raised_at) FROM ops_alerts WHERE alert_code = 'SETTING_CHANGED' AND ${D('raised_at')}), '') AS "settingChanges"`);
    const text = [
      `소개뱅크 운영 하루 요약 — ${c.day}(한국 날짜)`,
      /* v10.198 (docs/312) — 확인 안 한 긴급이 있으면 맨 위에 */
      ...(c.openCritical > 0 ? [`!! 확인 안 한 긴급 알림 ${c.openCritical}건 — 운영 화면 › 운영 알림에서 보고 「확인」을 누르십시오`] : []),
      '',
      `가입 ${c.signups} · 소개광장 글 ${c.posts} · 매물 ${c.listings} · 소개몰 주문 ${c.orders}`,
      `시험 결제(돈을 받지 않은) 주문 ${c.stubPaidOrders}${c.stubPaidOrders > 0 ? ' — 확인 필요' : ''}`,
      `운영 알림(경고 이상) 어제 ${c.alerts} · 확인 안 한 것 ${c.openAlerts}`,
      `소개몰 주문 받기: ${c.orderOpen === 'on' ? '켜짐' : '꺼짐'}`,
      /* v10.238 (docs/379) — 급한 알림 받는 길(메일 · 텔레그램 · 슬랙) */
      channelLine(await this.channels.channels()),
      /* v10.200 (docs/316) — 메인 투표 빈 자리(사용자 웹 메인에 「준비 중」 카드) */
      ...(c.homePolls < 3 ? [`메인 투표 ${c.homePolls} / 3 — 빈 자리는 사용자 웹 메인에 「준비 중」으로 보입니다(운영 화면 › 투표 관리 「확정 질문으로 빈 자리 채우기」)`] : []),
      /* v10.195 (D174) — 어제 바뀐 중요 설정(주문 받기 · 가입 · 2단계 인증 · 간주 · 기능 스위치) */
      ...(c.settingChanges ? ['어제 바뀐 중요 설정:', ...String(c.settingChanges).split('\n').map((t: string) => `  - ${t.replace('중요 설정 바뀜 — ', '')}`)] : []),
      /* v10.204 (D181 · docs/326) — AI 상담 · 비용 · 상한 / 필수 약관 재동의 진행 */
      ...agentLines(await this.agentDay('yesterday'), '어제'),
      ...agentStepLine(await this.agentSteps()),   // v10.205 (docs/328) — AI 켜기 단계
      ...agentWeekLine(await this.agent.week()),   // v10.206 (docs/330) — AI 7일
      ...reconsentLines(await this.reconsent()),
      diskLine(serverHealth()),
      '',
      '운영 화면 첫 화면 「공개 직후 지켜보기」에서 자세히 볼 수 있습니다.',
    ].join('\n');
    return { ...c, disk: serverHealth().disk, text };
  }

  /* ── v10.204 (D181 · docs/326) AI 가동 지켜보기 · 재동의 ────────────────── */

  /** AI 숫자(한국 날짜 하루) — 하루 요약은 어제 · 공개 직후 지켜보기는 오늘 */
  async agentDay(which: 'today' | 'yesterday'): Promise<AgentDay> {
    const X = which === 'today' ? TODAY : `(${TODAY} - 1)`;
    const on = (col: string) => `(${col} AT TIME ZONE 'Asia/Seoul')::date = ${X}`;
    const chatMsg = `FROM agent_messages m JOIN agent_conversations c ON c.id = m.conversation_id
                      WHERE c.channel = 'SITE_CHAT' AND m.role = 'assistant' AND ${on('m.created_at')}`;
    const [a] = await this.db.query<AgentDay>(
      `SELECT coalesce((SELECT value FROM site_settings WHERE key = 'agent.enabled'), 'off') = 'on' AS enabled,
              public.fn_privacy_ai_ready() AS unlocked,
              (SELECT count(*)::int FROM agent_conversations WHERE channel = 'SITE_CHAT' AND ${on('created_at')}) AS chats,
              (SELECT count(*)::int ${chatMsg}) AS answers,
              (SELECT count(*)::int ${chatMsg} AND m.handoff IS TRUE) AS handoffs,
              (SELECT count(*)::int FROM ai_review_opinions WHERE ${on('created_at')}) AS reviews,
              (SELECT coalesce(sum(requests), 0)::int FROM agent_usage_daily WHERE day = ${X}) AS requests,
              (SELECT round(coalesce(sum(cost_usd), 0), 2)::text FROM agent_usage_daily WHERE day = ${X}) AS cost,
              round(public.fn_agent_month_cost(), 2)::text AS month,
              coalesce(nullif((SELECT value FROM site_settings WHERE key = 'agent.monthly_cap_usd'), ''), '0') AS cap`);
    return a;
  }

  /** 필수 약관(지금 시행 중인 판)마다 대상(활동 중 계정) · 동의 · 남음 — v_term_not_agreed 와 같은 셈 */
  async reconsent(): Promise<Reconsent[]> {
    return this.db.query<Reconsent>(
      `SELECT t.code, t.title, t.version,
              (SELECT count(*)::int FROM accounts WHERE status = 'ACTIVE') AS target,
              (SELECT count(*)::int FROM accounts a WHERE a.status = 'ACTIVE'
                  AND EXISTS (SELECT 1 FROM v_term_consent_current g
                               WHERE g.account_id = a.id AND g.term_code = t.code AND g.term_version = t.version AND g.agreed)) AS agreed,
              (SELECT count(*)::int FROM v_term_not_agreed n WHERE n.code = t.code) AS missing
         FROM v_terms_current t WHERE t.is_required ORDER BY t.display_order, t.code`);
  }

  /**
   * AI 잠금이 풀린 때(처리방침 국외 이전 조항 시행) 한 번 · 3일 안 시행 예정 처리방침이 있는데 준비가 덜 됐을 때 판마다 한 번.
   *   빠진 것: AI 키 · 월 상한 0 · AI 전체 꺼짐. 회원에게 답하는 것은 상담 스위치(agent.chat.enabled)까지 켜져야 함 — 상태만 적음.
   *   v10.216 (docs/347) — 제목: 지금 판이 첫 판이고 적힌 시행일 전이면 「게시(첫 판 · 적힌 시행일 MM-DD)」 · 아니면 「시행」(D151 · v10.215 「지금 판」 글과 같음).
   */
  async agentWatch(): Promise<{ live: { severity: 'INFO' | 'WARN'; title: string; detail: Record<string, unknown> } | null;
                               gap: { title: string; detail: Record<string, unknown> } | null }> {
    const [r] = await this.db.query<{ unlocked: boolean; privacy_ver: string | null; live_sent: boolean; upcoming_ver: string | null; upcoming_day: string | null;
                                      gap_sent: boolean; cap: string; enabled: boolean; review: boolean; chat: boolean }>(`SELECT * FROM fn_agent_watch_state()`);
    const needLive = r.unlocked && !r.live_sent;
    const needGap = !r.unlocked && !!r.upcoming_ver && !r.gap_sent;
    if (!needLive && !needGap) return { live: null, gap: null };
    const keySource = await this.agent.keySource();
    const gaps = [keySource === 'NONE' ? 'AI 키 없음' : null, Number(r.cap) > 0 ? null : '월 상한 0', r.enabled ? null : 'AI 전체 꺼짐']
      .filter((x): x is string => !!x);
    const sw = `검수 보조 ${r.review ? '켜짐' : '꺼짐'} · AI 상담 ${r.chat ? '켜짐' : '꺼짐'}`;
    const detail = { keySource, cap: r.cap, enabled: r.enabled, review: r.review, chat: r.chat, gaps };
    const [pv] = needLive ? await this.db.query<{ early: boolean; day: string }>(
      `SELECT effective_from > now() AS early, to_char(effective_from AT TIME ZONE 'Asia/Seoul', 'MM-DD') AS day FROM v_terms_current WHERE code = 'PRIVACY'`) : [];
    const how = pv?.early ? `게시(첫 판 · 적힌 시행일 ${pv.day})` : '시행';
    const live = needLive ? {
      severity: (gaps.length ? 'WARN' : 'INFO') as 'INFO' | 'WARN',
      title: `AI 사용 가능해짐 — 처리방침 ${r.privacy_ver} ${how}(국외 이전 조항) · ${gaps.length ? `빠진 것: ${gaps.join(' · ')}` : '키 · 월 상한 · AI 전체 갖춰짐'} · ${sw}`,
      detail: { ...detail, privacyVer: r.privacy_ver, firstEarly: !!pv?.early },
    } : null;
    const gap = needGap && gaps.length ? {
      title: `AI 준비 덜 됨 — 처리방침 ${r.upcoming_ver} 이 ${r.upcoming_day} 시행 예정인데 ${gaps.join(' · ')} · ${sw} — 운영 화면 › AI 에이전트에서 준비하십시오`,
      detail: { ...detail, version: r.upcoming_ver, day: r.upcoming_day },
    } : null;
    return { live, gap };
  }

  /** v10.205 (docs/328) — AI 켜기 단계 */
  async agentSteps(): Promise<AgentStep[]> {
    return (await this.agent.rollout()) as AgentStep[];
  }

  /**
   * v10.205 — 다음 단계가 「할 차례」(앞 단계 기준을 넘음 · 아직 꺼짐)가 되면 단계마다 한 번 AGENT_STEP_READY(정보 · 급한 알림 메일 · 텔레그램).
   *   켜는 것은 대표(AI 스위치 · SUPER). 예: 검수 보조 7일 → 「AI 상담 2단계」 할 차례.
   */
  async agentStepReady(steps?: AgentStep[]): Promise<{ title: string; detail: Record<string, unknown> }[]> {
    const all = steps ?? await this.agentSteps();
    const ready = all.filter((x) => STEP_ALERT.includes(x.code) && x.state === 'READY');
    if (!ready.length) return [];
    const sent = new Set((await this.db.query<{ step: string }>(
      `SELECT DISTINCT detail->>'step' AS step FROM ops_alerts WHERE alert_code = 'AGENT_STEP_READY'`)).map((x) => x.step));
    return ready.filter((x) => !sent.has(x.code)).map((x) => {
      const prev = all.find((p) => p.step === x.step - 1);
      return {
        title: `AI 다음 단계 켤 수 있음 — ${x.step} ${x.label}${prev ? ` · 앞 단계 ${prev.label}: ${prev.now}` : ''} · 운영 화면 › AI 에이전트 › AI 켜기 단계에서 보고 켜십시오(켜기는 최고 관리자)`,
        detail: { step: x.code, label: x.label, prev: prev?.now ?? null },
      };
    });
  }

  /** 지난 1시간 가입이 기준(ops.signup_spike_per_hour) 이상이고, 지난 1시간 안에 같은 알림이 없으면 알릴 것 */
  async signupSpike(): Promise<{ n: number; limit: number; alert: boolean }> {
    const [r] = await this.db.query<{ n: number; lim: number; recent: boolean }>(
      `SELECT (SELECT count(*)::int FROM accounts WHERE created_at > now() - interval '1 hour') AS n,
              coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'ops.signup_spike_per_hour'), 30) AS lim,
              EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'SIGNUP_SPIKE' AND raised_at > now() - interval '1 hour') AS recent`);
    return { n: r.n, limit: r.lim, alert: r.lim > 0 && r.n >= r.lim && !r.recent };
  }

  /** v10.174 (D163 · docs/268) — 지난 10분 API 서버 오류(5xx)가 기준(ops.server_error_per_10min · 0 = 끔) 이상이고 지난 1시간 안에 같은 알림이 없으면 알릴 것 */
  async serverErrorSpike(): Promise<{ n: number; limit: number; alert: boolean; top: Array<{ path: string; n: number }> }> {
    const { n, top } = serverErrorsSince(10);
    const [r] = await this.db.query<{ lim: number; recent: boolean }>(
      `SELECT coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'ops.server_error_per_10min'), 20) AS lim,
              EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'SERVER_ERROR_SPIKE' AND raised_at > now() - interval '1 hour') AS recent`);
    return { n, limit: r.lim, alert: r.lim > 0 && n >= r.lim && !r.recent, top };
  }

  /** v10.178 (D167 · docs/277) — 지난 10분 API p95 가 기준(ops.slow_p95_ms · 0 = 끔) 이상 · 요청 50건 이상 · 지난 1시간 같은 알림 없음이면 알릴 것 */
  async slowApi(): Promise<{ n: number; p95: number; limit: number; alert: boolean; top: Array<{ path: string; p95: number; n: number }> }> {
    const { n, p95, top } = slowSince(10);
    const [r] = await this.db.query<{ lim: number; recent: boolean }>(
      `SELECT coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'ops.slow_p95_ms'), 1500) AS lim,
              EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'SLOW_API' AND raised_at > now() - interval '1 hour') AS recent`);
    return { n, p95, limit: r.lim, alert: r.lim > 0 && n >= 50 && p95 >= r.lim && !r.recent, top };
  }

  /** v10.178 (docs/277) — 신고 3건으로 감춰진 회원 투표 중 아직 운영 알림을 남기지 않은 것(지난 하루 · 투표마다 한 번) */
  async pollsHiddenByReports(): Promise<Array<{ id: string; title: string; reports: number }>> {
    return this.db.query(
      `SELECT p.id, p.title, p.report_n AS reports FROM polls p
        WHERE p.source = 'MEMBER' AND p.state = 'HIDDEN' AND p.report_n >= 3 AND p.updated_at > now() - interval '1 day'
          AND NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = 'POLL_HIDDEN_BY_REPORTS' AND a.detail->>'pollId' = p.id::text)
        ORDER BY p.updated_at LIMIT 20`);
  }

  /**
   * v10.182 (D171 · docs/285) — 디스크가 ops.disk_warn_pct(85 · 0 = 끔) 이상이면 WARN · 95 이상이면 CRITICAL.
   *   같은 등급은 하루(한국 날짜) 한 번 — 등급이 오르면(WARN → CRITICAL) 그날 다시 알림.
   */
  async diskAlert(): Promise<{ alert: boolean; level: 'WARN' | 'CRITICAL' | null; usedPct: number | null; freeGB: number | null; limit: number }> {
    const d = serverHealth().disk;
    const [r] = await this.db.query<{ lim: number; warn: boolean; crit: boolean }>(
      `SELECT coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'ops.disk_warn_pct'), 85) AS lim,
              EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'DISK_LOW' AND detail->>'level' = 'WARN' AND ${KST('raised_at')}) AS warn,
              EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'DISK_LOW' AND detail->>'level' = 'CRITICAL' AND ${KST('raised_at')}) AS crit`);
    const lim = Number(r?.lim ?? 85);
    if (!d || lim <= 0) return { alert: false, level: null, usedPct: d?.usedPct ?? null, freeGB: d?.freeGB ?? null, limit: lim };
    const level = d.usedPct >= 95 ? 'CRITICAL' : d.usedPct >= lim ? 'WARN' : null;
    const alert = level === 'CRITICAL' ? !r.crit : level === 'WARN' ? !r.warn && !r.crit : false;
    return { alert, level, usedPct: d.usedPct, freeGB: d.freeGB, limit: lim };
  }

  /** v10.182 (D171) — 최근 서버 오류 50건(이 API 프로세스 메모리 · 1시간) · 운영 화면 위험감지 › 서버 오류 */
  serverErrors() {
    const items = recentServerErrors();
    const { n, top } = serverErrorsSince(60);
    return { items, hour: n, top, note: 'API 를 다시 띄우면 지워집니다 · 요청 내용 · 개인정보는 남기지 않습니다.' };
  }

  /* ── v10.221 (D191 · docs/356) 보안 정책 보고 30일 ─────────────────── */

  /** 정기 작업 launch_watch — 메모리에 쌓인 보고 건수를 csp_report_days 에 더하고 30일 지난 줄을 지움.
   *  넣지 못하면 건수를 되돌려 다음 10분에 다시(정기 작업의 다른 일은 그대로 이어 감) */
  async flushCsp(): Promise<{ added: number; purged: number; error?: string }> {
    const list = takeCspPending();
    let added = 0, error: string | undefined;
    if (list.length) {
      try {
        await this.db.query(
          `INSERT INTO csp_report_days (day, directive, blocked, page, n)
           SELECT d, left(r, 40), left(b, 200), left(p, 80), n FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::int[]) AS x(d, r, b, p, n)
           ON CONFLICT (day, directive, blocked) DO UPDATE SET n = csp_report_days.n + EXCLUDED.n, page = EXCLUDED.page, last_at = now()`,
          [list.map((x) => x.day), list.map((x) => x.directive), list.map((x) => x.blocked), list.map((x) => x.page), list.map((x) => x.n)]);
        added = list.reduce((t, x) => t + x.n, 0);
      } catch (e) {
        restoreCspPending(list);
        error = String((e as Error).message ?? e).slice(0, 120);
      }
    }
    const gone = await this.db.query(
      `DELETE FROM csp_report_days WHERE day <= (now() AT TIME ZONE 'Asia/Seoul')::date - 30 RETURNING 1`).catch(() => []);
    return { added, purged: gone.length, ...(error ? { error } : {}) };
  }

  /** 지난 30일 — 모두 몇 건 · 출처(규칙 · 출처)마다 건수 · 처음 · 마지막 본 날 · 마지막 화면 · 7일 안 처음 보인 출처 수 ·
   *  「막기 판단 준비」 = 쌓은 지 7일이 넘었고 지난 7일 새 출처 없음(실제로 막는 정책은 판단 뒤 따로 바꿈) */
  async csp30() {
    const rows = await this.db.query<{ directive: string; blocked: string; n: number; firstDay: string; lastDay: string; page: string | null }>(
      `SELECT directive, blocked, sum(n)::int AS n, min(day)::text AS "firstDay", max(day)::text AS "lastDay",
              (array_agg(page ORDER BY last_at DESC))[1] AS page
         FROM csp_report_days WHERE day > ${TODAY} - 30
        GROUP BY directive, blocked ORDER BY sum(n) DESC, directive, blocked`).catch(() => []);
    const [d] = await this.db.query<{ since: string | null; today: string; week: string }>(
      `SELECT (SELECT min(day)::text FROM csp_report_days WHERE day > ${TODAY} - 30) AS since, ${TODAY}::text AS today, (${TODAY} - 7)::text AS week`);
    const since = d?.since ?? null;
    const fresh = rows.filter((r) => r.firstDay > d.week).length;
    const ready = !!since && since <= d.week && fresh === 0;
    let total = 0;
    for (const r of rows) total += r.n;
    return { since, n: total, origins: rows.length, new7: fresh, ready, top: rows.slice(0, 30) };
  }

  /** 정기 작업 launch_watch — 지난 15분 안에 시험 결제로 결제 완료된 소개몰 주문 수 */
  async recentStubOrders(): Promise<{ n: number; orders: string[] }> {
    const rows = await this.db.query<{ order_no: string }>(
      `SELECT DISTINCT o.order_no FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id
        WHERE p.stub AND p.state = 'PAID' AND coalesce(p.approved_at, p.created_at) > now() - interval '15 minutes' ORDER BY 1 LIMIT 20`);
    return { n: rows.length, orders: rows.map((r) => r.order_no) };
  }

  /**
   * v10.199 (D177 · docs/314) — 간주 결제가 켜진 채 「주문 받기」가 켜져 있으면:
   *   ① 꺼질 시각(mall.order_open_until)이 지났으면 끔(사유 「꺼질 시각이 지나 저절로 끔」 → 중요 설정 바뀜 알림 via DB) → expired
   *   ② 꺼질 시각 없이 켜진 지 1시간이 넘었으면(DB 직접 수정 · 옛 길) noEnd — 부르는 쪽이 CRITICAL ORDER_OPEN_NO_END(풀리기 전 한 번)
   *   켜진 때 = 주문 받기 줄의 updated_at(운영 화면은 늘 고침 · DB 로 직접 켜 updated_at 이 옛것이면 1시간을 기다리지 않고 바로 — 가장 위험한 길)
   *   주문 받기가 꺼졌거나 간주 결제가 꺼졌으면 ORDER_OPEN_NO_END 를 「풀림」
   */
  async orderOpenGuard(): Promise<{ open: boolean; expired: string | null; noEnd: boolean; sinceMin: number | null }> {
    const [g] = await this.db.query<{ open: boolean; until: string | null; overdue: boolean; since_min: number | null; alerted: boolean }>(
      `SELECT coalesce((SELECT value FROM site_settings WHERE key = 'mall.order_open'), 'on') <> 'off'
                AND coalesce((SELECT value FROM site_settings WHERE key = 'assume.payment'), 'on') = 'on' AS open,
              (SELECT nullif(value, '') FROM site_settings WHERE key = 'mall.order_open_until') AS until,
              coalesce((SELECT nullif(value, '')::timestamptz < now() FROM site_settings WHERE key = 'mall.order_open_until'), false) AS overdue,
              (SELECT floor(extract(epoch FROM now() - updated_at) / 60)::int FROM site_settings WHERE key = 'mall.order_open') AS since_min,
              EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ORDER_OPEN_NO_END' AND resolved_at IS NULL) AS alerted`);
    if (!g.open) {
      await this.db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = '주문 받기가 꺼짐(또는 간주 결제 꺼짐)'
                            WHERE alert_code = 'ORDER_OPEN_NO_END' AND resolved_at IS NULL`);
      return { open: false, expired: null, noEnd: false, sinceMin: null };
    }
    if (g.until && g.overdue) {
      await this.db.transaction(async () => {
        await this.db.query(`SELECT set_config('app.setting_reason', $1, true)`, [`꺼질 시각(${g.until})이 지나 저절로 끔 — 정기 작업 launch_watch · v10.199`]);
        await this.db.query(`UPDATE site_settings SET value = 'off', updated_by = NULL, updated_at = now() WHERE key = 'mall.order_open'`);
        await this.db.query(`UPDATE site_settings SET value = NULL, updated_by = NULL, updated_at = now() WHERE key = 'mall.order_open_until'`);
      });
      return { open: false, expired: g.until, noEnd: false, sinceMin: g.since_min };
    }
    return { open: true, expired: null, noEnd: !g.until && (g.since_min ?? 0) >= 60 && !g.alerted, sinceMin: g.since_min };
  }

  /**
   * v10.199 (D177 · docs/314) — 원인이 없어진 운영 알림에 「풀림」(사람의 확인 기록과 따로 · 확인 안 한 수 · 메일에서 빠짐).
   *   백업 멈춤 → 새 묶음 · 백업 실패 → 그 뒤 새 묶음 · 묶음 깨짐 → 그 뒤 검사 깨짐 0 · 디스크 → 기준 아래 · v10.235 외부 연동 예상일 지남 → 지난 연동 0.
   *   검수 기한 넘김(REVIEW_SLA_BREACH)은 DB 함수 fn_check_sla_alert 가 같은 방식으로 풂(sla_alert 작업).
   */
  async resolveAlerts(diskPct: number | null, diskLimit: number): Promise<number> {
    const ub = uploadsBackupState();
    const vf = uploadsBackupVerified();
    let n = 0;
    const run = async (code: string, note: string, extra = '', params: unknown[] = []) => {
      const r = await this.db.query(
        `UPDATE ops_alerts SET resolved_at = now(), resolve_note = $1 WHERE alert_code = '${code}' AND resolved_at IS NULL ${extra} RETURNING id`, [note, ...params]);
      n += r.length;
    };
    if (ub.count > 0 && !ub.stale) await run('UPLOADS_BACKUP_STALE', `새 묶음 ${ub.last} 이 생김`);
    if (ub.lastAt) await run('UPLOADS_BACKUP_FAILED', `그 뒤 새 묶음 ${ub.last} 이 생김`, 'AND raised_at < $2::timestamptz', [ub.lastAt]);
    if (vf && vf.bad === 0) await run('UPLOADS_BACKUP_BAD', '그 뒤 묶음 검사에서 깨짐 0', 'AND raised_at < $2::timestamptz', [vf.at]);
    if (diskPct !== null && diskLimit > 0 && diskPct < diskLimit) await run('DISK_LOW', `디스크 ${diskPct}% — 기준 ${diskLimit}% 아래로`);
    /* v10.235 (docs/375) — 예상일 지난 외부 연동이 하나도 없으면(LIVE 가 됐거나 신청일 · 기간을 고침) */
    if (!(await this.integrationOverdue()).length) await run('INTEGRATION_OVERDUE', '예상일 지난 외부 연동이 없어짐');
    return n;
  }

  /**
   * v10.197 (D175 · docs/310) — 메일로 보낼 급한 운영 알림(CRITICAL · 중요 설정 바뀜 · 24시간 안 · 종류마다 1시간에 1통)과 받는 주소.
   *   고르는 기준은 DB 함수 fn_ops_alert_mail_pending 하나 — 보내고 나서 markMailed 로 시각을 적음.
   *   v10.198 (D176 · docs/312) — 확인 안 한 CRITICAL 을 보낸 지 12시간 뒤 한 번 더(fn_ops_alert_remail_pending · again = true) ·
   *   올린 파일 백업 실패 · 묶음 깨짐도 처음 보낼 종류에 들어감(DB 함수).
   */
  async alertMailPending(): Promise<{ to: string; items: { id: string; code: string; severity: string; title: string; raisedAt: string; again: boolean }[] }> {
    const items = await this.db.query<{ id: string; code: string; severity: string; title: string; raisedAt: string; again: boolean }>(
      `SELECT id::text AS id, alert_code AS code, severity, title,
              to_char(raised_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS "raisedAt", false AS again
         FROM fn_ops_alert_mail_pending()
       UNION ALL
       SELECT id::text, alert_code, severity, title,
              to_char(raised_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI'), true
         FROM fn_ops_alert_remail_pending()`);
    const [c] = await this.db.query<{ to: string }>(`SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.digest_to'), '') AS "to"`);
    return { to: (c?.to ?? '').trim(), items };
  }

  /**
   * v10.235 (docs/375) — 외부 연동 예상일 지남: 발신 IP 신청일(ip_requested_at) + 걸리는 기간(lead_time_weeks)이 지났는데 LIVE 가 아닌 연동.
   *   신청일이나 기간이 비어 있는 연동은 셀 수 없어 뺌(운영 화면 외부 연동 표에서 신청일을 고쳐 넣으면 들어옴).
   */
  async integrationOverdue(): Promise<{ code: string; name: string; status: string; dueOn: string; daysOver: number }[]> {
    return this.db.query(
      `SELECT code, name, status,
              to_char((ip_requested_at + make_interval(weeks => lead_time_weeks)) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS "dueOn",
              (now()::date - (ip_requested_at + make_interval(weeks => lead_time_weeks))::date)::int AS "daysOver"
         FROM integrations
        WHERE status <> 'LIVE' AND ip_requested_at IS NOT NULL AND lead_time_weeks IS NOT NULL
          AND ip_requested_at + make_interval(weeks => lead_time_weeks) < now()
        ORDER BY ip_requested_at + make_interval(weeks => lead_time_weeks), sort_order`);
  }

  /** v10.200 (D178 · docs/316) — 텔레그램으로 보낼 것 · 다시 보낼 것(메일과 같은 기준 · 칸은 pushed_at · repushed_at) */
  async alertPushPending(ch: 'push' | 'slack' = 'push'): Promise<{ id: string; code: string; severity: string; title: string; raisedAt: string; again: boolean }[]> {
    /* v10.237 (D200) — 슬랙은 같은 기준 · 칸만 slack_pushed_at · slack_repushed_at */
    const [p, rp] = ch === 'slack' ? ['FROM fn_ops_alert_slack_pending()', 'FROM fn_ops_alert_slack_repush_pending()'] : ['FROM fn_ops_alert_push_pending()', 'FROM fn_ops_alert_repush_pending()'];
    return this.db.query(
      `SELECT id::text AS id, alert_code AS code, severity, title,
              to_char(raised_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS "raisedAt", false AS again
         ${p}
       UNION ALL
       SELECT id::text, alert_code, severity, title,
              to_char(raised_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI'), true
         ${rp}`);
  }

  /** v10.230 (D198 · docs/369) — 같은 기준의 전체 수(대기 목록은 CRITICAL 먼저 · 최근 순 50건) — 「보내지 못한 알림 n건 더」 줄에 씀 */
  async alertBacklog(kind: 'mail' | 'push' | 'slack'): Promise<number> {
    const fn = { mail: 'fn_ops_alert_mail_backlog()', push: 'fn_ops_alert_push_backlog()', slack: 'fn_ops_alert_slack_backlog()' }[kind];
    const [r] = await this.db.query<{ n: number }>(`SELECT ${fn} AS n`);
    return Number(r?.n ?? 0);
  }

  async markPushed(ids: string[], againIds: string[] = []): Promise<void> {
    if (ids.length) await this.db.query(`UPDATE ops_alerts SET pushed_at = now() WHERE id = ANY($1::bigint[]) AND pushed_at IS NULL`, [ids]);
    if (againIds.length) await this.db.query(`UPDATE ops_alerts SET repushed_at = now() WHERE id = ANY($1::bigint[]) AND repushed_at IS NULL`, [againIds]);
  }

  /** v10.237 (D200) — 슬랙으로 보낸 시각(텔레그램 pushed_at 과 따로) */
  async markSlacked(ids: string[], againIds: string[] = []): Promise<void> {
    if (ids.length) await this.db.query(`UPDATE ops_alerts SET slack_pushed_at = now() WHERE id = ANY($1::bigint[]) AND slack_pushed_at IS NULL`, [ids]);
    if (againIds.length) await this.db.query(`UPDATE ops_alerts SET slack_repushed_at = now() WHERE id = ANY($1::bigint[]) AND slack_repushed_at IS NULL`, [againIds]);
  }

  async markMailed(ids: string[], againIds: string[] = []): Promise<void> {
    if (ids.length) await this.db.query(`UPDATE ops_alerts SET mailed_at = now() WHERE id = ANY($1::bigint[]) AND mailed_at IS NULL`, [ids]);
    if (againIds.length) await this.db.query(`UPDATE ops_alerts SET remailed_at = now() WHERE id = ANY($1::bigint[]) AND remailed_at IS NULL`, [againIds]);
  }

  /* ── v10.173 (D162 · docs/266) 시험 결제 주문 정리 ─────────────────── */

  /**
   * 시험 결제(stub)로 결제 완료된 소개몰 주문 중 **발송 전(PAID · PREPARING)** 을 한 번에 취소하고 주문한 분에게 알림.
   *   결제 기록을 CANCELED 로 바꾸면 fn_hlt_pay_apply 가 주문을 취소로 옮깁니다(PG 취소 반영과 같은 길 · 재고도 거기서).
   *   발송한 주문은 건드리지 않고 「손으로 확인」 목록으로 돌려줌. 돈은 처음부터 받지 않았으므로 환불할 것이 없습니다.
   */
  async cancelStubOrders(orderNos?: string[]): Promise<{ ok: boolean; canceled: string[]; manual: string[]; note: string }> {
    return this.db.transaction(async () => {
      const rows = await this.db.query<{ pay_id: string; order_no: string; status: string; account_id: string }>(
        `SELECT p.id AS pay_id, o.order_no, o.status, o.account_id
           FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id
          WHERE p.stub AND p.state = 'PAID' AND ($1::text[] IS NULL OR o.order_no = ANY($1))
          ORDER BY coalesce(p.approved_at, p.created_at) FOR UPDATE OF p, o`, [orderNos?.length ? orderNos : null]);
      const canceled: string[] = []; const manual: string[] = [];
      for (const r of rows) {
        if (!['PAID', 'PREPARING'].includes(r.status)) { manual.push(r.order_no); continue; }
        await this.db.query(
          `UPDATE hlt_payments SET state = 'CANCELED', pg_status = 'STUB_CLEANUP', canceled_at = now(), canceled_amount = amount,
                  fail_reason = '시험 결제 주문 정리(운영 · v10.173)' WHERE id = $1`, [r.pay_id]);
        await this.db.query(
          `INSERT INTO notifications (account_id, event_code, title, body, link_url) VALUES ($1, 'HLT_STUB_ORDER_CANCELED', $2, $3, $4)`,
          [r.account_id, '소개몰 주문이 취소되었습니다',
           `주문 ${r.order_no} 은 시험 결제(실제 돈이 오가지 않음)로 접수되어 취소했습니다. 결제된 돈은 없습니다. 정식 결제가 열리면 다시 주문해 주십시오.`,
           '/my/health/orders']);
        canceled.push(r.order_no);
      }
      const note = rows.length === 0 ? '정리할 시험 결제 주문이 없습니다.'
        : `시험 결제 주문 ${canceled.length}건을 취소하고 주문한 분께 알렸습니다.${manual.length ? ` 발송한 주문 ${manual.length}건은 손으로 확인하십시오.` : ''}`;
      return { ok: true, canceled, manual, note };
    });
  }
}
