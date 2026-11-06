import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { recentServerErrors, serverErrorsSince } from '../../common/server-error-count';
import { serverHealth } from '../../common/server-health';
import { rateLimitedSince } from '../../common/api-rate-limit';
import { cspReportsDay } from '../../common/csp-report';
import { slowSince } from '../../common/response-time';
import { slowSqlSince } from '../../common/slow-sql';
import { uploadsBackupState } from '../../common/uploads-backup-state';

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

@Injectable()
export class LaunchWatchService {
  constructor(private readonly db: DatabaseService) {}

  async today() {
    const [c] = await this.db.query<any>(
      `SELECT (SELECT count(*)::int FROM accounts WHERE ${KST('created_at')}) AS signups,
              (SELECT count(*)::int FROM accounts WHERE last_login_at IS NOT NULL AND ${KST('last_login_at')}) AS logins,
              (SELECT count(*)::int FROM posts WHERE ${KST('created_at')}) AS posts,
              (SELECT count(*)::int FROM listings WHERE ${KST('created_at')}) AS listings,
              (SELECT count(*)::int FROM hlt_orders WHERE ${KST('created_at')}) AS orders,
              (SELECT count(*)::int FROM hlt_orders WHERE paid_at IS NOT NULL AND ${KST('paid_at')}) AS "paidOrders",
              (SELECT count(DISTINCT p.order_id)::int FROM hlt_payments p WHERE p.stub AND p.state = 'PAID' AND ${KST('coalesce(p.approved_at, p.created_at)')}) AS "stubPaidOrders",
              (SELECT count(*)::int FROM ops_alerts WHERE acknowledged_at IS NULL AND severity IN ('WARN', 'CRITICAL')) AS "openAlerts",
              coalesce((SELECT value FROM site_settings WHERE key = 'mall.order_open'), 'on') AS "orderOpen",
              coalesce((SELECT value FROM site_settings WHERE key = 'assume.payment'), 'off') AS "assumePayment",
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
      uploadsBackup: uploadsBackupState(),     // v10.177 — 올린 파일 백업 묶음(가장 최근 · 몇 시간 전 · 개수)
      slowSql: slowSqlSince(60),               // v10.179 — 300ms 넘은 DB 조회(모양 · 건수 · 가장 느림)
      slowHour: slowSince(60),                 // v10.178 (D167) — 지난 1시간 API 요청 수 · p95(ms) · 느린 주소 5곳
      server: serverHealth(),                  // v10.182 (D171) — 디스크 · 메모리 · 올린 파일 · 백업 폴더(10분마다 잰 값)
      diskWarnPct: c.diskWarnPct,
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
              (SELECT count(*)::int FROM ops_alerts WHERE acknowledged_at IS NULL AND severity IN ('WARN', 'CRITICAL')) AS "openAlerts",
              (SELECT count(*)::int FROM ops_alerts WHERE acknowledged_at IS NULL AND severity = 'CRITICAL') AS "openCritical",
              coalesce((SELECT value FROM site_settings WHERE key = 'mall.order_open'), 'on') AS "orderOpen",
              coalesce((SELECT value FROM site_settings WHERE key = 'ops.digest_to'), '') AS "to",
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
      /* v10.195 (D174) — 어제 바뀐 중요 설정(주문 받기 · 가입 · 2단계 인증 · 간주 · 기능 스위치) */
      ...(c.settingChanges ? ['어제 바뀐 중요 설정:', ...String(c.settingChanges).split('\n').map((t: string) => `  - ${t.replace('중요 설정 바뀜 — ', '')}`)] : []),
      diskLine(serverHealth()),
      '',
      '운영 화면 첫 화면 「공개 직후 지켜보기」에서 자세히 볼 수 있습니다.',
    ].join('\n');
    return { ...c, disk: serverHealth().disk, text };
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

  /** 정기 작업 launch_watch — 지난 15분 안에 시험 결제로 결제 완료된 소개몰 주문 수 */
  async recentStubOrders(): Promise<{ n: number; orders: string[] }> {
    const rows = await this.db.query<{ order_no: string }>(
      `SELECT DISTINCT o.order_no FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id
        WHERE p.stub AND p.state = 'PAID' AND coalesce(p.approved_at, p.created_at) > now() - interval '15 minutes' ORDER BY 1 LIMIT 20`);
    return { n: rows.length, orders: rows.map((r) => r.order_no) };
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
