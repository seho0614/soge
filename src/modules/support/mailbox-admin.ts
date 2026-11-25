import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { effective, permMode } from '../admin/perm.service';
import { permDecideMode } from '../admin/perm-mode';
import type { MailService } from '../../common/mail/mail.service';

/* ---------------------------------------------------------------------
 * v10.790 (D330 · docs/905) 사내 웹메일 W1 — 운영 화면 「공용 메일함」 API
 *
 *   메일함마다 업무 권한(mail_boxes.task_key — mailbox-privacy · mailbox-help · mailbox-admin)으로 거름:
 *     SUPER = 모두 · 업무 권한 판정을 켠 경우(perm.enforce ON/SHADOW · perm.mode GROUPS/COMPARE) = 그 업무 VIEW 가 있는 메일함만
 *     둘 다 꺼짐(처음 · 역할만) = ADMIN 이면 모두(지금 다른 운영 화면과 같은 기준)
 *   열기 · 답장 · 맡기 · 끝냄 · 스팸 · 첨부 내려받기는 mail_access_log 에 한 줄(쌓기만 · 트리거가 고치기 · 지우기 막음).
 *   바이러스 판정 FAIL 인 메일의 첨부는 내려받지 못함(MAIL_VIRUS) · 본문 HTML 은 그대로 보내고 화면이 격리 틀(sandbox · CSP)로 보임.
 *   답장은 SES(MailService) — 보내는 주소 = 그 공용 주소 · In-Reply-To · References · 메일 준비 안 됨이면 422 MAIL_NOT_READY.
 * ------------------------------------------------------------------- */

export const MAIL_STATES = ['NEW', 'ASSIGNED', 'DONE', 'SPAM'] as const;
export const MAIL_REPLY_MAX = 20000;
const idOk = (id: string) => { if (!/^\d{1,18}$/.test(id ?? '')) throw new NotFound('메일이 없습니다.'); return id; };

async function allowedBoxIds(db: DatabaseService): Promise<number[] | 'ALL'> {
  const role = RequestCtx.get()?.actorRole ?? '';
  const who = RequestCtx.actorId();
  if (!who) throw new Forbidden('FORBIDDEN', '권한이 없습니다.');
  if (role === 'SUPER') return 'ALL';
  const [mode, pm] = await Promise.all([permMode(db), permDecideMode(db)]);
  if (mode === 'OFF' && pm === 'ROLE') return 'ALL';
  const eff = await effective(db, who);
  const boxes = await db.query<{ id: number; task_key: string }>(`SELECT id, task_key FROM mail_boxes WHERE is_active`);
  return boxes.filter((b) => eff.has(`${b.task_key}:VIEW`)).map((b) => b.id);
}

async function boxGuard(db: DatabaseService, boxId: number): Promise<void> {
  const ok = await allowedBoxIds(db);
  if (ok !== 'ALL' && !ok.includes(boxId)) throw new Forbidden('PERM_DENIED', '이 공용 메일함의 권한이 없습니다 — SUPER 에게 권한그룹을 요청하십시오.');
}

async function log(db: DatabaseService, messageId: string, action: string) {
  await db.query(`INSERT INTO mail_access_log (message_id, account_id, action) VALUES ($1::bigint, $2::uuid, $3)`, [messageId, RequestCtx.actorId(), action]);
}

export async function listMessages(db: DatabaseService, q: { box?: string; state?: string; q?: string; page?: number }) {
  const ok = await allowedBoxIds(db);
  const boxes = await db.query<{ id: number; address: string; label: string; fresh: number }>(
    `SELECT b.id, b.address, b.label, (SELECT count(*)::int FROM mail_messages m WHERE m.box_id = b.id AND m.direction = 'IN' AND m.state = 'NEW') AS fresh
       FROM mail_boxes b WHERE b.is_active ${ok === 'ALL' ? '' : 'AND b.id = ANY($1::int[])'} ORDER BY b.id`, ok === 'ALL' ? [] : [ok]);
  const ids = boxes.map((b) => b.id);
  const box = q.box && /^\d{1,9}$/.test(q.box) ? Number(q.box) : null;
  if (box !== null && !ids.includes(box)) throw new Forbidden('PERM_DENIED', '이 공용 메일함의 권한이 없습니다 — SUPER 에게 권한그룹을 요청하십시오.');
  const state = q.state && (MAIL_STATES as readonly string[]).includes(q.state) ? q.state : null;
  const text = (q.q ?? '').trim().slice(0, 100);
  const page = Math.max(1, Math.min(1000, Number(q.page) || 1));
  const rows = ids.length ? await db.query(
    `SELECT m.id::text AS id, m.box_id AS "boxId", m.direction, m.from_addr AS "fromAddr", m.from_name AS "fromName", m.subject, m.state,
            m.received_at AS "receivedAt", m.has_content AS "hasContent", m.spam, m.virus, m.dmarc,
            (SELECT count(*)::int FROM mail_attachments a WHERE a.message_id = m.id) AS attachments,
            ac.name AS "assigneeName", count(*) OVER()::int AS total
       FROM mail_messages m LEFT JOIN accounts ac ON ac.id = m.assignee
      WHERE m.box_id = ANY($1::int[]) AND m.direction = 'IN'
        AND ($2::int IS NULL OR m.box_id = $2) AND ($3::text IS NULL OR m.state = $3)
        AND ($4::text = '' OR m.subject ILIKE '%' || $4 || '%' OR m.from_addr ILIKE '%' || $4 || '%')
      ORDER BY m.received_at DESC, m.id DESC LIMIT 30 OFFSET $5`,
    [ids, box, state, text.replace(/[%_\\]/g, (c) => '\\' + c), (page - 1) * 30]) : [];
  return { boxes, items: rows.map((r: any) => { const { total: _t, ...x } = r; return x; }), total: Number((rows[0] as any)?.total ?? 0), page };
}

