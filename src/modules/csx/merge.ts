import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { maskMail } from '../../common/mail/mail-admin.service';
import { csxAudit, csxSettings, needNote, UUID_RE } from './common';

/* ---------------------------------------------------------------------
 * v10.531 (D280 · docs/669) 중복 계정 합치기 — 같은 사람의 두 계정(본인인증이 같을 때만)
 *
 *   흐름: ADMIN · SUPER 가 「옛 계정(합쳐 없어질 쪽) → 남길 계정」으로 요청(사유) → 다른 SUPER 가 「합치기」 글자를 넣고 승인 → DB 함수 하나가 한 번에(되돌릴 수 없음)
 *   본인인증 일치: 두 계정 모두 성공한 본인인증의 ci_hash 가 같고, 방식이 NICE(점검판은 MOCK 도) · 시험용 STUB(stub-ci)은 일치로 보지 않음 · 운영 서버에서 MOCK 은 막음
 *
 *   옮기는 것(fn_csx_merge_execute · 줄마다 csx_account_merge_items 에 기록)
 *     매물(listings.owner_account_id) · 요청(requests.owner_account_id) · 1:1 문의(inquiries.account_id) · 관심(favorites · 남길 계정에 같은 것이 있으면 그대로 둠)
 *     포인트 — 기록은 고치지 않고(trg_point_ledger_ro) 옮김 줄 두 개씩: 현금화 안 되는 포인트 합 · 현금화 가능 잔액(fn_point_cashable)을 CSX_MERGE_OUT(옛) / CSX_MERGE_IN(남길)
 *   옮기지 않고 옛 계정에 남기는 것(기록 · 법정 보관) — 거래(deals) · 정산 · 포인트 출금 · 지급 계좌 · 본인인증 · 약관 동의 · 로그인 기록 · 감사 기록 · 알림 · 소개몰 주문 · 구독 · 추천 관계
 *   막는 것(하나라도 있으면 요청 · 승인 안 됨) — fn_csx_merge_check 의 blockers
 *     같은 계정 · 계정 상태(쓰는 계정 아님 · 탈퇴 · 파기) · 본인인증 불일치 · 이미 합쳐진 계정 · 열린 합치기 요청 · 운영 역할(두 계정 모두) ·
 *     옛 계정의 회사(파트너) 소속 · 진행 중 거래 · 열린 분쟁 · 진행 중 정산 · 진행 중 포인트 출금 · 쓰는 구독 · 소개몰 판매자 · 진행 중 소개몰 주문 ·
 *     남은 소개몰 적립금 · 검수 중 매물 · 요청 · 등록 정지(두 계정 모두)
 *   끝나면: 옛 계정은 SUSPENDED · 모든 로그인 끊김(token_version) · 다시 ACTIVE 로 못 바꿈(trg_csx_merged_source_guard) · 남길 계정에 알림 CSX_ACCOUNT_MERGED
 * ------------------------------------------------------------------- */

export const MERGE_STATES = ['REQUESTED', 'DONE', 'REJECTED', 'CANCELED', 'FAILED'] as const;
export const MERGE_CONFIRM = '합치기';
const isProd = () => (process.env.NODE_ENV ?? 'development') === 'production';

export interface MergeBlocker { code: string; label: string; n: number }
export interface MergeCheck {
  ok: boolean; blockers: MergeBlocker[];
  moves: Record<string, number>; keeps: Record<string, number>;
  identity: { match: boolean; adapter: string | null };
}

/** 미리 확인(DB 함수 그대로 + 운영 서버의 MOCK 본인인증 막음) */
export async function mergeCheck(db: DatabaseService, sourceId: string, targetId: string, except: number | null = null): Promise<MergeCheck> {
  if (!UUID_RE.test(sourceId) || !UUID_RE.test(targetId)) throw new NotFound('계정을 찾을 수 없습니다.');
  const [r] = await db.query<{ c: MergeCheck }>(`SELECT fn_csx_merge_check($1::uuid, $2::uuid, $3::bigint) AS c`, [sourceId, targetId, except]);
  const c = r!.c;
  if (isProd() && c.identity?.adapter === 'MOCK') {
    c.blockers.push({ code: 'IDENTITY_MOCK', label: '운영 서버에서는 가짜 본인인증(MOCK)으로 합칠 수 없습니다', n: 1 });
    c.ok = false;
  }
  return c;
}

