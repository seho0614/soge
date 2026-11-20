import { createHash } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { MailService } from '../../common/mail/mail.service';
import { maskMail } from '../../common/mail/mail-admin.service';

/* ---------------------------------------------------------------------
 * v10.522 (D278 · docs/660) 파트너 직원 일괄 등록 CSV — 운영 화면 › 파트너사 › 직원 일괄 등록(SB-ADM-OAPI-020)
 *
 *   받는 칸은 둘뿐: email(필수) · can_settle(선택 · Y/N · 1/0 · true/false) — 이름 · 휴대폰 · 주민번호 같은 칸은 받지 않음(개인정보 최소)
 *   미리보기(PREVIEW) — 줄마다 결과: MEMBER(이미 가입한 회원 → 초대) · PENDING(아직 가입 안 함 → 가입 대기) · DUPLICATE(파일 안 같은 이메일)
 *                      · INVALID(이메일 모양 아님) · ALREADY(이미 이 회사 직원 · 초대) · OTHER_BUSINESS(다른 사업자 소속) · SELF(대표 계정)
 *   확정 — MEMBER = 기존 「직원 초대」(partner-company.service inviteStaff)와 같은 줄을 business_members 에(받아들이면 합류)
 *          PENDING = 가입 대기(pbulk.pending_days) · 원문 이메일은 이 동안만 · 15분마다 짝 맞춤(pbulk_match)
 *          줄마다 감사 기록 PBULK_ROW(이메일은 가린 값만)
 *   계정을 대신 만들지 않음 — 약관 동의 · 본인 가입이 먼저(P2P · 개인 회원 원칙)
 *   초대 메일 pbulk.invite_mail 처음 off — off 면 mail_state = OFF(기록만) · on 이고 메일 준비됨이면 짝 맞춤 작업이 보냄
 * ------------------------------------------------------------------- */

/** 이메일 모양 — DB ptn_bulk_invite_rows.email CHECK · 기존 직원 초대와 같음 */
export const PBULK_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CSV_MAX_BYTES = 200_000;
const TRUE_SET = new Set(['y', 'yes', '1', 'true', 'o']);

export const emailHash = (e: string) => createHash('sha256').update(e).digest('hex');

