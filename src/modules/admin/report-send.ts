import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { MailService } from '../../common/mail/mail.service';
import { SlackService } from '../../common/slack/slack.service';
import { TelegramService } from '../../common/telegram/telegram.service';
import { textOf } from './report-day';
import { Kind, snapshotById } from './report-period';

/* ---------------------------------------------------------------------
 * v10.415 (D250 · docs/552) 보고 보내기 · 설정
 *   운영 알림 채널을 그대로 씀 — 텔레그램(급한 알림 대화방) · 슬랙 · 메일(ops.digest_to · 메일 준비됐을 때).
 *   스위치 report.send(처음 off · SUPER) · 종류 report.send_kinds(DAY · WEEK · MONTH).
 *   정기 작업은 스위치가 on 이고 그 종류일 때만 · 운영 화면 「지금 보내기」(SUPER)는 스위치와 상관없이 그 보고 한 번.
 *   보낸 결과는 report_sends(채널마다 한 줄 · 쌓기만). 글은 숫자만(이름 · 연락처 없음).
 * ------------------------------------------------------------------- */

export interface SendDeps { telegram: TelegramService; slack: SlackService; mail: MailService }

export async function sendSettings(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key IN ('report.send', 'report.send_kinds', 'ops.digest_to')`);
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const kinds = (v('report.send_kinds') ?? 'DAY,WEEK,MONTH').split(',').filter((x) => ['DAY', 'WEEK', 'MONTH'].includes(x)) as Kind[];
  return { on: (v('report.send') ?? 'off') === 'on', kinds, mailTo: v('ops.digest_to') ? '설정됨' : '' };
}

/** 설정 바꾸기(SUPER · 사유) — 설정 바뀜 기록은 site_settings 트리거가 남김 */
export async function setSendSettings(db: DatabaseService, b: { on?: boolean; kinds?: string[]; reason?: string }) {
  const reason = String(b.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('REPORT_REASON', '사유는 2 ~ 200자입니다.');
  const kinds = Array.isArray(b.kinds) ? [...new Set(b.kinds)].filter((x) => ['DAY', 'WEEK', 'MONTH'].includes(x)) : null;
  if (kinds && !kinds.length) throw new PolicyViolation('REPORT_KIND', '보낼 보고 종류를 하나 이상 고릅니다.');
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    if (b.on != null) await db.query(`UPDATE site_settings SET value = $1 WHERE key = 'report.send'`, [b.on ? 'on' : 'off']);
    if (kinds) await db.query(`UPDATE site_settings SET value = $1 WHERE key = 'report.send_kinds'`, [kinds.join(',')]);
  });
  return { ok: true, ...(await sendSettings(db)), note: '보고 보내기 설정을 바꿨습니다.' };
}

/** 한 보고를 켜 둔 채널로 보냄 — 준비 안 된 채널은 까닭만 남김 */
export async function sendSnapshot(db: DatabaseService, deps: SendDeps, id: string, actor: string | null) {
  const s = await snapshotById(db, id);
  const text = textOf(s.body);
  const out: Array<{ channel: 'TELEGRAM' | 'SLACK' | 'MAIL'; result: string }> = [];
  const tg = await deps.telegram.status();
  if (tg.ready) { const r = await deps.telegram.send(text); out.push({ channel: 'TELEGRAM', result: r.ok ? 'SENT' : `SEND_${r.errorKind ?? 'FAILED'}` }); }
  else out.push({ channel: 'TELEGRAM', result: String(tg.reason ?? 'NOT_READY') });
  const sk = deps.slack.status();
  if (sk.ready) { const r = await deps.slack.send(text); out.push({ channel: 'SLACK', result: r.ok ? 'SENT' : `SEND_${r.errorKind ?? 'FAILED'}` }); }
  else out.push({ channel: 'SLACK', result: String(sk.reason ?? 'NOT_READY') });
  const [to] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'ops.digest_to'`);
  if (to?.v && (await deps.mail.ready())) {
    const kindKo = s.kind === 'DAY' ? '일보' : s.kind === 'WEEK' ? '주보' : '월보';
    const m = await deps.mail.send({ to: to.v, subject: `[소개뱅크] 업무 ${kindKo} ${s.period}`, text });
    out.push({ channel: 'MAIL', result: m.ok ? 'SENT' : 'SEND_FAILED' });
  } else out.push({ channel: 'MAIL', result: to?.v ? 'MAIL_NOT_READY' : 'NO_ADDRESS' });
  for (const o of out) await db.query(`INSERT INTO report_sends (snapshot_id, channel, result, sent_by) VALUES ($1::bigint, $2, $3, $4)`, [id, o.channel, o.result.slice(0, 60), actor]);
  const sent = out.filter((o) => o.result === 'SENT').length;
  return { ok: true, id, results: out, sent, note: sent ? `보고를 ${sent}곳에 보냈습니다.` : '보낼 수 있는 채널이 없습니다 — 운영 알림 채널(텔레그램 · 슬랙 · 메일)을 먼저 준비하십시오.' };
}

/** 정기 작업 뒤 — 스위치 on · 그 종류 · 새로 만든 것만 보냄 */
export async function sendAfterJob(db: DatabaseService, deps: SendDeps, made: Array<{ kind: Kind; id: string; made: boolean }>) {
  const st = await sendSettings(db);
  if (!st.on) return { on: false, sent: [] as string[] };
  const sent: string[] = [];
  for (const m of made) {
    if (!m.made || !st.kinds.includes(m.kind)) continue;
    const r = await sendSnapshot(db, deps, m.id, null);
    if (r.sent) sent.push(`${m.kind}:${m.id}`);
  }
  return { on: true, sent };
}