/** 합칠 계정 찾기 — 메일 전체가 같은 것만(부분 찾기 없음 · 개인정보 덜 보이게) */
export async function mergeFindAccount(db: DatabaseService, email: string) {
  const e = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(e)) throw new PolicyViolation('CSX_EMAIL', '메일 주소 전체를 넣어 주십시오.');
  const [a] = await db.query<{ id: string; email: string; name: string | null; status: string; createdAt: string; adapter: string | null; verifiedAt: string | null }>(
    `SELECT a.id::text AS id, a.email::text AS email, a.name, a.status, a.created_at AS "createdAt",
            (SELECT v.adapter FROM identity_verifications v WHERE v.account_id = a.id AND v.result = 'SUCCESS' ORDER BY v.completed_at DESC NULLS LAST LIMIT 1) AS adapter,
            a.identity_verified_at AS "verifiedAt"
       FROM accounts a WHERE a.email = $1::citext`, [e]);
  if (!a) throw new NotFound('그 메일의 계정이 없습니다.');
  return { id: a.id, email: maskMail(a.email), nameHead: a.name ? `${a.name.slice(0, 1)}*` : '—', status: a.status, createdAt: a.createdAt, identity: a.adapter, verifiedAt: a.verifiedAt };
}

/** 요청(ADMIN · SUPER) — 스위치 · 미리 확인 통과해야 · 계획(plan)을 그때 값으로 남김 */
export async function mergeRequest(db: DatabaseService, actor: string, d: { sourceId: string; targetId: string; reason: string }) {
  const s = await csxSettings(db);
  if (!s.accountMerge) throw new PolicyViolation('CSX_MERGE_OFF', '계정 합치기가 꺼져 있습니다(csx.account_merge) — SUPER 가 켠 뒤 요청합니다.');
  const reason = needNote(d.reason);
  const c = await mergeCheck(db, d.sourceId, d.targetId);
  if (!c.ok) throw new PolicyViolation('CSX_MERGE_BLOCKED', `합칠 수 없습니다 — ${c.blockers.map((b) => b.label).join(' · ')}`, { blockers: c.blockers });
  const r = await db.query<{ id: string }>(
    `INSERT INTO csx_account_merges (source_id, target_id, reason, plan, requested_by) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::uuid)
     ON CONFLICT (source_id) WHERE state = 'REQUESTED' DO NOTHING RETURNING id::text AS id`, [d.sourceId, d.targetId, reason, JSON.stringify(c), actor]);
  if (!r.length) throw new StateConflict('CSX_MERGE_OPEN', '이 계정의 합치기 요청이 이미 열려 있습니다.');
  await csxAudit(db, 'CSX_MERGE_REQUEST', 'ACCOUNT', d.sourceId, null, { mergeId: Number(r[0]!.id), targetId: d.targetId, moves: c.moves });
  return { ok: true, id: Number(r[0]!.id), plan: c, note: '합치기를 요청했습니다 — 요청한 사람이 아닌 SUPER 가 승인해야 합칩니다.' };
}

async function mergeRow(db: DatabaseService, id: number) {
  const [m] = await db.query<{ id: string; sourceId: string; targetId: string; state: string; requestedBy: string }>(
    `SELECT id::text AS id, source_id::text AS "sourceId", target_id::text AS "targetId", state, requested_by::text AS "requestedBy" FROM csx_account_merges WHERE id = $1::bigint`, [id]);
  if (!m) throw new NotFound('그 합치기 요청이 없습니다.');
  return m;
}

/** 승인 = 실행(SUPER · 요청한 사람이 아닌 사람 · 「합치기」 글자) — 되돌릴 수 없음 */
export async function mergeApprove(db: DatabaseService, actor: string, id: number, d: { confirm: string; note?: string }) {
  if (String(d.confirm ?? '').trim() !== MERGE_CONFIRM) throw new PolicyViolation('CSX_MERGE_CONFIRM', `되돌릴 수 없습니다 — 확인 글자 「${MERGE_CONFIRM}」를 넣어 주십시오.`);
  const m = await mergeRow(db, id);
  if (m.state !== 'REQUESTED') throw new StateConflict('CSX_MERGE_STATE', '열린 요청만 승인할 수 있습니다.');
  if (m.requestedBy === actor) throw new PolicyViolation('CSX_MERGE_SELF', '요청한 사람이 아닌 다른 SUPER 가 승인해야 합니다.');
  const c = await mergeCheck(db, m.sourceId, m.targetId, id);
  if (!c.ok) throw new PolicyViolation('CSX_MERGE_BLOCKED', `합칠 수 없습니다 — ${c.blockers.map((b) => b.label).join(' · ')}`, { blockers: c.blockers });
  const note = d.note ? String(d.note).replace(/\s+/g, ' ').trim().slice(0, 300) || null : null;
  let result: Record<string, unknown>;
  try {
    result = await db.transaction(async () => {
      const [r] = await db.query<{ r: Record<string, unknown> }>(`SELECT fn_csx_merge_execute($1::bigint, $2::uuid, $3::text) AS r`, [id, actor, note]);
      return r!.r;
    });
  } catch (e: any) {
    /* 트리거 · 정책이 막아 한 번에 되돌아감 — 요청은 FAILED 로 닫고(새로 요청 가능) 까닭을 그대로 */
    const why = String(e?.message ?? e).slice(0, 280);
    await db.query(`UPDATE csx_account_merges SET state = 'FAILED', decided_by = $2::uuid, decided_at = now(), decide_note = $3 WHERE id = $1::bigint AND state = 'REQUESTED'`, [id, actor, why]);
    await csxAudit(db, 'CSX_MERGE_FAILED', 'ACCOUNT', m.sourceId, null, { mergeId: id, error: why });
    throw e;
  }
  await csxAudit(db, 'CSX_MERGE_DONE', 'ACCOUNT', m.sourceId, { state: 'REQUESTED' }, { mergeId: id, targetId: m.targetId, result });
  return { ok: true, id, result, note: '계정을 합쳤습니다 — 옛 계정은 쓸 수 없게 되었고 되돌릴 수 없습니다.' };
}

