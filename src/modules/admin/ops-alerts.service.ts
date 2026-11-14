import { opsBoardPost } from './ops-board.service';   // v10.286 (D213)
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { MailService } from '../../common/mail/mail.service';
import { maskMail } from '../../common/mail/mail-admin.service';
import { TelegramService, TG_MAX } from '../../common/telegram/telegram.service';
import { PUSH_PARTS, buildAlertPush } from '../../common/telegram/alert-push';
import { LaunchWatchService } from './launch-watch.service';
import { SlackService } from '../../common/slack/slack.service';

/* ---------------------------------------------------------------------
 * v10.179 (D168 · docs/279) — 운영 알림 목록 · 확인
 *
 *   정기 작업 · 스크립트가 남기는 운영 알림(ops_alerts — SERVER_ERROR_SPIKE · SLOW_API · UPLOADS_BACKUP_STALE ·
 *   POLL_HIDDEN_BY_REPORTS · DAILY_DIGEST · STUB_PAYMENT_ORDER …)을 운영 화면에서 보고 「확인」합니다.
 *   확인은 한 번만(누가 · 언제 · 메모) — 다시 「확인 안 함」으로 돌리거나 고치지 못함(DB fn_ops_alert_ack_guard).
 *   알림 내용 자체는 바꾸거나 지우지 않습니다.
 *
 *   v10.198 (D176 · docs/312) — 메일 준비 상태(mailStatus) · 시험 메일(mailTest · SUPER · 1분에 1번 · 감사 기록 OPS_MAIL_TEST)
 *   v10.199 (D177 · docs/314) — 「풀림」(resolved_at · 정기 작업이 적음) — 확인 안 한 목록 · 종류별 수에서 기본으로 뺌(resolved=show 면 같이)
 *   v10.200 (D178 · docs/316) — 텔레그램 준비 상태(mailStatus 의 push) · 시험 메시지(pushTest · SUPER · 1분에 1번 · OPS_PUSH_TEST) · 대화방 찾기
 *   v10.232 (docs/371) — 한꺼번에 확인(ackBulk · 풀린 것 모두 · 6 · 24 · 72시간 넘은 INFO · WARN 모두 · CRITICAL 은 뺌)
 *   v10.234 (docs/375) — 텔레그램 첫 차례 미리보기(pushPreview · 읽기만 · 정기 작업과 같은 글 만들기 buildAlertPush)
 *   v10.237 (D200 · docs/377) — 슬랙 준비 상태(mailStatus 의 slack) · 시험 메시지(slackTest · SUPER · 1분에 1번 · OPS_SLACK_TEST) · 첫 차례 미리보기(slackPreview)
 * ------------------------------------------------------------------- */
@Injectable()
export class OpsAlertsService {
  constructor(private readonly db: DatabaseService, private readonly mail: MailService, private readonly telegram: TelegramService,
              private readonly launchWatch: LaunchWatchService, private readonly slack: SlackService) {}
  private static lastTestAt = 0;
  private static lastPushTestAt = 0;
  private static lastSlackTestAt = 0;
  private get me() { return RequestCtx.actorId(); }

