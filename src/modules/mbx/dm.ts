import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { publicAuthor } from '../community/community.service';
import { mbxSettings, txt, UUID_RE } from './common';

/* ---------------------------------------------------------------------
 * v10.504 (D273 · docs/642) 회원 간 1:1 대화 — 대표 11/20 「㊸ ④」
 *
 *   누구끼리: **이미 있는 거래 · 문의의 당사자끼리만** — 거래(deals)의 사는 쪽 · 파는 쪽 · 소개자 중 두 사람 / 문의 대화(conversations)의 문의한 사람 · 등록자
 *             (1:1 문의 화면 SB-HOM-MCH-010 은 매물마다 그대로 · 이 대화함은 소개자도 함께 쓰는 「회원 대화」 — 계약 · 대금 이야기를 플랫폼 안에 남기려고)
 *   열기: 화면은 거래 · 문의 번호와 상대 쪽(BUYER · SELLER · INTRODUCER · INITIATOR · COUNTERPART)만 보냄 — 상대 계정 번호를 화면에 내리지 않음
 *   글만(v1 은 파일 없음) · 1 ~ 1,000자 · 보내는 수 제한(분당 mbx.dm_rate_per_min 10 · 하루 mbx.dm_rate_per_day 300)
 *   연락처 · 계좌 · 메일 글자 감지(INV-9 · INV-11 정신 — 소개비를 빼고 대금을 직접 주고받자는 유도를 막음):
 *     mbx.dm_pattern_mode  WARN  = 경고 → 「그래도 보내기」면 그대로
 *                          MASK  = 경고 → 「그래도 보내기」면 그 글자를 가려서(처음 값)
 *                          BLOCK = 보내지 않음
 *     「플랫폼 밖 거래」 표현(직거래 · 카톡 · 계좌로 …)은 경고만(가리지 않음) · 감지한 종류는 메시지 줄에 남김(hit_codes — 운영은 수만 봄)
 *   신고: 대화 당사자가 사유와 함께 → 운영 알림(MBX_DM_REPORT · 글은 싣지 않음)
 *   운영자 열람: **신고가 있는 대화만** · 열 때마다 사유(2 ~ 200자) — mbx_dm_admin_views(쌓기만) + 개인정보 접속기록(audit.pii_access_logs)
 *   보관: 글마다 보낸 날부터 mbx.dm_retention_days(처음 365일) 지나면 매일 04:35 지움 · 처리 중 신고가 있으면 남김 · 처리 끝난 신고는 mbx.dm_report_keep_days(180일) 뒤
 *   스위치 mbx.dm(처음 off) — 꺼지면 새로 열기 · 보내기 막음(목록 · 읽기 · 신고는 됨)
 * ------------------------------------------------------------------- */

export const DM_SIDES = ['BUYER', 'SELLER', 'INTRODUCER', 'INITIATOR', 'COUNTERPART'] as const;
export const DM_BASIS = ['DEAL', 'INQUIRY'] as const;
export const DM_REPORT_REASONS = ['OFF_PLATFORM', 'FRAUD', 'ABUSE', 'SPAM', 'PRIVACY', 'OTHER'] as const;
export const DM_REPORT_KO: Record<string, string> = {
  OFF_PLATFORM: '플랫폼 밖 거래 · 직접 입금 유도', FRAUD: '사기 의심', ABUSE: '욕설 · 괴롭힘', SPAM: '광고 · 도배', PRIVACY: '개인정보 요구', OTHER: '그 밖',
};
export const DM_HIT_KO: Record<string, string> = { PHONE: '전화번호', EMAIL: '메일 주소', ACCOUNT: '계좌번호로 보이는 숫자', OFF_PLATFORM: '플랫폼 밖 거래 표현' };

/* 플랫폼 밖 거래를 꾀는 표현 — 1:1 문의 「보내기 전 확인」(conversation-summary.controller.ts)과 같은 뜻의 짧은 목록 */
const OFF_WORDS = ['수수료 없이', '수수료없이', '직접 입금', '직접입금', '직거래', '따로 연락', '개인적으로 연락', '카톡', '카카오톡', '오픈채팅',
  '텔레그램', '라인 아이디', '문자 주세요', '전화 주세요', '현금으로', '계좌로 바로', '계좌로 보내', '플랫폼 밖', '사이트 밖', '소개비 빼고', '소개비 없이'];