export async function mergeReject(db: DatabaseService, actor: string, id: number, d: { note: string }) {
  const note = needNote(d.note);
  const m = await mergeRow(db, id);
  if (m.state !== 'REQUESTED') throw new StateConflict('CSX_MERGE_STATE', '열린 요청만 반려할 수 있습니다.');
  await db.query(`UPDATE csx_account_merges SET state = 'REJECTED', decided_by = $2::uuid, decided_at = now(), decide_note = $3 WHERE id = $1::bigint AND state = 'REQUESTED'`, [id, actor, note]);
  await csxAudit(db, 'CSX_MERGE_REJECT', 'ACCOUNT', m.sourceId, null, { mergeId: id, note });
  return { ok: true, id, note: '합치기 요청을 반려했습니다.' };
}

/** 취소 — 요청한 사람 또는 SUPER */
export async function mergeCancel(db: DatabaseService, actor: string, id: number) {
  const m = await mergeRow(db, id);
  if (m.state !== 'REQUESTED') throw new StateConflict('CSX_MERGE_STATE', '열린 요청만 취소할 수 있습니다.');
  const [sup] = await db.query(`SELECT 1 FROM account_roles WHERE account_id = $1::uuid AND role = 'SUPER'`, [actor]);
  if (m.requestedBy !== actor && !sup) throw new PolicyViolation('CSX_MERGE_OWNER', '요청한 사람이나 SUPER 만 취소할 수 있습니다.');
  await db.query(`UPDATE csx_account_merges SET state = 'CANCELED', decided_by = $2::uuid, decided_at = now(), decide_note = '취소' WHERE id = $1::bigint AND state = 'REQUESTED'`, [id, actor]);
  return { ok: true, id, note: '합치기 요청을 취소했습니다.' };
}

export async function mergeList(db: DatabaseService, stateIn?: string) {
  const st = (MERGE_STATES as readonly string[]).includes(String(stateIn ?? '')) ? String(stateIn) : null;
  const s = await csxSettings(db);
  const rows = await db.query<{ sEmail: string | null; tEmail: string | null; rEmail: string | null; dEmail: string | null } & Record<string, unknown>>(
    `SELECT m.id::text AS id, m.state, m.reason, m.plan, m.result, m.requested_at AS "requestedAt", m.decided_at AS "decidedAt", m.decide_note AS "decideNote",
            m.source_id::text AS "sourceId", m.target_id::text AS "targetId",
            sa.email::text AS "sEmail", ta.email::text AS "tEmail", ra.email::text AS "rEmail", da.email::text AS "dEmail",
            (SELECT count(*)::int FROM csx_account_merge_items i WHERE i.merge_id = m.id) AS items
       FROM csx_account_merges m
       JOIN accounts sa ON sa.id = m.source_id JOIN accounts ta ON ta.id = m.target_id
       JOIN accounts ra ON ra.id = m.requested_by LEFT JOIN accounts da ON da.id = m.decided_by
      WHERE ($1::text IS NULL OR m.state = $1) ORDER BY m.id DESC LIMIT 100`, [st]);
  const counts = await db.query<{ state: string; n: number }>(`SELECT state, count(*)::int AS n FROM csx_account_merges GROUP BY 1`);
  return {
    on: s.accountMerge, confirmWord: MERGE_CONFIRM, counts: Object.fromEntries(counts.map((c) => [c.state, c.n])),
    rows: rows.map(({ sEmail, tEmail, rEmail, dEmail, ...r }) => ({ ...r, source: maskMail(sEmail), target: maskMail(tEmail), requestedBy: maskMail(rEmail), decidedBy: maskMail(dEmail) })),
    warn: '합치기는 되돌릴 수 없습니다. 옛 계정은 쓸 수 없게 되고, 거래 · 정산 · 출금 기록은 옛 계정에 남습니다.',
  };
}
