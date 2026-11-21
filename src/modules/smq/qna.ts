import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { SMQ_KEYS, smqMySeller, smqOn, smqSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.577 (docs/719) ① 상품 문의 Q&A 2차 — 기존 상품 문의(D036 · v10.28 · hlt_qna)를 넓힘
 *   그대로    회원 질문(본인인증) · 비밀글(is_private — 쓴 사람 · 운영 · 그 상품 판매자만 글을 봄) · 운영 답(POST /admin/health/qna/{id}/answer) · 가림
 *   더함      입점 상품은 판매자센터에서 그 판매자가 답(PUT /me/health/seller/qna/{id}) — 운영도 답할 수 있음(나중 답이 앞 답을 바꿈)
 *             답 기한(due_at = 쓴 때 + smq.qna_due_hours · 처음 48시간) · 기한 넘김 알림(정기 작업 smq_daily)
 *             금칙어(기존 사전 fn_check_banned_words HLT) — 문의 글 · 판매자 답이 걸리면 운영 확인 뒤 보임(PENDING) · 운영 보이기 · 가리기
 *             공개 목록에 「누가 답했나」(판매자 이름 · 운영은 화면이 「소개몰」)
 *   스위치    smq.qna off(처음) — 판매자 답 쓰기 막음 · 금칙어 검사 · 기한 알림 안 함(DB 트리거도 스위치를 봄) · 운영 답 · 회원 질문은 예전 그대로
 * ------------------------------------------------------------------- */

const MASK = `coalesce(left(btrim(a.name), 1), '회') || '○○'`;

function cleanAnswer(v: string): string {
  const b = String(v ?? '').replace(/\r\n/g, '\n').trim();
  if (b.length < 2 || b.length > 2000) throw new PolicyViolation('SMQ_QNA_BODY', '답은 2 ~ 2,000자로 써 주십시오.');
  return b;
}

/** 답이 처음 보이게 될 때(판매자 답 · 운영 보이기) 쓴 사람에게 알림 — 기존 운영 답과 같은 알림 코드(HLT_QNA_ANSWERED) */
async function notifyAsker(db: DatabaseService, qnaId: string) {
  await db.query(
    `INSERT INTO notifications (account_id, event_code, title, body, link_url)
     SELECT q.account_id, 'HLT_QNA_ANSWERED', '상품 문의에 답이 왔습니다', left(q.answer, 80), '/health/p/' || p.code || '#qna'
       FROM hlt_qna q JOIN hlt_products p ON p.id = q.product_id
      WHERE q.id = $1 AND q.answer IS NOT NULL AND q.answer_state = 'VISIBLE'`, [qnaId]);
}

/* ── 판매자센터 ── */

/** GET /me/health/seller/qna?view=open|all — 내 상품의 보이는 문의(비밀글 포함 · 쓴 사람은 가린 이름) · 답 기한 · 내 답 상태 */
export async function sellerQna(db: DatabaseService, view?: string) {
  const s = await smqMySeller(db);
  const { sw, rules } = await smqSettings(db);
  const open = view !== 'all';
  const items = await db.query<Record<string, unknown>>(
    `SELECT q.id, p.code AS "productCode", p.name AS "productName", q.body, q.is_private AS "isPrivate", q.created_at AS "createdAt", ${MASK} AS writer,
            q.due_at AS "dueAt", (q.answer IS NULL AND q.due_at < now()) AS overdue,
            q.answer, q.answer_kind AS "answerKind", q.answer_state AS "answerState", q.answer_hold_word AS "holdWord",
            q.answer_hidden_reason AS "hiddenReason", q.answered_at AS "answeredAt"
       FROM hlt_qna q JOIN hlt_products p ON p.id = q.product_id JOIN accounts a ON a.id = q.account_id
      WHERE p.seller_id = $1 AND q.state = 'VISIBLE' AND ($2::boolean IS FALSE OR q.answer IS NULL)
      ORDER BY (q.answer IS NULL) DESC, q.due_at ASC NULLS LAST, q.created_at DESC LIMIT 200`, [s.id, open]);
  const [c] = await db.query<{ open: number; overdue: number }>(
    `SELECT count(*) FILTER (WHERE q.answer IS NULL)::int AS open, count(*) FILTER (WHERE q.answer IS NULL AND q.due_at < now())::int AS overdue
       FROM hlt_qna q JOIN hlt_products p ON p.id = q.product_id WHERE p.seller_id = $1 AND q.state = 'VISIBLE'`, [s.id]);
  return { on: sw.qna, dueHours: rules.qnaDueHours, seller: { code: s.code, name: s.name }, view: open ? 'open' : 'all', counts: c ?? { open: 0, overdue: 0 }, items,
    note: sw.qna ? `내 상품 문의에 답합니다 — 답 기한은 문의 뒤 ${rules.qnaDueHours}시간이고, 늦은 답은 판매 평가에 들어갑니다. 비밀글은 쓴 분과 운영 · 판매자만 봅니다.`
      : '지금은 판매자 답 쓰기가 꺼져 있습니다(운영이 켤 때까지 문의는 운영이 답합니다). 문의는 볼 수 있습니다.' };
}

/** PUT /me/health/seller/qna/{id} — 내 상품 문의에 답(다시 쓰면 고침 · 금칙어면 운영 확인 뒤 보임 · DB 트리거가 판매자 본인인지 · 보이는 문의인지 다시 봄) */
export async function sellerQnaAnswer(db: DatabaseService, id: string, body: string) {
  if (!(await smqOn(db, SMQ_KEYS.qna))) throw new PolicyViolation('SMQ_QNA_OFF', '지금은 판매자 답 쓰기가 꺼져 있습니다(운영이 켤 때까지).');
  const b = cleanAnswer(body);
  return db.transaction(async () => {
    const s = await smqMySeller(db);
    const [q] = await db.query<{ id: string; state: string; answerState: string; hadAnswer: boolean }>(
      `SELECT q.id, q.state, q.answer_state AS "answerState", (q.answer IS NOT NULL) AS "hadAnswer"
         FROM hlt_qna q JOIN hlt_products p ON p.id = q.product_id WHERE q.id = $1 AND p.seller_id = $2 FOR UPDATE OF q`, [id, s.id]);
    if (!q) throw new NotFound('내 상품의 문의가 아닙니다.');
    if (q.state !== 'VISIBLE') throw new StateConflict('SMQ_QNA_STATE', '보이는 문의에만 답할 수 있습니다.');
    if (q.hadAnswer && q.answerState === 'HIDDEN') throw new StateConflict('SMQ_QNA_HIDDEN', '운영이 가린 답은 고칠 수 없습니다.');
    await db.query(`UPDATE hlt_qna SET answer = $2, answered_by = $3, answered_at = now() WHERE id = $1`, [id, b, RequestCtx.actorId()]);
    const [r] = await db.query<{ id: string; answerKind: string; answerState: string; holdWord: string | null }>(
      `SELECT id, answer_kind AS "answerKind", answer_state AS "answerState", answer_hold_word AS "holdWord" FROM hlt_qna WHERE id = $1`, [id]);
    if (r.answerState === 'VISIBLE') await notifyAsker(db, id);
    return { ...r, edited: q.hadAnswer,
      note: r.answerState === 'PENDING' ? '답을 받았습니다. 확인이 필요한 표현이 있어 운영 확인 뒤 보입니다.' : q.hadAnswer ? '답을 고쳤습니다(쓴 분에게 다시 알림).' : '답했습니다(쓴 분에게 알림).' };
  });
}

/* ── 운영 ── */

/** GET /admin/smq/qna?view=open|overdue|pending|all — 답할 것 · 기한 넘김 · 운영 확인 대기(문의 · 판매자 답) · 모두 */
export async function adminQna(db: DatabaseService, view?: string) {
  const { sw, rules } = await smqSettings(db);
  const v = ['open', 'overdue', 'pending', 'all'].includes(view ?? '') ? view! : 'open';
  const [c] = await db.query<{ open: number; overdue: number; pending: number }>(
    `SELECT count(*) FILTER (WHERE answer IS NULL AND state = 'VISIBLE')::int AS open,
            count(*) FILTER (WHERE answer IS NULL AND state = 'VISIBLE' AND due_at < now())::int AS overdue,
            count(*) FILTER (WHERE state = 'PENDING' OR (answer IS NOT NULL AND answer_state = 'PENDING'))::int AS pending
       FROM hlt_qna`);
  const items = await db.query<Record<string, unknown>>(
    `SELECT q.id, q.body, q.is_private AS "isPrivate", q.state, q.hold_word AS "holdWord", q.hidden_reason AS "hiddenReason", q.created_at AS "createdAt",
            q.due_at AS "dueAt", (q.answer IS NULL AND q.state = 'VISIBLE' AND q.due_at < now()) AS overdue,
            q.answer, q.answer_kind AS "answerKind", q.answer_state AS "answerState", q.answer_hold_word AS "answerHoldWord", q.answer_hidden_reason AS "answerHiddenReason",
            q.answered_at AS "answeredAt", p.code AS "productCode", p.name AS "productName", coalesce(s.type, 'DIRECT') AS "sellerType", s.name AS "sellerName", ${MASK} AS writer
       FROM hlt_qna q JOIN hlt_products p ON p.id = q.product_id LEFT JOIN hlt_sellers s ON s.id = p.seller_id JOIN accounts a ON a.id = q.account_id
      WHERE CASE $1::text
              WHEN 'open' THEN q.answer IS NULL AND q.state = 'VISIBLE'
              WHEN 'overdue' THEN q.answer IS NULL AND q.state = 'VISIBLE' AND q.due_at < now()
              WHEN 'pending' THEN q.state = 'PENDING' OR (q.answer IS NOT NULL AND q.answer_state = 'PENDING')
              ELSE true END
      ORDER BY CASE WHEN $1::text IN ('open', 'overdue') THEN q.due_at END ASC NULLS LAST, q.created_at DESC LIMIT 200`, [v]);
  return { on: sw.qna, dueHours: rules.qnaDueHours, view: v, counts: c ?? { open: 0, overdue: 0, pending: 0 }, items,
    note: sw.qna ? `입점 상품 문의는 판매자가 판매자센터에서 답합니다(운영도 답할 수 있음) · 답 기한 ${rules.qnaDueHours}시간 · 금칙어에 걸린 문의 · 판매자 답은 여기서 보이기 · 가리기.`
      : '상품 문의 2차가 꺼져 있습니다(smq.qna) — 문의는 예전처럼 운영이 답하고, 금칙어 검사 · 기한 알림 · 판매자 답은 하지 않습니다.' };
}

/** POST /admin/smq/qna/{id}/decide — 문의 글 또는 답을 보이기 · 가리기(가리기는 사유 · 답이 처음 보이게 되면 쓴 사람에게 알림) */
export async function adminQnaDecide(db: DatabaseService, id: string, target: 'QUESTION' | 'ANSWER', action: 'SHOW' | 'HIDE', reason?: string) {
  return db.transaction(async () => {
    const [q] = await db.query<{ id: string; state: string; answer: string | null; answerState: string }>(
      `SELECT id, state, answer, answer_state AS "answerState" FROM hlt_qna WHERE id = $1 FOR UPDATE`, [id]);
    if (!q) throw new NotFound('없는 문의입니다.');
    const why = (reason ?? '').replace(/\s+/g, ' ').trim();
    if (action === 'HIDE' && why.length < 2) throw new PolicyViolation('REASON_REQUIRED', '가리는 사유를 적어 주십시오.');
    if (why.length > 300) throw new PolicyViolation('SMQ_QNA_REASON', '사유는 300자 안으로 적어 주십시오.');
    const st = action === 'SHOW' ? 'VISIBLE' : 'HIDDEN';
    if (target === 'QUESTION') {
      if (q.state === st) throw new StateConflict('SMQ_QNA_SAME', st === 'VISIBLE' ? '이미 보이는 문의입니다.' : '이미 가린 문의입니다.');
      await db.query(`UPDATE hlt_qna SET state = $2, hidden_reason = $3, decided_by = $4, decided_at = now() WHERE id = $1`,
        [id, st, action === 'HIDE' ? why : null, RequestCtx.actorId()]);
      return { id, target, state: st, note: st === 'VISIBLE' ? '문의를 보이게 했습니다.' : '문의를 가렸습니다.' };
    }
    if (!q.answer) throw new StateConflict('SMQ_QNA_NO_ANSWER', '아직 답이 없는 문의입니다.');
    if (q.answerState === st) throw new StateConflict('SMQ_QNA_SAME', st === 'VISIBLE' ? '이미 보이는 답입니다.' : '이미 가린 답입니다.');
    await db.query(`UPDATE hlt_qna SET answer_state = $2, answer_hidden_reason = $3, decided_by = $4, decided_at = now() WHERE id = $1`,
      [id, st, action === 'HIDE' ? why : null, RequestCtx.actorId()]);
    if (st === 'VISIBLE') await notifyAsker(db, id);
    return { id, target, state: st, note: st === 'VISIBLE' ? '답을 보이게 했습니다(쓴 분에게 알림).' : '답을 가렸습니다.' };
  });
}

/* ── 정기 작업 일부(smq_daily) ── */

/** 답 기한 넘김 — 입점 상품은 판매자에게 한 번(SMQ_QNA_DUE) · 넘긴 수가 있으면 운영 알림 하루 한 번(SMQ_QNA_OVERDUE) · smq.qna off 면 아무것도 안 함 */
export async function smqQnaDueJob(db: DatabaseService) {
  if (!(await smqOn(db, SMQ_KEYS.qna))) return { on: false, sellerNotified: 0, overdue: 0, alerted: 0 };
  const n = await db.query<{ id: string }>(
    `WITH x AS (
       UPDATE hlt_qna q SET due_alerted_at = now()
         FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id
        WHERE p.id = q.product_id AND s.type IN ('TENANT', 'BRAND') AND s.account_id IS NOT NULL
          AND q.answer IS NULL AND q.state = 'VISIBLE' AND q.due_at < now() AND q.due_alerted_at IS NULL
        RETURNING q.id, s.account_id, p.name)
     INSERT INTO notifications (account_id, event_code, title, body, link_url)
     SELECT account_id, 'SMQ_QNA_DUE', '상품 문의 답 기한이 지났습니다', left(name, 60) || ' — 판매자센터 › 상품 문의에서 답해 주십시오.', '/health/seller/center/qna' FROM x
     RETURNING id::text AS id`);
  const [c] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM hlt_qna WHERE answer IS NULL AND state = 'VISIBLE' AND due_at < now()`);
  let alerted = 0;
  if ((c?.n ?? 0) > 0) {
    const a = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'SMQ_QNA_OVERDUE', 'INFO', $1, jsonb_build_object('n', $2::int), clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = 'SMQ_QNA_OVERDUE' AND a.raised_at > now() - interval '20 hours')
       ON CONFLICT DO NOTHING RETURNING id`, [`상품 문의 답 기한 넘김 ${c!.n}건 — 소개몰 › 상품 문의 답 관리`, c!.n]);
    alerted = a.length;
  }
  return { on: true, sellerNotified: n.length, overdue: c?.n ?? 0, alerted };
}