const PHONE_RES = [/01[016-9][-. ]?\d{3,4}[-. ]?\d{4}/g, /(?<!\d)0\d{1,2}[-. )]\d{3,4}[-. ]?\d{4}(?!\d)/g];
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const ACCOUNT_RES = [/(?<!\d)\d{2,6}-\d{2,6}-\d{2,8}(?!\d)/g, /(?<!\d)\d{10,14}(?!\d)/g,
  /(국민|신한|우리|하나|농협|기업|카카오뱅크|케이뱅크|토스뱅크|새마을|우체국|수협|신협|씨티|SC제일|부산|대구|경남|광주|전북|제주)\s*(은행)?\s*[:：]?\s*\d[\d -]{7,}/g];

export interface DmHits { codes: string[]; samples: Record<string, string[]>; masked: string }

/** 글 안의 연락처 · 계좌 · 메일 · 플랫폼 밖 표현 찾기 + 가린 글 */
export function detectDm(body: string): DmHits {
  const text = String(body ?? '');
  const samples: Record<string, string[]> = {};
  let masked = text;
  const take = (code: string, re: RegExp, filter?: (x: string) => boolean) => {
    const found = (text.match(re) ?? []).filter((x) => (filter ? filter(x) : true));
    if (!found.length) return;
    samples[code] = [...new Set([...(samples[code] ?? []), ...found.map((x) => x.trim())])].slice(0, 3);
    for (const f of found) masked = masked.split(f).join('*'.repeat(Math.min(f.length, 12)));
  };
  for (const re of PHONE_RES) take('PHONE', re);
  take('EMAIL', EMAIL_RE);
  /* 계좌: 숫자 10자리 이상 · 휴대폰(01x) · 날짜(2026-11-20) 꼴은 빼기 */
  const acctLike = (x: string) => { const d = x.replace(/\D/g, ''); return d.length >= 10 && !/^01[016-9]/.test(d) && !/^(19|20)\d{2}-\d{1,2}-\d{1,2}$/.test(x.trim()); };
  for (const re of ACCOUNT_RES) take('ACCOUNT', re, acctLike);
  const off = OFF_WORDS.filter((w) => text.includes(w));
  if (off.length) samples.OFF_PLATFORM = off.slice(0, 5);
  return { codes: Object.keys(samples), samples, masked };
}

const me = () => RequestCtx.actorId()!;
const name = (n: string | null | undefined) => publicAuthor(n);

interface Thread { id: string; basis_type: string; basis_id: string; a_id: string; b_id: string; status: string; blocked_by: string | null; locked_reason: string | null }

async function threadOf(db: DatabaseService, id: string, actor: string): Promise<Thread> {
  if (!UUID_RE.test(String(id ?? ''))) throw new NotFound('대화를 찾을 수 없습니다.');
  const [t] = await db.query<Thread>(
    `SELECT id::text AS id, basis_type, basis_id::text AS basis_id, a_id::text AS a_id, b_id::text AS b_id, status, blocked_by::text AS blocked_by, locked_reason
       FROM mbx_dm_threads WHERE id = $1::uuid`, [id]);
  if (!t) throw new NotFound('대화를 찾을 수 없습니다.');
  if (actor !== t.a_id && actor !== t.b_id) throw new Forbidden('NOT_PARTICIPANT', '이 대화의 참여자가 아닙니다.');
  return t;
}

/** 거래 · 문의의 당사자 — side → 계정 · 제목 */
async function basisParties(db: DatabaseService, basisType: string, basisId: string) {
  if (!UUID_RE.test(basisId)) throw new NotFound('거래 · 문의를 찾을 수 없습니다.');
  if (basisType === 'DEAL') {
    const [d] = await db.query<{ buyer: string; seller: string; intro: string | null; title: string | null }>(
      `SELECT d.buyer_account_id::text AS buyer, d.seller_account_id::text AS seller, d.introducer_account_id::text AS intro, coalesce(l.title, r.title) AS title
         FROM deals d LEFT JOIN listings l ON l.id = d.listing_id LEFT JOIN requests r ON r.id = d.request_id WHERE d.id = $1::uuid`, [basisId]);
    if (!d) throw new NotFound('거래 · 문의를 찾을 수 없습니다.');
    return { title: d.title, sides: { BUYER: d.buyer, SELLER: d.seller, INTRODUCER: d.intro } as Record<string, string | null> };
  }
  if (basisType === 'INQUIRY') {
    const [c] = await db.query<{ ini: string; cp: string; title: string | null }>(
      `SELECT c.initiator_id::text AS ini, c.counterpart_id::text AS cp, coalesce(l.title, r.title) AS title
         FROM conversations c LEFT JOIN listings l ON c.target_type = 'LISTING' AND l.id = c.target_id
         LEFT JOIN requests r ON c.target_type = 'REQUEST' AND r.id = c.target_id WHERE c.id = $1::uuid`, [basisId]);
    if (!c) throw new NotFound('거래 · 문의를 찾을 수 없습니다.');
    return { title: c.title, sides: { INITIATOR: c.ini, COUNTERPART: c.cp } as Record<string, string | null> };
  }
  throw new PolicyViolation('MBX_DM_BASIS', '대화 근거는 DEAL · INQUIRY 중 하나입니다.');
}