export async function getMessage(db: DatabaseService, id: string) {
  const [m] = await db.query<any>(
    `SELECT m.id::text AS id, m.box_id AS "boxId", b.address AS "boxAddress", b.label AS "boxLabel", m.direction, m.ses_message_id AS "sesMessageId",
            m.header_msgid AS "headerMsgid", m.thread_key AS "threadKey", m.from_addr AS "fromAddr", m.from_name AS "fromName", m.to_addrs AS "toAddrs",
            m.cc_addrs AS "ccAddrs", m.subject, m.sent_at AS "sentAt", m.received_at AS "receivedAt", m.text_body AS "textBody", m.html_body AS "htmlBody",
            m.size_bytes AS "sizeBytes", m.has_content AS "hasContent", m.s3_bucket AS "s3Bucket", m.s3_key AS "s3Key",
            m.spam, m.virus, m.spf, m.dkim, m.dmarc, m.state, m.assignee::text AS assignee, ac.name AS "assigneeName", m.done_at AS "doneAt"
       FROM mail_messages m JOIN mail_boxes b ON b.id = m.box_id LEFT JOIN accounts ac ON ac.id = m.assignee
      WHERE m.id = $1::bigint`, [idOk(id)]);
  if (!m) throw new NotFound('메일이 없습니다.');
  await boxGuard(db, m.boxId);
  const attachments = await db.query(
    `SELECT id::text AS id, filename, content_type AS "contentType", size_bytes AS "sizeBytes", content_id AS "contentId", is_inline AS "inline"
       FROM mail_attachments WHERE message_id = $1::bigint ORDER BY id`, [id]);
  const thread = m.threadKey ? await db.query(
    `SELECT id::text AS id, direction, from_addr AS "fromAddr", subject, state, received_at AS "receivedAt"
       FROM mail_messages WHERE box_id = $1 AND thread_key = $2 AND id <> $3::bigint ORDER BY received_at LIMIT 50`, [m.boxId, m.threadKey, id]) : [];
  const accessLog = await db.query(
    `SELECT l.action, l.at, a.name FROM mail_access_log l LEFT JOIN accounts a ON a.id = l.account_id WHERE l.message_id = $1::bigint ORDER BY l.at DESC LIMIT 30`, [id]);
  await log(db, id, 'VIEW');
  const verified = m.spf === 'PASS' || m.dkim === 'PASS';
  return { ...m, attachments, thread, accessLog, senderUnverified: !verified || m.dmarc === 'FAIL', virusBlocked: m.virus === 'FAIL' };
}

export async function loadForChange(db: DatabaseService, id: string) {
  const [m] = await db.query<{ box_id: number; state: string; direction: string }>(`SELECT box_id, state, direction FROM mail_messages WHERE id = $1::bigint`, [idOk(id)]);
  if (!m) throw new NotFound('메일이 없습니다.');
  if (m.direction !== 'IN') throw new StateConflict('MAIL_NOT_INBOUND', '받은 메일만 처리할 수 있습니다.');
  await boxGuard(db, m.box_id);
  return m;
}