export interface PbulkSettings { inviteMail: boolean; maxRows: number; pendingDays: number }
export async function pbulkSettings(db: DatabaseService): Promise<PbulkSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('pbulk.invite_mail', 'pbulk.max_rows', 'pbulk.pending_days')`);
  const v = (k: string) => (rows.find((r) => r.key === k)?.value ?? '').trim();
  const mx = Number(v('pbulk.max_rows') || 200), pd = Number(v('pbulk.pending_days') || 30);
  return {
    inviteMail: v('pbulk.invite_mail') === 'on',
    maxRows: Number.isInteger(mx) && mx >= 10 && mx <= 1000 ? mx : 200,
    pendingDays: Number.isInteger(pd) && pd >= 7 && pd <= 90 ? pd : 30,
  };
}

/** CSV 한 줄 나누기 — 큰따옴표 묶음 · 쉼표 · 탭 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

export interface ParsedRow { line: number; email: string | null; raw: string; canSettle: boolean }
/** CSV 글 → 줄들(머리줄 email 이 있으면 그 칸 · 없으면 첫 칸이 이메일) */
export function parseInviteCsv(text: string, maxRows: number): ParsedRow[] {
  const src = String(text ?? '').replace(/^﻿/, '');
  if (!src.trim()) throw new PolicyViolation('PBULK_EMPTY', 'CSV 가 비어 있습니다 — 첫 줄 email,can_settle 다음 줄부터 이메일을 적으십시오.');
  if (Buffer.byteLength(src, 'utf8') > CSV_MAX_BYTES) throw new PolicyViolation('PBULK_TOO_BIG', 'CSV 는 200KB 까지입니다 — 나눠서 올리십시오.');
  const lines = src.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length);
  const head = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const hasHead = head.includes('email');
  const ei = hasHead ? head.indexOf('email') : 0;
  const si = hasHead ? head.indexOf('can_settle') : 1;
  const extra = hasHead ? head.filter((h) => h && h !== 'email' && h !== 'can_settle') : [];
  if (extra.length) throw new PolicyViolation('PBULK_COLUMNS', '받는 칸은 email · can_settle 둘뿐입니다 — 이름 · 전화 같은 칸은 지우고 올리십시오(개인정보 최소).');
  const body = hasHead ? lines.slice(1) : lines;
  if (!body.length) throw new PolicyViolation('PBULK_EMPTY', 'CSV 가 비어 있습니다 — 첫 줄 email,can_settle 다음 줄부터 이메일을 적으십시오.');
  if (body.length > maxRows) throw new PolicyViolation('PBULK_TOO_MANY', '한 번에 올릴 수 있는 줄 수를 넘었습니다 — 나눠서 올리십시오.');
  return body.map((l, i) => {
    const cells = splitCsvLine(l);
    const raw = String(cells[ei] ?? '').trim().toLowerCase();
    const st = si >= 0 ? String(cells[si] ?? '').trim().toLowerCase() : '';
    return { line: i + 1, raw, email: PBULK_EMAIL_RE.test(raw) && raw.length <= 254 ? raw : null, canSettle: TRUE_SET.has(st) };
  });
}

const reasonOk = (r: unknown) => {
  const s = String(r ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 200) throw new PolicyViolation('PBULK_REASON', '사유는 2 ~ 200자입니다.');
  return s;
};
const batchIdOf = (id: string) => {
  if (!/^[0-9]{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 묶음입니다.');
  return String(id);
};

function rowAudit(db: DatabaseService, action: string, businessId: string, data: Record<string, unknown>) {
  const c = RequestCtx.get();
  return db.query(
    `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent) VALUES ($1, $2, $3, 'BUSINESS', $4::uuid, $5::jsonb, $6, $7)`,
    [c?.actorId ?? null, c?.actorRole ?? null, action, businessId, JSON.stringify(data), c?.ip ?? null, c?.userAgent ?? null]).catch(() => undefined);
}

/** 미리보기 — 묶음 · 줄을 만들고 결과를 돌려줌(아직 아무에게도 초대가 가지 않음) */
export async function pbulkPreview(db: DatabaseService, d: { partnerId: string; csv: string; fileName?: string }, actor: string | null) {
  if (!/^[0-9a-f-]{36}$/i.test(String(d.partnerId ?? ''))) throw new PolicyViolation('PBULK_PARTNER', '파트너를 고르십시오.');
  const s = await pbulkSettings(db);
  const rows = parseInviteCsv(d.csv, s.maxRows);
  const [p] = await db.query<{ businessId: string; ownerId: string; status: string; company: string }>(
    `SELECT p.business_id AS "businessId", b.account_id AS "ownerId", p.status, b.company_name AS company
       FROM partners p JOIN businesses b ON b.id = p.business_id WHERE p.id = $1`, [d.partnerId]);
  if (!p) throw new NotFound('없는 파트너입니다.');
  if (p.status !== 'ACTIVE') throw new StateConflict('PBULK_PARTNER_INACTIVE', '활동 중(ACTIVE)인 파트너에만 직원을 등록합니다.');
  const emails = [...new Set(rows.map((r) => r.email).filter((x): x is string => !!x))];
  const accts = emails.length ? await db.query<{ id: string; email: string; mine: boolean; other: boolean }>(
    `SELECT a.id, lower(a.email::text) AS email,
            EXISTS (SELECT 1 FROM business_members m WHERE m.account_id = a.id AND m.business_id = $2 AND m.removed_at IS NULL) AS mine,
            EXISTS (SELECT 1 FROM business_members m WHERE m.account_id = a.id AND m.business_id <> $2 AND m.removed_at IS NULL) AS other
       FROM accounts a WHERE lower(a.email::text) = ANY($1::text[]) AND a.withdrawn_at IS NULL`, [emails, p.businessId]) : [];
  const byMail = new Map(accts.map((a) => [a.email, a]));
  const seen = new Set<string>();
  const out = rows.map((r) => {
    let result: string;
    let accountId: string | null = null;
    if (!r.email) result = 'INVALID';
    else if (seen.has(r.email)) result = 'DUPLICATE';
    else {
      seen.add(r.email);
      const a = byMail.get(r.email);
      if (!a) result = 'PENDING';
      else if (a.id === p.ownerId) result = 'SELF';
      else if (a.mine) result = 'ALREADY';
      else if (a.other) result = 'OTHER_BUSINESS';
      else { result = 'MEMBER'; accountId = a.id; }
    }
    return { ...r, result, accountId };
  });
  const cnt = (k: string) => out.filter((x) => x.result === k).length;
  return db.transaction(async () => {
    const [b] = await db.query<{ id: string }>(
      `INSERT INTO ptn_bulk_invites (partner_id, business_id, file_name, total, n_member, n_pending, n_bad, created_by)
       VALUES ($1, $2, $3, $4::int, $5::int, $6::int, $7::int, $8) RETURNING id::text AS id`,
      [d.partnerId, p.businessId, d.fileName ? String(d.fileName).slice(0, 120) : null, out.length, cnt('MEMBER'), cnt('PENDING'), out.length - cnt('MEMBER') - cnt('PENDING'), actor]);
    for (const r of out) {
      await db.query(
        `INSERT INTO ptn_bulk_invite_rows (batch_id, line_no, email_hash, email_masked, email, can_settle, result, account_id)
         VALUES ($1::bigint, $2::int, $3, $4, $5, $6, $7, $8::uuid)`,
        [b.id, r.line, r.email ? emailHash(r.email) : null, r.email ? maskMail(r.email) : (r.raw ? '(모양 아님)' : '(빈칸)'),
         r.result === 'PENDING' ? r.email : null, r.canSettle, r.result, r.accountId]);
    }
    await rowAudit(db, 'PBULK_PREVIEW', p.businessId, { batch: b.id, partnerId: d.partnerId, total: out.length, member: cnt('MEMBER'), pending: cnt('PENDING') });
    return {
      ok: true, id: b.id, company: p.company, total: out.length,
      counts: { MEMBER: cnt('MEMBER'), PENDING: cnt('PENDING'), DUPLICATE: cnt('DUPLICATE'), INVALID: cnt('INVALID'), ALREADY: cnt('ALREADY'), OTHER_BUSINESS: cnt('OTHER_BUSINESS'), SELF: cnt('SELF') },
      rows: out.map((r) => ({ line: r.line, email: r.email ? maskMail(r.email) : null, result: r.result, canSettle: r.canSettle })),
      note: '미리보기입니다 — 아직 아무에게도 초대가 가지 않았습니다. 확인한 뒤 「확정」을 누르십시오(하루 안 · 지나면 저절로 취소).',
    };
  });
}

export async function pbulkList(db: DatabaseService) {
  const settings = await pbulkSettings(db);
  const items = await db.query(
    `SELECT i.id::text AS id, i.partner_id AS "partnerId", b.company_name AS company, i.file_name AS "fileName", i.state, i.total,
            i.n_member AS "nMember", i.n_pending AS "nPending", i.n_bad AS "nBad", i.created_at AS "createdAt", i.confirmed_at AS "confirmedAt",
            (SELECT count(*)::int FROM ptn_bulk_invite_rows r WHERE r.batch_id = i.id AND r.state = 'PENDING') AS waiting,
            (SELECT count(*)::int FROM ptn_bulk_invite_rows r WHERE r.batch_id = i.id AND r.state = 'MATCHED') AS matched
       FROM ptn_bulk_invites i JOIN businesses b ON b.id = i.business_id ORDER BY i.id DESC LIMIT 100`);
  const partners = await db.query(
    `SELECT p.id, b.company_name AS company FROM partners p JOIN businesses b ON b.id = p.business_id WHERE p.status = 'ACTIVE' ORDER BY b.company_name LIMIT 500`);
  return { settings, items, partners, canConfirm: true, columns: ['email', 'can_settle'] };
}

export async function pbulkDetail(db: DatabaseService, id: string) {
  const bid = batchIdOf(id);
  const [b] = await db.query(
    `SELECT i.id::text AS id, b.company_name AS company, i.file_name AS "fileName", i.state, i.total, i.n_member AS "nMember", i.n_pending AS "nPending",
            i.n_bad AS "nBad", i.created_at AS "createdAt", i.confirmed_at AS "confirmedAt", i.canceled_at AS "canceledAt"
       FROM ptn_bulk_invites i JOIN businesses b ON b.id = i.business_id WHERE i.id = $1::bigint`, [bid]);
  if (!b) throw new NotFound('없는 묶음입니다.');
  const rows = await db.query(
    `SELECT line_no AS line, email_masked AS email, can_settle AS "canSettle", result, state, mail_state AS "mailState", expires_at AS "expiresAt", done_at AS "doneAt"
       FROM ptn_bulk_invite_rows WHERE batch_id = $1::bigint ORDER BY line_no`, [bid]);
  return { batch: b, rows };
}

/** 확정 — MEMBER 는 초대 줄 · PENDING 은 가입 대기 · 나머지는 건너뜀 · 줄마다 감사 */
export async function pbulkConfirm(db: DatabaseService, id: string, confirm: string, actor: string | null) {
  const bid = batchIdOf(id);
  if (String(confirm ?? '').trim() !== '등록') throw new PolicyViolation('PBULK_CONFIRM', '확인 글자 「등록」을 넣으십시오.');
  const s = await pbulkSettings(db);
  return db.transaction(async () => {
    const [b] = await db.query<{ state: string; businessId: string; partnerId: string }>(
      `SELECT state, business_id AS "businessId", partner_id AS "partnerId" FROM ptn_bulk_invites WHERE id = $1::bigint FOR UPDATE`, [bid]);
    if (!b) throw new NotFound('없는 묶음입니다.');
    if (b.state !== 'PREVIEW') throw new StateConflict('PBULK_STATE', '미리보기 상태의 묶음만 확정합니다.');
    const [p] = await db.query<{ status: string }>(`SELECT status FROM partners WHERE id = $1`, [b.partnerId]);
    if (p?.status !== 'ACTIVE') throw new StateConflict('PBULK_PARTNER_INACTIVE', '활동 중(ACTIVE)인 파트너에만 직원을 등록합니다.');
    const rows = await db.query<{ id: string; line: number; result: string; accountId: string | null; canSettle: boolean; masked: string | null }>(
      `SELECT id::text AS id, line_no AS line, result, account_id AS "accountId", can_settle AS "canSettle", email_masked AS masked
         FROM ptn_bulk_invite_rows WHERE batch_id = $1::bigint AND state = 'PREVIEW' ORDER BY line_no`, [bid]);
    const mailState = s.inviteMail ? 'QUEUED' : 'OFF';
    let invited = 0, pending = 0, skipped = 0;
    for (const r of rows) {
      if (r.result === 'MEMBER' && r.accountId) {
        /* 기존 직원 초대(inviteStaff)와 같은 줄 — 그 사이 다른 사업자에 들어갔으면 건너뜀 */
        const [other] = await db.query(
          `SELECT 1 FROM business_members WHERE account_id = $1 AND business_id <> $2 AND removed_at IS NULL`, [r.accountId, b.businessId]);
        if (other) {
          await db.query(`UPDATE ptn_bulk_invite_rows SET state = 'SKIPPED', done_at = now() WHERE id = $1::bigint`, [r.id]);
          skipped++;
          await rowAudit(db, 'PBULK_ROW', b.businessId, { batch: bid, line: r.line, result: r.result, state: 'SKIPPED', email: r.masked });
          continue;
        }
        await db.query(
          `INSERT INTO business_members (business_id, account_id, member_role, can_settle, invited_by)
           VALUES ($1, $2, 'STAFF', $3, $4)
           ON CONFLICT (business_id, account_id) DO UPDATE SET can_settle = EXCLUDED.can_settle, invited_by = EXCLUDED.invited_by,
                  invited_at = now(), joined_at = NULL, removed_at = NULL
            WHERE business_members.member_role = 'STAFF'`, [b.businessId, r.accountId, r.canSettle, actor]);
        await db.query(`UPDATE ptn_bulk_invite_rows SET state = 'INVITED', mail_state = $2, done_at = now() WHERE id = $1::bigint`, [r.id, mailState]);
        invited++;
        await rowAudit(db, 'PBULK_ROW', b.businessId, { batch: bid, line: r.line, result: r.result, state: 'INVITED', accountId: r.accountId, canSettle: r.canSettle, email: r.masked });
      } else if (r.result === 'PENDING') {
        await db.query(
          `UPDATE ptn_bulk_invite_rows SET state = 'PENDING', mail_state = $2, expires_at = now() + make_interval(days => $3::int) WHERE id = $1::bigint`,
          [r.id, mailState, s.pendingDays]);
        pending++;
        await rowAudit(db, 'PBULK_ROW', b.businessId, { batch: bid, line: r.line, result: r.result, state: 'PENDING', canSettle: r.canSettle, email: r.masked, days: s.pendingDays });
      } else {
        await db.query(`UPDATE ptn_bulk_invite_rows SET state = 'SKIPPED', done_at = now() WHERE id = $1::bigint`, [r.id]);
        skipped++;
        await rowAudit(db, 'PBULK_ROW', b.businessId, { batch: bid, line: r.line, result: r.result, state: 'SKIPPED', email: r.masked });
      }
    }
    await db.query(`UPDATE ptn_bulk_invites SET state = 'CONFIRMED', confirmed_by = $2, confirmed_at = now() WHERE id = $1::bigint`, [bid, actor]);
    return {
      ok: true, id: bid, invited, pending, skipped, mail: mailState,
      note: s.inviteMail ? '확정했습니다 — 초대 메일은 15분 안에 나갑니다(메일 준비됨일 때).' : '확정했습니다 — 초대 메일은 꺼져 있습니다(처음). 회원에게 「파트너센터 › 회사 · 계정」에서 받아들이라고 알려 주십시오.',
    };
  });
}

export async function pbulkCancel(db: DatabaseService, id: string, reason: string) {
  const bid = batchIdOf(id);
  const why = reasonOk(reason);
  return db.transaction(async () => {
    const rows = await db.query<{ businessId: string }>(
      `UPDATE ptn_bulk_invites SET state = 'CANCELED', canceled_at = now() WHERE id = $1::bigint AND state = 'PREVIEW' RETURNING business_id AS "businessId"`, [bid]);
    if (!rows.length) throw new StateConflict('PBULK_STATE', '미리보기 상태의 묶음만 취소합니다.');
    await db.query(`UPDATE ptn_bulk_invite_rows SET state = 'CANCELED', email = NULL, done_at = now() WHERE batch_id = $1::bigint AND state = 'PREVIEW'`, [bid]);
    await rowAudit(db, 'PBULK_CANCEL', rows[0].businessId, { batch: bid, reason: why });
    return { ok: true, id: bid, note: '묶음을 취소했습니다 — 원문 이메일을 지웠습니다.' };
  });
}

export async function setPbulkSettings(db: DatabaseService, d: { inviteMail?: boolean; maxRows?: number; pendingDays?: number; reason: string }) {
  const reason = reasonOk(d.reason);
  const set: Array<[string, string]> = [];
  if (d.inviteMail !== undefined) set.push(['pbulk.invite_mail', d.inviteMail ? 'on' : 'off']);
  if (d.maxRows !== undefined) {
    if (!Number.isInteger(d.maxRows) || d.maxRows < 10 || d.maxRows > 1000) throw new PolicyViolation('PBULK_MAX', '한 번에 받는 줄 수는 10 ~ 1,000 입니다.');
    set.push(['pbulk.max_rows', String(d.maxRows)]);
  }
  if (d.pendingDays !== undefined) {
    if (!Number.isInteger(d.pendingDays) || d.pendingDays < 7 || d.pendingDays > 90) throw new PolicyViolation('PBULK_DAYS', '가입 대기 기한은 7 ~ 90일입니다.');
    set.push(['pbulk.pending_days', String(d.pendingDays)]);
  }
  if (!set.length) throw new PolicyViolation('PBULK_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, settings: await pbulkSettings(db), note: '일괄 등록 설정을 바꿨습니다.' };
}

export interface PbulkMatchResult { matched: number; expired: number; canceled: number; mailed: number; mailFailed: number; mailOn: boolean }

/** 15분마다 — 가입 대기 짝 맞춤 · 기한 지남 · 하루 지난 미리보기 취소 · 초대 메일(켜져 있을 때) */
export async function pbulkMatchJob(db: DatabaseService, mail: MailService): Promise<PbulkMatchResult> {
  const s = await pbulkSettings(db);
  const out: PbulkMatchResult = { matched: 0, expired: 0, canceled: 0, mailed: 0, mailFailed: 0, mailOn: s.inviteMail };
  /* ① 짝 맞춤 — 같은 이메일로 가입한(탈퇴 안 한) 회원 · 다른 사업자 소속이 아니면 초대 줄 */
  const cand = await db.query<{ id: string; batchId: string; line: number; businessId: string; ownerId: string; accountId: string; canSettle: boolean; masked: string | null; other: boolean }>(
    `SELECT r.id::text AS id, r.batch_id::text AS "batchId", r.line_no AS line, i.business_id AS "businessId", b.account_id AS "ownerId", a.id AS "accountId",
            r.can_settle AS "canSettle", r.email_masked AS masked,
            EXISTS (SELECT 1 FROM business_members m WHERE m.account_id = a.id AND m.business_id <> i.business_id AND m.removed_at IS NULL) AS other
       FROM ptn_bulk_invite_rows r JOIN ptn_bulk_invites i ON i.id = r.batch_id JOIN businesses b ON b.id = i.business_id
       JOIN accounts a ON lower(a.email::text) = r.email AND a.withdrawn_at IS NULL
      WHERE r.state = 'PENDING' AND r.expires_at > now() AND r.email IS NOT NULL
      ORDER BY r.id LIMIT 200`);
  for (const c of cand) {
    if (c.other || c.accountId === c.ownerId) {
      await db.query(`UPDATE ptn_bulk_invite_rows SET state = 'SKIPPED', email = NULL, done_at = now() WHERE id = $1::bigint AND state = 'PENDING'`, [c.id]);
      await rowAudit(db, 'PBULK_MATCH', c.businessId, { batch: c.batchId, line: c.line, state: 'SKIPPED', why: c.other ? 'OTHER_BUSINESS' : 'SELF', email: c.masked });
      continue;
    }
    await db.transaction(async () => {
      await db.query(
        `INSERT INTO business_members (business_id, account_id, member_role, can_settle, invited_by)
         VALUES ($1, $2, 'STAFF', $3, NULL)
         ON CONFLICT (business_id, account_id) DO UPDATE SET can_settle = EXCLUDED.can_settle, invited_at = now(), joined_at = NULL, removed_at = NULL
          WHERE business_members.member_role = 'STAFF' AND business_members.removed_at IS NOT NULL`, [c.businessId, c.accountId, c.canSettle]);
      await db.query(`UPDATE ptn_bulk_invite_rows SET state = 'MATCHED', account_id = $2, email = NULL, done_at = now() WHERE id = $1::bigint AND state = 'PENDING'`, [c.id, c.accountId]);
    });
    out.matched++;
    await rowAudit(db, 'PBULK_MATCH', c.businessId, { batch: c.batchId, line: c.line, state: 'MATCHED', accountId: c.accountId, email: c.masked });
  }
  /* ② 기한 지남 · 하루 지난 미리보기 — 원문 이메일 지움 */
  const [ex] = await db.query<{ n: number }>(
    `WITH x AS (UPDATE ptn_bulk_invite_rows SET state = 'EXPIRED', email = NULL, done_at = now() WHERE state = 'PENDING' AND expires_at <= now() RETURNING 1)
     SELECT count(*)::int AS n FROM x`);
  out.expired = ex?.n ?? 0;
  const old = await db.query<{ id: string }>(
    `UPDATE ptn_bulk_invites SET state = 'CANCELED', canceled_at = now() WHERE state = 'PREVIEW' AND created_at < now() - interval '1 day' RETURNING id::text AS id`);
  for (const o of old) await db.query(`UPDATE ptn_bulk_invite_rows SET state = 'CANCELED', email = NULL, done_at = now() WHERE batch_id = $1::bigint AND state = 'PREVIEW'`, [o.id]);
  out.canceled = old.length;
  /* ③ 초대 메일 — 켜져 있고 메일 준비됨일 때만 · 한 번에 50통 */
  if (s.inviteMail) {
    const st = await mail.status().catch(() => ({ ready: false }));
    if (st.ready) {
      const due = await db.query<{ id: string; to: string | null; company: string; pending: boolean }>(
        `SELECT r.id::text AS id, coalesce(r.email, a.email::text) AS to, b.company_name AS company, (r.state = 'PENDING') AS pending
           FROM ptn_bulk_invite_rows r JOIN ptn_bulk_invites i ON i.id = r.batch_id JOIN businesses b ON b.id = i.business_id
           LEFT JOIN accounts a ON a.id = r.account_id
          WHERE r.mail_state = 'QUEUED' AND r.state IN ('INVITED', 'PENDING') ORDER BY r.id LIMIT 50`);
      for (const m of due) {
        if (!m.to) { await db.query(`UPDATE ptn_bulk_invite_rows SET mail_state = 'FAILED' WHERE id = $1::bigint`, [m.id]); out.mailFailed++; continue; }
        const text = m.pending
          ? `${m.company} 에서 소개뱅크 파트너센터 직원으로 초대했습니다.\n\n이 이메일로 소개뱅크에 가입하시면 초대가 「파트너센터 › 회사 · 계정」에 들어옵니다. 받아들이시면 합류합니다.\n가입하지 않으시면 기한이 지나 이 이메일은 지워집니다.\n\n(주)한국바이오헬스케어 소개뱅크 사업부`
          : `${m.company} 에서 소개뱅크 파트너센터 직원으로 초대했습니다.\n\n로그인한 뒤 「파트너센터 › 회사 · 계정」에서 받아들이시면 합류합니다.\n\n(주)한국바이오헬스케어 소개뱅크 사업부`;
        const r = await mail.send({ to: m.to, subject: `[소개뱅크] ${m.company} 파트너센터 직원 초대`, text });
        await db.query(`UPDATE ptn_bulk_invite_rows SET mail_state = $2, mailed_at = CASE WHEN $2 = 'SENT' THEN now() END WHERE id = $1::bigint`, [m.id, r.ok ? 'SENT' : 'FAILED']);
        if (r.ok) out.mailed++; else out.mailFailed++;
      }
    }
  }
  return out;
}