/** GET /me/dm/partners — 대화를 열 수 있는 상대(내 거래 · 문의의 다른 당사자 · 최근 50) */
export async function dmPartners(db: DatabaseService) {
  const actor = me();
  const deals = await db.query<{ id: string; title: string | null; buyer: string; seller: string; intro: string | null; bn: string | null; sn: string | null; inn: string | null; at: string }>(
    `SELECT d.id::text AS id, coalesce(l.title, r.title) AS title, d.buyer_account_id::text AS buyer, d.seller_account_id::text AS seller,
            d.introducer_account_id::text AS intro, ab.name AS bn, aseller.name AS sn, ai.name AS inn, d.created_at AS at
       FROM deals d LEFT JOIN listings l ON l.id = d.listing_id LEFT JOIN requests r ON r.id = d.request_id
       JOIN accounts ab ON ab.id = d.buyer_account_id JOIN accounts aseller ON aseller.id = d.seller_account_id
       LEFT JOIN accounts ai ON ai.id = d.introducer_account_id
      WHERE $1::uuid IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)
      ORDER BY d.created_at DESC LIMIT 50`, [actor]);
  const convs = await db.query<{ id: string; title: string | null; ini: string; cp: string; inin: string | null; cpn: string | null; at: string }>(
    `SELECT c.id::text AS id, coalesce(l.title, r.title) AS title, c.initiator_id::text AS ini, c.counterpart_id::text AS cp,
            ai.name AS inin, ac.name AS cpn, coalesce(c.last_message_at, c.created_at) AS at
       FROM conversations c JOIN accounts ai ON ai.id = c.initiator_id JOIN accounts ac ON ac.id = c.counterpart_id
       LEFT JOIN listings l ON c.target_type = 'LISTING' AND l.id = c.target_id
       LEFT JOIN requests r ON c.target_type = 'REQUEST' AND r.id = c.target_id
      WHERE $1::uuid IN (c.initiator_id, c.counterpart_id)
      ORDER BY coalesce(c.last_message_at, c.created_at) DESC LIMIT 50`, [actor]);
  const open = await db.query<{ id: string; basis_type: string; basis_id: string; a_id: string; b_id: string }>(
    `SELECT id::text AS id, basis_type, basis_id::text AS basis_id, a_id::text AS a_id, b_id::text AS b_id FROM mbx_dm_threads WHERE $1::uuid IN (a_id, b_id)`, [actor]);
  const threadOfPair = (bt: string, bid: string, other: string) =>
    open.find((t) => t.basis_type === bt && t.basis_id === bid && [t.a_id, t.b_id].includes(other) && [t.a_id, t.b_id].includes(actor))?.id ?? null;
  const items: Array<Record<string, unknown>> = [];
  for (const d of deals) {
    const sides: Array<[string, string | null, string | null]> = [['BUYER', d.buyer, d.bn], ['SELLER', d.seller, d.sn], ['INTRODUCER', d.intro, d.inn]];
    for (const [side, acc, nm] of sides) {
      if (!acc || acc === actor) continue;
      items.push({ basisType: 'DEAL', basisId: d.id, side, title: d.title, otherName: name(nm), at: d.at, threadId: threadOfPair('DEAL', d.id, acc) });
    }
  }
  for (const c of convs) {
    const other = c.ini === actor ? c.cp : c.ini;
    items.push({ basisType: 'INQUIRY', basisId: c.id, side: c.ini === actor ? 'COUNTERPART' : 'INITIATOR', title: c.title,
      otherName: name(c.ini === actor ? c.cpn : c.inin), at: c.at, threadId: threadOfPair('INQUIRY', c.id, other) });
  }
  return { items };
}