export async function assignMessage(db: DatabaseService, id: string, assignee: string | null) {
  const m = await loadForChange(db, id);
  if (assignee !== null) {
    const [a] = await db.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id::text = $1 AND r.role IN ('ADMIN', 'SUPER')) AS ok`, [assignee]);
    if (!a?.ok) throw new PolicyViolation('MAIL_ASSIGNEE', '운영자에게만 맡길 수 있습니다.');
  }
  const next = assignee ? (m.state === 'NEW' ? 'ASSIGNED' : m.state) : (m.state === 'ASSIGNED' ? 'NEW' : m.state);
  await db.query(`UPDATE mail_messages SET assignee = $2::uuid, state = $3 WHERE id = $1::bigint`, [id, assignee, next]);
  await log(db, id, 'ASSIGN');
  return { ok: true, id, state: next };
}

export async function setState(db: DatabaseService, id: string, state: string) {
  if (!['DONE', 'NEW', 'SPAM'].includes(state)) throw new PolicyViolation('MAIL_STATE', '바꿀 수 있는 상태는 DONE · NEW · SPAM 입니다.');
  await loadForChange(db, id);
  if (state === 'DONE') {
    await db.query(`UPDATE mail_messages SET state = 'DONE', done_at = now(), done_by = $2::uuid WHERE id = $1::bigint`, [id, RequestCtx.actorId()]);
    await log(db, id, 'DONE');
  } else {
    await db.query(`UPDATE mail_messages SET state = CASE WHEN $2 = 'NEW' AND assignee IS NOT NULL THEN 'ASSIGNED' ELSE $2 END, done_at = NULL, done_by = NULL WHERE id = $1::bigint`, [id, state]);
    await log(db, id, state === 'SPAM' ? 'SPAM' : 'REOPEN');
  }
  const [r] = await db.query<{ state: string }>(`SELECT state FROM mail_messages WHERE id = $1::bigint`, [id]);
  return { ok: true, id, state: r?.state ?? state };
}

export async function replyMessage(db: DatabaseService, mail: MailService, id: string, body: string, done: boolean) {
  const text = (body ?? '').trim();
  if (text.length < 2 || text.length > MAIL_REPLY_MAX) throw new PolicyViolation('MAIL_REPLY_LENGTH', '답장은 2 ~ 20000자입니다.');
  await loadForChange(db, id);
  const [m] = await db.query<{ box_id: number; address: string; label: string; from_addr: string | null; subject: string | null; header_msgid: string | null; thread_key: string | null; spam: string | null }>(
    `SELECT m.box_id, b.address, b.label, m.from_addr, m.subject, m.header_msgid, m.thread_key, m.spam
       FROM mail_messages m JOIN mail_boxes b ON b.id = m.box_id WHERE m.id = $1::bigint`, [id]);
  if (!m?.from_addr) throw new StateConflict('MAIL_NO_SENDER', '보낸 사람 주소가 없어 답장할 수 없습니다.');
  if (!(await mail.ready())) throw new PolicyViolation('MAIL_NOT_READY', '메일 보내기 준비가 안 됐습니다 — 외부 연동 › 메일에서 설정 · 시험 메일을 먼저 하십시오.');
  const subject = /^re:/i.test(m.subject ?? '') ? String(m.subject) : `Re: ${m.subject ?? ''}`.trim();
  const ref = m.header_msgid ? `<${m.header_msgid}>` : undefined;
  const r = await mail.send({ to: m.from_addr, subject: subject.slice(0, 900), text, from: m.address, fromName: `소개뱅크 ${m.label}`,
    inReplyTo: ref, references: ref ? [ref] : undefined });
  if (!r.ok) throw new PolicyViolation('MAIL_SEND_FAILED', '답장을 보내지 못했습니다 — 잠시 뒤 다시 해 주십시오.');
  const [o] = await db.query<{ id: string }>(
    `INSERT INTO mail_messages (box_id, direction, header_msgid, in_reply_to, thread_key, from_addr, to_addrs, subject, sent_at, text_body, has_content, state, sent_by, reply_to_id)
     VALUES ($1, 'OUT', $2, $3, $4, $5, ARRAY[$6]::text[], $7, now(), $8, true, 'SENT', $9::uuid, $10::bigint) RETURNING id::text AS id`,
    [m.box_id, (r.messageId ?? '').replace(/^<|>$/g, '').slice(0, 500) || null, m.header_msgid, m.thread_key, m.address, m.from_addr, subject.slice(0, 1000), text, RequestCtx.actorId(), id]);
  await log(db, id, 'REPLY');
  if (done) await setState(db, id, 'DONE');
  return { ok: true, id, sentId: o?.id ?? null };
}

export async function getAttachment(db: DatabaseService, id: string) {
  const [a] = await db.query<{ message_id: string; filename: string; content_type: string; data: Buffer; box_id: number; virus: string | null }>(
    `SELECT a.message_id::text AS message_id, a.filename, a.content_type, a.data, m.box_id, m.virus
       FROM mail_attachments a JOIN mail_messages m ON m.id = a.message_id WHERE a.id = $1::bigint`, [idOk(id)]);
  if (!a) throw new NotFound('첨부가 없습니다.');
  await boxGuard(db, a.box_id);
  if (a.virus === 'FAIL') throw new PolicyViolation('MAIL_VIRUS', '바이러스 판정이 나온 메일의 첨부는 내려받을 수 없습니다.');
  await log(db, a.message_id, 'DOWNLOAD');
  return { filename: a.filename, contentType: a.content_type, dataBase64: Buffer.from(a.data).toString('base64') };
}