  async list(q: { state?: unknown; code?: unknown; severity?: unknown; page?: unknown; size?: unknown; resolved?: unknown }) {
    const open = q.state !== 'all';
    /* v10.199 (D177 · docs/314) — 확인 안 한 것만 볼 때는 원인이 없어진(풀린) 알림을 기본으로 뺌 · resolved=show 면 같이 */
    const hideResolved = open && q.resolved !== 'show';
    const code = typeof q.code === 'string' && /^[A-Z][A-Z0-9_]{1,59}$/.test(q.code) ? q.code : null;
    const sev = typeof q.severity === 'string' && ['INFO', 'WARN', 'CRITICAL'].includes(q.severity) ? q.severity : null;
    const size = Math.min(100, Math.max(1, Number(q.size) || 30));
    const page = Math.max(1, Number(q.page) || 1);
    const items = await this.db.query(
      `SELECT o.id::text AS id, o.alert_code AS code, o.severity, o.title, o.detail, o.raised_at AS "raisedAt",
              o.acknowledged_at AS "acknowledgedAt", o.ack_note AS "ackNote", a.name AS "acknowledgedBy", o.mailed_at AS "mailedAt",
              o.remailed_at AS "remailedAt", o.resolved_at AS "resolvedAt", o.resolve_note AS "resolveNote"
         FROM ops_alerts o LEFT JOIN accounts a ON a.id = o.acknowledged_by
        WHERE ($1::boolean IS FALSE OR o.acknowledged_at IS NULL) AND ($6::boolean IS FALSE OR o.resolved_at IS NULL)
          AND ($2::text IS NULL OR o.alert_code = $2) AND ($3::text IS NULL OR o.severity = $3)
        ORDER BY o.raised_at DESC, o.id DESC
        LIMIT $4 OFFSET $5`, [open, code, sev, size, (page - 1) * size, hideResolved]);
    const [t] = await this.db.query<{ n: number; resolved: number }>(
      `SELECT count(*) FILTER (WHERE $4::boolean IS FALSE OR o.resolved_at IS NULL)::int AS n,
              count(*) FILTER (WHERE o.resolved_at IS NOT NULL)::int AS resolved
         FROM ops_alerts o
        WHERE ($1::boolean IS FALSE OR o.acknowledged_at IS NULL)
          AND ($2::text IS NULL OR o.alert_code = $2) AND ($3::text IS NULL OR o.severity = $3)`, [open, code, sev, hideResolved]);
    /* 종류별 — 확인 안 한 수 · 지난 7일 수 · 가장 최근(목록 위 묶음 칸) */
    const codes = await this.db.query(
      `SELECT alert_code AS code, count(*) FILTER (WHERE acknowledged_at IS NULL AND resolved_at IS NULL)::int AS open,
              count(*) FILTER (WHERE acknowledged_at IS NULL AND resolved_at IS NOT NULL)::int AS resolved,
              count(*) FILTER (WHERE raised_at > now() - interval '7 days')::int AS "last7d", max(raised_at) AS "lastAt",
              (array_agg(severity ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END) FILTER (WHERE acknowledged_at IS NULL AND resolved_at IS NULL))[1] AS "openSeverity"
         FROM ops_alerts GROUP BY alert_code
        HAVING count(*) FILTER (WHERE acknowledged_at IS NULL) > 0 OR max(raised_at) > now() - interval '7 days'
        ORDER BY count(*) FILTER (WHERE acknowledged_at IS NULL AND resolved_at IS NULL) DESC, max(raised_at) DESC`);
    return { items, total: t?.n ?? 0, resolvedHidden: hideResolved ? t?.resolved ?? 0 : 0, page, size, pages: Math.max(1, Math.ceil((t?.n ?? 0) / size)), codes };
  }

  async ack(id: string, note?: string) {
    if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 알림입니다.');
    const [r] = await this.db.query<{ id: string }>(
      `UPDATE ops_alerts SET acknowledged_at = now(), acknowledged_by = $2, ack_note = $3
        WHERE id = $1::bigint AND acknowledged_at IS NULL RETURNING id::text AS id`, [id, this.me, note?.trim() || null]);
    if (r) return { ok: true, id, note: '확인했습니다.' };
    const [x] = await this.db.query(`SELECT 1 FROM ops_alerts WHERE id = $1::bigint`, [id]);
    if (!x) throw new NotFound('없는 알림입니다.');
    throw new StateConflict('ALERT_ACKED', '이미 확인한 알림입니다.');
  }