/** POST /me/dm — 대화 열기(이미 있으면 그 대화) */
export async function openDm(db: DatabaseService, d: { basisType: string; basisId: string; side: string }) {
  const actor = me();
  const s = await mbxSettings(db);
  if (!s.dm) throw new PolicyViolation('MBX_OFF', '지금은 회원 대화를 쓰지 않는 중입니다.');
  const b = await basisParties(db, d.basisType, d.basisId);
  if (!Object.values(b.sides).includes(actor)) throw new Forbidden('NOT_PARTICIPANT', '내 거래 · 문의가 아닙니다.');
  const other = b.sides[d.side] ?? null;
  if (!other) throw new PolicyViolation('MBX_DM_SIDE', '그 거래에는 그쪽 당사자가 없습니다.');
  if (other === actor) throw new PolicyViolation('MBX_DM_SELF', '나와는 대화를 열 수 없습니다.');
  const [o] = await db.query<{ status: string }>(`SELECT status FROM accounts WHERE id = $1::uuid`, [other]);
  if (!o || o.status !== 'ACTIVE') throw new StateConflict('MBX_DM_GONE', '상대가 지금 대화를 받을 수 없는 상태입니다.');
  const [a, bb] = actor < other ? [actor, other] : [other, actor];
  const ins = await db.query<{ id: string }>(
    `INSERT INTO mbx_dm_threads (basis_type, basis_id, a_id, b_id, created_by) VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid)
     ON CONFLICT (basis_type, basis_id, a_id, b_id) DO NOTHING RETURNING id::text AS id`, [d.basisType, d.basisId, a, bb, actor]);
  if (ins.length) return { id: ins[0]!.id, created: true };
  const [t] = await db.query<{ id: string }>(
    `SELECT id::text AS id FROM mbx_dm_threads WHERE basis_type = $1 AND basis_id = $2::uuid AND a_id = $3::uuid AND b_id = $4::uuid`, [d.basisType, d.basisId, a, bb]);
  return { id: t!.id, created: false };
}

/** GET /me/dm — 내 대화 목록(상대 이름은 김OO · 마지막 글 60자 · 안 읽은 수) */
export async function listDm(db: DatabaseService) {
  const actor = me();
  const s = await mbxSettings(db);
  const rows = await db.query<Record<string, unknown>>(
    `SELECT t.id, t.basis_type AS "basisType", t.status, (t.blocked_by = $1::uuid) AS "blockedByMe", (t.blocked_by IS NOT NULL) AS blocked,
            t.last_message_at AS "lastMessageAt", t.created_at AS "createdAt", o.name AS _other,
            CASE WHEN t.basis_type = 'DEAL' THEN (SELECT coalesce(l.title, r.title) FROM deals d LEFT JOIN listings l ON l.id = d.listing_id LEFT JOIN requests r ON r.id = d.request_id WHERE d.id = t.basis_id)
                 ELSE (SELECT coalesce(l.title, r.title) FROM conversations c LEFT JOIN listings l ON c.target_type = 'LISTING' AND l.id = c.target_id
                        LEFT JOIN requests r ON c.target_type = 'REQUEST' AND r.id = c.target_id WHERE c.id = t.basis_id) END AS title,
            (SELECT left(m.body, 60) FROM mbx_dm_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS preview,
            (SELECT count(*)::int FROM mbx_dm_messages m WHERE m.thread_id = t.id AND m.sender_id <> $1::uuid AND m.read_at IS NULL) AS unread
       FROM mbx_dm_threads t JOIN accounts o ON o.id = CASE WHEN t.a_id = $1::uuid THEN t.b_id ELSE t.a_id END
      WHERE $1::uuid IN (t.a_id, t.b_id)
      ORDER BY coalesce(t.last_message_at, t.created_at) DESC LIMIT 100`, [actor]);
  return {
    enabled: s.dm, patternMode: s.patternMode, retentionDays: s.retentionDays,
    items: rows.map(({ _other, ...r }) => ({ ...r, otherName: name(_other as string | null), unread: Number(r.unread ?? 0) })),
  };
}

/** GET /me/dm/{id} — 글(오래된 순 · 마지막 200) · 받은 글 읽음 표시 */
export async function dmDetail(db: DatabaseService, id: string) {
  const actor = me();
  const t = await threadOf(db, id, actor);
  const s = await mbxSettings(db);
  const b = await basisParties(db, t.basis_type, t.basis_id).catch(() => ({ title: null as string | null, sides: {} as Record<string, string | null> }));
  const other = t.a_id === actor ? t.b_id : t.a_id;
  const [o] = await db.query<{ name: string | null }>(`SELECT name FROM accounts WHERE id = $1::uuid`, [other]);
  const msgs = await db.query<Record<string, unknown>>(
    `SELECT * FROM (SELECT m.id::text AS id, m.body, m.masked, m.hit_codes AS "hitCodes", m.read_at AS "readAt", m.created_at AS "createdAt", (m.sender_id = $2::uuid) AS mine
                      FROM mbx_dm_messages m WHERE m.thread_id = $1::uuid ORDER BY m.id DESC LIMIT 200) x ORDER BY x.id::bigint`, [t.id, actor]);
  await db.query(`UPDATE mbx_dm_messages SET read_at = now() WHERE thread_id = $1::uuid AND sender_id <> $2::uuid AND read_at IS NULL`, [t.id, actor]);
  const [rep] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM mbx_dm_reports WHERE thread_id = $1::uuid AND reporter_id = $2::uuid AND state = 'OPEN'`, [t.id, actor]);
  const mySide = Object.entries(b.sides).find(([, v]) => v === actor)?.[0] ?? null;
  return {
    id: t.id, basisType: t.basis_type, title: b.title, mySide, otherName: name(o?.name), status: t.status, lockedReason: t.locked_reason,
    blocked: !!t.blocked_by, blockedByMe: t.blocked_by === actor, reportedByMe: (rep?.n ?? 0) > 0,
    enabled: s.dm, patternMode: s.patternMode, retentionDays: s.retentionDays, messages: msgs,
  };
}

/** POST /me/dm/check — 보내기 전 확인(저장하지 않음) */
export async function dmCheck(db: DatabaseService, body: string) {
  const s = await mbxSettings(db);
  const h = detectDm(body);
  return { warn: h.codes.length > 0, mode: s.patternMode, reasons: h.codes.map((c) => ({ code: c, label: DM_HIT_KO[c] ?? c, hits: h.samples[c] ?? [] })),
    preview: s.patternMode === 'MASK' ? h.masked : String(body ?? '') };
}

/** POST /me/dm/{id}/messages — 보내기 */
export async function dmSend(db: DatabaseService, id: string, d: { body: string; confirm?: boolean }) {
  const actor = me();
  const s = await mbxSettings(db);
  if (!s.dm) throw new PolicyViolation('MBX_OFF', '지금은 회원 대화를 쓰지 않는 중입니다.');
  const body = String(d.body ?? '').trim();
  if (body.length < 1 || body.length > 1000) throw new PolicyViolation('MBX_DM_LEN', '글은 1 ~ 1,000자입니다.');
  return db.transaction(async () => {
    const t = await threadOf(db, id, actor);
    await db.query(`SELECT id FROM mbx_dm_threads WHERE id = $1::uuid FOR UPDATE`, [t.id]);
    if (t.status === 'LOCKED') throw new StateConflict('MBX_DM_LOCKED', '운영 조치로 닫힌 대화입니다.');
    if (t.blocked_by) throw new StateConflict('MBX_DM_BLOCKED_BY', t.blocked_by === actor ? '차단을 풀어야 보낼 수 있습니다.' : '상대가 대화를 받지 않습니다.');
    const other = t.a_id === actor ? t.b_id : t.a_id;
    const [o] = await db.query<{ status: string }>(`SELECT status FROM accounts WHERE id = $1::uuid`, [other]);
    if (!o || o.status !== 'ACTIVE') throw new StateConflict('MBX_DM_GONE', '상대가 지금 대화를 받을 수 없는 상태입니다.');
    const [rate] = await db.query<{ m: number; d: number }>(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute')::int AS m,
              count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS d
         FROM mbx_dm_messages WHERE sender_id = $1::uuid AND created_at > now() - interval '1 day'`, [actor]);
    if ((rate?.m ?? 0) >= s.rateMin) throw new PolicyViolation('MBX_DM_RATE', `1분에 ${s.rateMin}개까지 보낼 수 있습니다. 잠시 뒤에 보내 주십시오.`);
    if ((rate?.d ?? 0) >= s.rateDay) throw new PolicyViolation('MBX_DM_RATE', `하루 ${s.rateDay}개까지 보낼 수 있습니다.`);
    const h = detectDm(body);
    const hard = h.codes.filter((c) => c !== 'OFF_PLATFORM');
    if (hard.length && s.patternMode === 'BLOCK') {
      throw new PolicyViolation('MBX_DM_BLOCKED', '연락처 · 계좌 · 메일 주소는 보낼 수 없습니다. 대금은 거래 화면의 절차로 진행해 주십시오.',
        { reasons: hard.map((c) => ({ code: c, label: DM_HIT_KO[c] ?? c })) });
    }
    if (h.codes.length && !d.confirm) {
      throw new PolicyViolation('MBX_DM_WARN', '연락처 · 계좌 · 플랫폼 밖 거래로 보이는 글이 있습니다. 플랫폼 밖에서 대금을 주고받으면 보호받기 어렵습니다.',
        { mode: s.patternMode, reasons: h.codes.map((c) => ({ code: c, label: DM_HIT_KO[c] ?? c, hits: h.samples[c] ?? [] })) });
    }
    const mask = s.patternMode === 'MASK' && hard.length > 0;
    const [row] = await db.query<Record<string, unknown>>(
      `INSERT INTO mbx_dm_messages (thread_id, sender_id, body, masked, hit_codes) VALUES ($1::uuid, $2::uuid, $3, $4::boolean, $5::text[])
       RETURNING id::text AS id, body, masked, hit_codes AS "hitCodes", created_at AS "createdAt"`,
      [t.id, actor, mask ? h.masked : body, mask, h.codes]);
    await db.query(`UPDATE mbx_dm_threads SET last_message_at = now() WHERE id = $1::uuid`, [t.id]);
    /* 새 글 알림 — 같은 대화의 안 읽은 알림이 30분 안에 있으면 또 보내지 않음(수신 설정은 fn_notify 가 봄) */
    const link = `/my/messages/${t.id}`;
    const [recent] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications WHERE account_id = $1::uuid AND event_code = 'MBX_DM_NEW' AND link_url = $2 AND read_at IS NULL AND created_at > now() - interval '30 minutes'`,
      [other, link]);
    if (!recent?.n) {
      const [mine] = await db.query<{ name: string | null }>(`SELECT name FROM accounts WHERE id = $1::uuid`, [actor]);
      await db.query(`SELECT fn_notify($1::uuid, 'MBX_DM_NEW', $2::jsonb, $3)`, [other, JSON.stringify({ from: name(mine?.name) }), link]);
    }
    return { ...row, mine: true };
  });
}

/** POST /me/dm/{id}/block — 차단 · 풀기(차단한 사람만 풂) */
export async function dmBlock(db: DatabaseService, id: string, on: boolean) {
  const actor = me();
  const t = await threadOf(db, id, actor);
  if (on) {
    if (t.blocked_by && t.blocked_by !== actor) throw new StateConflict('MBX_DM_BLOCKED_BY', '상대가 대화를 받지 않습니다.');
    await db.query(`UPDATE mbx_dm_threads SET blocked_by = $2::uuid WHERE id = $1::uuid`, [t.id, actor]);
    return { ok: true, blocked: true, note: '이 대화를 차단했습니다. 서로 보낼 수 없습니다.' };
  }
  if (t.blocked_by && t.blocked_by !== actor) throw new StateConflict('MBX_DM_BLOCKED_BY', '차단은 차단한 사람만 풀 수 있습니다.');
  await db.query(`UPDATE mbx_dm_threads SET blocked_by = NULL WHERE id = $1::uuid`, [t.id]);
  return { ok: true, blocked: false, note: '차단을 풀었습니다.' };
}

/** POST /me/dm/{id}/report — 신고(내가 연 신고가 처리 중이면 409) */
export async function dmReport(db: DatabaseService, id: string, d: { reason: string; detail?: string }) {
  const actor = me();
  const t = await threadOf(db, id, actor);
  if (!(DM_REPORT_REASONS as readonly string[]).includes(d.reason)) throw new PolicyViolation('MBX_DM_REASON', '신고 사유를 고르십시오.');
  const detail = txt(d.detail, 500) || null;
  if (d.reason === 'OTHER' && (detail ?? '').length < 2) throw new PolicyViolation('MBX_DM_REASON', '「그 밖」은 내용을 2자 이상 적어 주십시오.');
  return db.transaction(async () => {
    const ins = await db.query<{ id: string }>(
      `INSERT INTO mbx_dm_reports (thread_id, reporter_id, reason, detail) VALUES ($1::uuid, $2::uuid, $3, $4)
       ON CONFLICT DO NOTHING RETURNING id::text AS id`, [t.id, actor, d.reason, detail]);
    if (!ins.length) throw new StateConflict('MBX_DM_REPORTED', '이미 신고한 대화입니다. 처리 결과를 기다려 주십시오.');
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       VALUES ('MBX_DM_REPORT', 'WARN', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
      [`회원 대화 신고 — ${DM_REPORT_KO[d.reason] ?? d.reason} · 회원 › 회원 대화 신고에서 확인(글은 사유를 적고 열람)`, JSON.stringify({ reportId: ins[0]!.id, reason: d.reason })]);
    return { ok: true, id: ins[0]!.id, note: '신고를 받았습니다. 운영자가 신고된 대화를 확인한 뒤 조치합니다.' };
  });
}

/* ── 운영 화면(회원 › 회원 대화 신고) ── */

/** GET /admin/mbx/dm/reports?state= — 글은 싣지 않음 */
export async function adminReports(db: DatabaseService, state?: string) {
  const st = ['OPEN', 'UPHELD', 'DISMISSED'].includes(state ?? '') ? state! : '';
  const rows = await db.query<Record<string, unknown>>(
    `SELECT r.id::text AS id, r.thread_id AS "threadId", r.reason, r.detail, r.state, r.created_at AS "createdAt", r.decided_at AS "decidedAt", r.decide_note AS "decideNote",
            t.basis_type AS "basisType", t.status AS "threadStatus", rp.name AS _reporter, ot.name AS _other,
            (SELECT count(*)::int FROM mbx_dm_messages m WHERE m.thread_id = t.id) AS messages,
            (SELECT count(*)::int FROM mbx_dm_messages m WHERE m.thread_id = t.id AND cardinality(m.hit_codes) > 0) AS hits,
            (SELECT count(*)::int FROM mbx_dm_admin_views v WHERE v.report_id = r.id) AS views
       FROM mbx_dm_reports r JOIN mbx_dm_threads t ON t.id = r.thread_id
       JOIN accounts rp ON rp.id = r.reporter_id
       JOIN accounts ot ON ot.id = CASE WHEN t.a_id = r.reporter_id THEN t.b_id ELSE t.a_id END
      WHERE ($1::text = '' OR r.state = $1)
      ORDER BY (r.state <> 'OPEN'), r.created_at LIMIT 300`, [st]);
  const counts = await db.query<{ state: string; n: number }>(`SELECT state, count(*)::int AS n FROM mbx_dm_reports GROUP BY state`);
  return {
    items: rows.map(({ _reporter, _other, ...r }) => ({ ...r, reasonLabel: DM_REPORT_KO[String(r.reason)] ?? r.reason, reporter: name(_reporter as string), reported: name(_other as string) })),
    counts: Object.fromEntries(counts.map((c) => [c.state, c.n])),
  };
}

/** POST /admin/mbx/dm/reports/{id}/open — 신고된 대화 글 열람(사유 필수 · 열 때마다 기록) */
export async function adminOpenReported(db: DatabaseService, reportId: string, reason: string) {
  const actor = RequestCtx.actorId() ?? null;
  const why = txt(reason, 200);
  if (why.length < 2) throw new PolicyViolation('MBX_VIEW_REASON', '열람 사유를 2 ~ 200자로 적어 주십시오.');
  if (!/^\d{1,18}$/.test(String(reportId))) throw new NotFound('신고를 찾을 수 없습니다.');
  const [r] = await db.query<{ thread_id: string; reporter: string; a_id: string; b_id: string }>(
    `SELECT r.thread_id::text AS thread_id, r.reporter_id::text AS reporter, t.a_id::text AS a_id, t.b_id::text AS b_id
       FROM mbx_dm_reports r JOIN mbx_dm_threads t ON t.id = r.thread_id WHERE r.id = $1::bigint`, [reportId]);
  if (!r) throw new NotFound('신고를 찾을 수 없습니다.');
  const reported = r.a_id === r.reporter ? r.b_id : r.a_id;
  await db.query(`INSERT INTO mbx_dm_admin_views (report_id, thread_id, actor_id, reason) VALUES ($1::bigint, $2::uuid, $3::uuid, $4)`, [reportId, r.thread_id, actor, why]);
  await db.query(
    `INSERT INTO audit.pii_access_logs (actor_account_id, target_type, target_account_id, access_type, reason, ip)
     VALUES ($1::uuid, 'ACCOUNT', $2::uuid, 'VIEW', $3, $4::inet)`,
    [actor, reported, `회원 대화 신고 열람(신고 ${reportId}) · 사유 ${why}`, RequestCtx.get()?.ip ?? null]);
  const msgs = await db.query<Record<string, unknown>>(
    `SELECT m.id::text AS id, CASE WHEN m.sender_id = $2::uuid THEN 'REPORTER' ELSE 'REPORTED' END AS who, m.body, m.masked, m.hit_codes AS "hitCodes", m.created_at AS "createdAt"
       FROM mbx_dm_messages m WHERE m.thread_id = $1::uuid ORDER BY m.id LIMIT 1000`, [r.thread_id, r.reporter]);
  return { reportId, threadId: r.thread_id, messages: msgs, note: '열람 사유와 함께 개인정보 접속기록에 남겼습니다.' };
}

/** POST /admin/mbx/dm/reports/{id}/decide — 조치(UPHELD · 대화 닫기 선택) · 기각(DISMISSED) */
export async function adminDecide(db: DatabaseService, reportId: string, d: { result: string; note?: string; lock?: boolean }) {
  const actor = RequestCtx.actorId() ?? null;
  if (!['UPHELD', 'DISMISSED'].includes(d.result)) throw new PolicyViolation('MBX_DECIDE', '처리는 UPHELD · DISMISSED 중 하나입니다.');
  const note = txt(d.note, 400);
  if (note.length < 2) throw new PolicyViolation('MBX_DECIDE', '처리 내용을 2자 이상 적어 주십시오.');
  if (!/^\d{1,18}$/.test(String(reportId))) throw new NotFound('신고를 찾을 수 없습니다.');
  return db.transaction(async () => {
    const [r] = await db.query<{ state: string; thread_id: string }>(
      `SELECT state, thread_id::text AS thread_id FROM mbx_dm_reports WHERE id = $1::bigint FOR UPDATE`, [reportId]);
    if (!r) throw new NotFound('신고를 찾을 수 없습니다.');
    if (r.state !== 'OPEN') throw new StateConflict('MBX_DECIDED', '이미 처리한 신고입니다.');
    await db.query(`UPDATE mbx_dm_reports SET state = $2, decided_by = $3::uuid, decided_at = now(), decide_note = $4 WHERE id = $1::bigint`, [reportId, d.result, actor, note]);
    const lock = d.result === 'UPHELD' && d.lock === true;
    if (lock) await db.query(`UPDATE mbx_dm_threads SET status = 'LOCKED', locked_reason = $2 WHERE id = $1::uuid`, [r.thread_id, note]);
    await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2 WHERE alert_code = 'MBX_DM_REPORT' AND detail->>'reportId' = $1 AND resolved_at IS NULL`,
      [reportId, d.result === 'UPHELD' ? '조치함' : '기각']);
    return { ok: true, state: d.result, locked: lock, note: lock ? '조치하고 대화를 닫았습니다.' : '처리했습니다.' };
  });
}