  /** 같은 종류의 확인 안 한 알림을 한꺼번에 확인 */
  async ackCode(code: string, note?: string) {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE ops_alerts SET acknowledged_at = now(), acknowledged_by = $2, ack_note = $3
        WHERE alert_code = $1 AND acknowledged_at IS NULL RETURNING id::text AS id`, [code, this.me, note?.trim() || null]);
    return { ok: true, code, acknowledged: rows.length, note: rows.length ? `${rows.length}건을 확인했습니다.` : '확인할 알림이 없습니다.' };
  }

  /**
   * v10.232 (docs/371) — 종류를 가리지 않고 한꺼번에 확인. CRITICAL 은 늘 뺌(하나씩 · 종류별로).
   *   resolved 원인이 없어진(풀린) 것 모두 · older 정한 시간(6 · 24 · 72)보다 먼저 생긴 INFO · WARN 모두. preview 면 세기만.
   */
  async ackBulk(scope: string, hours?: number, note?: string, preview = false) {
    if (scope !== 'resolved' && !(scope === 'older' && [6, 24, 72].includes(hours ?? -1)))
      throw new PolicyViolation('ACK_BULK_SCOPE', '풀린 것(resolved) 또는 6 · 24 · 72시간 넘은 것(older)만 고를 수 있습니다.');
    const h = scope === 'older' ? hours! : null;
    const where = `acknowledged_at IS NULL AND severity <> 'CRITICAL' AND ${scope === 'resolved' ? 'resolved_at IS NOT NULL' : `raised_at < now() - make_interval(hours => $1::int)`}`;
    const args: unknown[] = scope === 'older' ? [h] : [];
    if (preview) {
      const [c] = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ops_alerts WHERE ${where}`, args);
      return { ok: true, scope, hours: h, count: c?.n ?? 0, note: `${c?.n ?? 0}건을 확인하게 됩니다(CRITICAL 은 빼고).` };
    }
    const rows = await this.db.query<{ id: string }>(
      `UPDATE ops_alerts SET acknowledged_at = now(), acknowledged_by = $${args.length + 1}, ack_note = $${args.length + 2}
        WHERE ${where} RETURNING id::text AS id`, [...args, this.me, note?.trim() || null]);
    return { ok: true, scope, hours: h, count: rows.length, note: rows.length ? `${rows.length}건을 확인했습니다.` : '확인할 알림이 없습니다.' };
  }

  /* ── v10.198 (D176 · docs/312) 메일 준비 상태 · 시험 메일 ─────────────── */

  private async digestTo(): Promise<string> {
    const [c] = await this.db.query<{ to: string }>(`SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.digest_to'), '') AS "to"`);
    return (c?.to ?? '').trim();
  }

  /** 운영 알림 화면 「메일」 줄 — 준비 여부 · 까닭 · 받는 주소(가림) · 마지막 정기 작업 결과 · 마지막 시험 메일 */
  async mailStatus() {
    const [st, to] = await Promise.all([this.mail.status(), this.digestTo()]);
    const [j] = await this.db.query<{ at: string; detail: string | null }>(
      `SELECT started_at AS at, detail FROM job_runs WHERE job = 'launch_watch' AND ok ORDER BY started_at DESC LIMIT 1`);
    let lastJob: { at: string; pending: number; mailed: number; reason: string | null } | null = null;
    const m = /"alertMail":(\{[^}]*\})/.exec(j?.detail ?? '');
    if (j && m) {
      try { const a = JSON.parse(m[1]); lastJob = { at: j.at, pending: Number(a.pending) || 0, mailed: Number(a.mailed) || 0, reason: a.reason ?? null }; } catch { /* 옛 기록 · 잘린 기록 */ }
    }
    const [t] = await this.db.query<{ at: string; result: any }>(
      `SELECT occurred_at AS at, after_data AS result FROM audit.audit_logs WHERE action = 'OPS_MAIL_TEST' ORDER BY occurred_at DESC LIMIT 1`);
    /* v10.200 (D178) — 텔레그램 줄 */
    const ps = await this.telegram.status();
    let pushJob: { at: string; pending: number; pushed: number; reason: string | null } | null = null;
    const pm = /"alertPush":(\{[^}]*\})/.exec(j?.detail ?? '');
    if (j && pm) {
      try { const a = JSON.parse(pm[1]); pushJob = { at: j.at, pending: Number(a.pending) || 0, pushed: Number(a.pushed) || 0, reason: a.reason ?? null }; } catch { /* 잘린 기록 */ }
    }
    const [pt] = await this.db.query<{ at: string; result: any }>(
      `SELECT occurred_at AS at, after_data AS result FROM audit.audit_logs WHERE action = 'OPS_PUSH_TEST' ORDER BY occurred_at DESC LIMIT 1`);
    /* v10.201 (D179) — 하루 요약 텔레그램(설정 · 마지막 하루 요약을 보냈는지) */
    const [dg] = await this.db.query<{ sw: string; at: string | null; pushed: boolean | null; reason: string | null }>(
      `SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.telegram_digest'), 'on') AS sw,
              d.raised_at AS at, (d.detail->>'pushed')::boolean AS pushed, d.detail->>'pushReason' AS reason
         FROM (SELECT 1) x LEFT JOIN LATERAL (SELECT raised_at, detail FROM ops_alerts WHERE alert_code = 'DAILY_DIGEST' ORDER BY id DESC LIMIT 1) d ON true`);
    return {
      ready: st.ready, reason: st.reason, to: to ? maskMail(to) : null, lastJob,
      lastTest: t ? { at: t.at, ok: !!t.result?.ok, reason: t.result?.reason ?? null } : null,
      push: { ready: ps.ready, reason: ps.reason, chat: ps.chat, lastJob: pushJob,
              lastTest: pt ? { at: pt.at, ok: !!pt.result?.ok, reason: pt.result?.reason ?? null } : null,
              digest: { on: dg?.sw === 'on', last: dg?.at ? { at: dg.at, pushed: !!dg.pushed, reason: dg.reason ?? null } : null } },
      slack: await this.slackStatus(j),
    };
  }

  /** 시험 메일 한 통(SUPER · 1분에 1번) — 외부 연동 › 메일의 시험 메일(아무 주소 · 스위치와 따로)과 달리 **급한 알림 메일과 같은 길**
   *  (받는 주소 ops.digest_to · 메일 준비 ready)로 보냄. 못 보내도 200 으로 까닭을 돌려줌 — 감사 기록(OPS_MAIL_TEST)에 결과가 남도록 */
  async mailTest(): Promise<{ ok: boolean; reason: string | null; to: string | null; note: string }> {
    const [w] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit.audit_logs WHERE action = 'OPS_MAIL_TEST' AND occurred_at > now() - interval '1 minute'`);
    if (Date.now() - OpsAlertsService.lastTestAt < 60_000 || (w?.n ?? 0) > 0) throw new StateConflict('MAIL_TEST_WAIT', '시험 메일은 1분에 한 번만 보낼 수 있습니다.');
    OpsAlertsService.lastTestAt = Date.now();
    const to = await this.digestTo();
    if (!to) return { ok: false, reason: 'NO_TO', to: null, note: '하루 요약 받는 주소(ops.digest_to)가 비어 있습니다.' };
    const st = await this.mail.status();
    if (!st.ready) return { ok: false, reason: `MAIL_NOT_READY_${st.reason}`, to: maskMail(to), note: '메일이 준비되지 않았습니다 — 보내지 않았습니다.' };
    const r = await this.mail.send({
      to, subject: '[소개뱅크] 운영 알림 시험 메일',
      text: ['소개뱅크 운영 알림 시험 메일입니다.', '', '이 메일이 왔다면 급한 운영 알림 · 하루 요약 메일이 이 주소로 옵니다.', '운영 화면 › 운영 알림에서 SUPER 가 보냈습니다.'].join('\n'),
    });
    return r.ok
      ? { ok: true, reason: null, to: maskMail(to), note: '시험 메일을 보냈습니다 — 받은 편지함(스팸함 포함)을 확인하십시오.' }
      : { ok: false, reason: `SEND_${r.errorKind ?? 'FAILED'}`, to: maskMail(to), note: '보내지 못했습니다.' };
  }

  /* ── v10.200 (D178 · docs/316) 텔레그램 시험 · 대화방 찾기 ─────────────── */

  /** 시험 메시지 한 통(SUPER · 1분에 1번) — 급한 알림과 같은 길(토큰 · ops.telegram_chat). 못 보내도 200 + 까닭(감사 기록 OPS_PUSH_TEST) */
  async pushTest(): Promise<{ ok: boolean; reason: string | null; chat: string | null; note: string }> {
    const [w] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit.audit_logs WHERE action = 'OPS_PUSH_TEST' AND occurred_at > now() - interval '1 minute'`);
    if (Date.now() - OpsAlertsService.lastPushTestAt < 60_000 || (w?.n ?? 0) > 0) throw new StateConflict('PUSH_TEST_WAIT', '시험 메시지는 1분에 한 번만 보낼 수 있습니다.');
    OpsAlertsService.lastPushTestAt = Date.now();
    const st = await this.telegram.status();
    if (!st.ready) await opsBoardPost(this.db, 'TEST', '텔레그램 시험 메시지(보내지 못함)', '[소개뱅크] 운영 알림 시험 메시지입니다.', st.reason, null);   // v10.286 — 꺼져 있어도 올림
    if (!st.ready) return { ok: false, reason: st.reason, chat: st.chat,
      note: st.reason === 'NO_TOKEN' ? '텔레그램 봇 토큰이 없습니다 — 외부 연동 › 연동 키 › 메일 칸 「텔레그램 봇 토큰」에 넣으십시오.' : '받을 대화방이 없습니다 — 「대화방 찾기」로 고르십시오.' };
    const text = ['[소개뱅크] 운영 알림 시험 메시지입니다.', '', '이 메시지가 왔다면 급한 운영 알림이 이 대화방으로 옵니다.', '운영 화면 › 운영 알림에서 SUPER 가 보냈습니다.'].join('\n');
    const r = await this.telegram.send(text);
    await opsBoardPost(this.db, 'TEST', '텔레그램 시험 메시지', text, r.ok ? 'SENT' : `SEND_${r.errorKind ?? 'FAILED'}`, null);   // v10.286
    return r.ok
      ? { ok: true, reason: null, chat: st.chat, note: '시험 메시지를 보냈습니다 — 텔레그램 대화방을 확인하십시오.' }
      : { ok: false, reason: `SEND_${r.errorKind ?? 'FAILED'}`, chat: st.chat,
          note: r.errorKind === 'AUTH' ? '보내지 못했습니다 — 봇 토큰이 맞지 않습니다.' : r.errorKind === 'NETWORK' || r.errorKind === 'TIMEOUT' ? '보내지 못했습니다 — 서버에서 텔레그램(api.telegram.org)으로 나가는 길을 확인하십시오.' : '보내지 못했습니다 — 대화방 번호 · 봇이 그 대화방에 있는지 확인하십시오.' };
  }

  /** v10.234 (docs/375) — 지금 텔레그램이 켜져 있다면 다음 정기 작업(10분마다)이 보낼 첫 차례 — 읽기만(보내지 않고 「보냄」도 적지 않음).
   *  대기 목록 · 남은 수 · 글은 정기 작업(alertPush)과 같은 함수라 켠 뒤 처음 오는 글과 같음(그 사이 새 알림이 생기면 달라짐) */
  async pushPreview(): Promise<{ ready: boolean; reason: string | null; pending: number; critical: number; again: number; backlog: number;
    parts: { n: number; chars: number; text: string }[]; included: number; more: number; maxParts: number; maxChars: number; note: string }> {
    const [st, items, backlog] = await Promise.all([this.telegram.status(), this.launchWatch.alertPushPending(), this.launchWatch.alertBacklog('push')]);
    const plan = buildAlertPush(items, backlog);
    const parts = plan.parts.map((p) => ({ n: p.items.length, chars: p.text.length, text: p.text }));
    const note = !items.length ? '지금 보낼 급한 알림이 없습니다 — 켜도 바로 오는 글은 없습니다.'
      : `켜면 다음 차례(10분 안)에 ${parts.length}통 · 알림 ${plan.included}건이 갑니다${plan.more ? ` — 남은 ${plan.more}건은 그다음 차례에 이어서` : ''}.`;
    return { ready: st.ready, reason: st.reason, pending: items.length, critical: items.filter((x) => x.severity === 'CRITICAL').length,
      again: items.filter((x) => x.again).length, backlog, parts, included: plan.included, more: plan.more, maxParts: PUSH_PARTS, maxChars: TG_MAX, note };
  }

  /** 봇에게 최근 말을 건 대화방 — 고르면 화면이 사이트 설정 ops.telegram_chat 에 넣음 */
  async pushFindChat(): Promise<{ ok: boolean; reason: string | null; chats: Array<{ id: string; type: string; title: string }>; note: string }> {
    const { r, chats } = await this.telegram.findChats();
    if (!r.ok) return { ok: false, reason: r.error === 'NO_TOKEN' ? 'NO_TOKEN' : `SEND_${r.errorKind ?? 'FAILED'}`, chats: [],
      note: r.error === 'NO_TOKEN' ? '텔레그램 봇 토큰이 없습니다 — 외부 연동 › 연동 키 › 메일 칸에 넣으십시오.' : '텔레그램에서 대화방을 읽지 못했습니다.' };
    return { ok: true, reason: null, chats,
      note: chats.length ? '받을 대화방을 고르십시오.' : '찾은 대화방이 없습니다 — 텔레그램에서 봇에게 아무 말이나 한 번 보낸 뒤 다시 누르십시오.' };
  }

  /* ── v10.237 (D200 · docs/377) 슬랙 준비 상태 · 시험 · 첫 차례 미리보기 ─────────────── */

  /** 운영 알림 화면 「슬랙」 줄 — 준비 여부 · 주소 끝 4자 · 마지막 정기 작업(launch_watch detail.alertSlack) · 마지막 시험 · 하루 요약 */
  private async slackStatus(j: { at: string; detail: string | null } | undefined) {
    const st = this.slack.status();
    let lastJob: { at: string; pending: number; pushed: number; reason: string | null } | null = null;
    const m = /"alertSlack":(\{[^}]*\})/.exec(j?.detail ?? '');
    if (j && m) {
      try { const a = JSON.parse(m[1]); lastJob = { at: j.at, pending: Number(a.pending) || 0, pushed: Number(a.pushed) || 0, reason: a.reason ?? null }; } catch { /* 잘린 기록 */ }
    }
    const [t] = await this.db.query<{ at: string; result: any }>(
      `SELECT occurred_at AS at, after_data AS result FROM audit.audit_logs WHERE action = 'OPS_SLACK_TEST' ORDER BY occurred_at DESC LIMIT 1`);
    const [dg] = await this.db.query<{ sw: string; at: string | null; pushed: boolean | null; reason: string | null }>(
      `SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.slack_digest'), 'on') AS sw,
              d.raised_at AS at, (d.detail->>'slacked')::boolean AS pushed, d.detail->>'slackReason' AS reason
         FROM (SELECT 1) x LEFT JOIN LATERAL (SELECT raised_at, detail FROM ops_alerts WHERE alert_code = 'DAILY_DIGEST' ORDER BY id DESC LIMIT 1) d ON true`);
    return { ready: st.ready, reason: st.reason, hook: st.hook, lastJob,
             lastTest: t ? { at: t.at, ok: !!t.result?.ok, reason: t.result?.reason ?? null } : null,
             digest: { on: dg?.sw === 'on', last: dg?.at ? { at: dg.at, pushed: !!dg.pushed, reason: dg.reason ?? null } : null } };
  }

  /** 시험 메시지 한 통(SUPER · 1분에 1번) — 급한 알림과 같은 길(웹훅 주소). 못 보내도 200 + 까닭(감사 기록 OPS_SLACK_TEST) */
  async slackTest(): Promise<{ ok: boolean; reason: string | null; hook: string | null; note: string }> {
    const [w] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit.audit_logs WHERE action = 'OPS_SLACK_TEST' AND occurred_at > now() - interval '1 minute'`);
    if (Date.now() - OpsAlertsService.lastSlackTestAt < 60_000 || (w?.n ?? 0) > 0) throw new StateConflict('SLACK_TEST_WAIT', '시험 메시지는 1분에 한 번만 보낼 수 있습니다.');
    OpsAlertsService.lastSlackTestAt = Date.now();
    const st = this.slack.status();
    if (!st.ready) await opsBoardPost(this.db, 'TEST', '슬랙 시험 메시지(보내지 못함)', '[소개뱅크] 운영 알림 시험 메시지입니다.', null, st.reason);   // v10.286
    if (!st.ready) return { ok: false, reason: st.reason, hook: null, note: '슬랙 웹훅 주소가 없습니다 — 외부 연동 › 연동 키 › 메일 칸 「슬랙 웹훅 주소」에 넣으십시오.' };
    const text = ['[소개뱅크] 운영 알림 시험 메시지입니다.', '', '이 메시지가 왔다면 급한 운영 알림이 이 슬랙 채널로 옵니다.', '운영 화면 › 운영 알림에서 SUPER 가 보냈습니다.'].join('\n');
    const r = await this.slack.send(text);
    await opsBoardPost(this.db, 'TEST', '슬랙 시험 메시지', text, null, r.ok ? 'SENT' : `SEND_${r.errorKind ?? 'FAILED'}`);   // v10.286
    return r.ok
      ? { ok: true, reason: null, hook: st.hook, note: '시험 메시지를 보냈습니다 — 슬랙 채널을 확인하십시오.' }
      : { ok: false, reason: `SEND_${r.errorKind ?? 'FAILED'}`, hook: st.hook,
          note: r.errorKind === 'AUTH' ? '보내지 못했습니다 — 웹훅 주소가 지워졌거나 채널이 보관되었습니다. 슬랙 앱에서 주소를 다시 만드십시오.'
            : r.errorKind === 'NETWORK' || r.errorKind === 'TIMEOUT' ? '보내지 못했습니다 — 서버에서 슬랙(hooks.slack.com)으로 나가는 길을 확인하십시오.' : '보내지 못했습니다 — 슬랙이 글을 받지 않았습니다.' };
  }

  /** 지금 슬랙이 켜져 있다면 다음 정기 작업(10분마다)이 보낼 첫 차례 — 읽기만(텔레그램 pushPreview 와 같은 글 · 칸만 slack_pushed_at) */
  async slackPreview(): Promise<{ ready: boolean; reason: string | null; pending: number; critical: number; again: number; backlog: number;
    parts: { n: number; chars: number; text: string }[]; included: number; more: number; maxParts: number; maxChars: number; note: string }> {
    const st = this.slack.status();
    const [items, backlog] = await Promise.all([this.launchWatch.alertPushPending('slack'), this.launchWatch.alertBacklog('slack')]);
    const plan = buildAlertPush(items, backlog);
    const parts = plan.parts.map((p) => ({ n: p.items.length, chars: p.text.length, text: p.text }));
    const note = !items.length ? '지금 보낼 급한 알림이 없습니다 — 켜도 바로 오는 글은 없습니다.'
      : `켜면 다음 차례(10분 안)에 ${parts.length}통 · 알림 ${plan.included}건이 갑니다${plan.more ? ` — 남은 ${plan.more}건은 그다음 차례에 이어서` : ''}.`;
    return { ready: st.ready, reason: st.reason, pending: items.length, critical: items.filter((x) => x.severity === 'CRITICAL').length,
      again: items.filter((x) => x.again).length, backlog, parts, included: plan.included, more: plan.more, maxParts: PUSH_PARTS, maxChars: TG_MAX, note };
  }
}