/** 정기 작업(mbx_daily)이 부름 — 보관 기간 지난 글 · 끝난 신고 · 빈 대화 */
export async function purgeDm(db: DatabaseService, retentionDays: number, reportKeepDays: number) {
  return db.transaction(async () => {
    await db.query(`SELECT set_config('app.mbx_purge', 'on', true)`);
    const msgs = await db.query(
      `DELETE FROM mbx_dm_messages m USING mbx_dm_threads t
        WHERE t.id = m.thread_id AND m.created_at < now() - make_interval(days => $1::int)
          AND NOT EXISTS (SELECT 1 FROM mbx_dm_reports r WHERE r.thread_id = t.id
                           AND (r.state = 'OPEN' OR r.decided_at > now() - make_interval(days => $2::int)))
        RETURNING m.id`, [retentionDays, reportKeepDays]);
    const reps = await db.query(
      `DELETE FROM mbx_dm_reports r WHERE r.state <> 'OPEN' AND r.decided_at < now() - make_interval(days => $1::int)
          AND NOT EXISTS (SELECT 1 FROM mbx_dm_messages m WHERE m.thread_id = r.thread_id) RETURNING r.id`, [reportKeepDays]);
    const threads = await db.query(
      `DELETE FROM mbx_dm_threads t WHERE coalesce(t.last_message_at, t.created_at) < now() - make_interval(days => $1::int)
          AND NOT EXISTS (SELECT 1 FROM mbx_dm_messages m WHERE m.thread_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM mbx_dm_reports r WHERE r.thread_id = t.id) RETURNING t.id`, [retentionDays]);
    return { messages: msgs.length, reports: reps.length, threads: threads.length };
  });
}
