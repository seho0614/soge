import { DatabaseService } from '../../db/database.service';
import { MailService } from '../../common/mail/mail.service';
import { NotFound, StateConflict } from '../../core/errors';
import { mtrMaskMail, mtrSettings, mtrText, MTR_UUID_RE } from './common';

/* ---------------------------------------------------------------------
 * v10.576 (docs/718) 회원 휴면 계정 — 스위치 mtr.dormant(처음 꺼짐 · 법무 확인 필요 · 회사 선택)
 *   ① 매일(mtr_daily) 마지막 로그인(없으면 가입)부터 mtr.dormant_days(365) - mtr.dormant_notice_days(30)일 지난 회원에게 미리 알림 한 번
 *      (사이트 알림 MTR_DORMANT_NOTICE · mtr.dormant_mail on 이면 메일 한 통 — 반송 · 수신 거부 주소 뺌 · 메일 준비 안 됐으면 사이트 알림만)
 *   ② 알림 뒤 알림 일수가 지나고 그 사이 로그인하지 않았고 미접속 기준일이 지났으면 휴면 — fn_mtr_dormant_apply
 *      이름 · 전화를 pii.mtr_dormant_vault(암호화)로 옮기고 accounts 에는 「휴면 회원」 · 전화 비움 · 상태 DORMANT · 로그인 증표 무효
 *      로그인 아이디(이메일)는 남김 — 로그인으로 풀어야 하므로
 *   ③ 빼는 회원: 운영 역할 · 진행 중 거래(성사 · 정산 · 취소 전) · 유료 구독 중 · 안심 · 제휴 파트너 신청 · 활동 중 · 탈퇴 · 파기
 *   ④ 풀기 — 이메일 로그인 · 간편 로그인(auth.service · social.ts 패치) · 비밀번호 재설정 링크(account-security 패치) · SUPER(사유 · 감사)
 *      이름 · 전화는 DB 트리거(fn_mtr_dormant_guard)가 금고에서 되돌림 — 어디서 상태를 바꿔도 같음
 *   ⑤ 한 번에 많아야 500명(알림) · 500명(휴면) · 40초 예산
 * ------------------------------------------------------------------- */

export const DORMANT_VIEWS = ['NOTICED', 'DORMANT', 'RESTORED'] as const;
const BATCH = 500;
const BUDGET_MS = 40_000;

/* 휴면 후보 공통 조건은 DB 뷰 v_mtr_dormant_pool(운영 역할 · 진행 중 거래 · 유료 구독 · 파트너 뺌) — SQL 글에 조각을 끼우지 않으려고 뷰로 */

/** 매일 — 알림 → 휴면(꺼져 있으면 아무것도 안 함) */
export async function dormantJob(db: DatabaseService, mail: MailService | null) {
  const s = await mtrSettings(db);
  if (!s.dormant) return { skipped: 'OFF', noticed: 0, mailed: 0, dormant: 0 };
  const t0 = Date.now();

  /* ① 미리 알림 — 기준(마지막 로그인 · 가입)이 (기준일 - 알림일) 전보다 오래되고 그 기준 뒤로 알린 적 없음 */
  const due = await db.query<{ id: string; email: string; basis: string; until: string }>(
    `SELECT a.id::text, a.email::text AS email, coalesce(a.last_login_at, a.created_at)::text AS basis,
            to_char((greatest(coalesce(a.last_login_at, a.created_at) + make_interval(days => $1::int), now() + make_interval(days => $2::int))) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS until
       FROM v_mtr_dormant_pool a LEFT JOIN mtr_dormant m ON m.account_id = a.id
      WHERE coalesce(a.last_login_at, a.created_at) < now() - make_interval(days => ($1::int - $2::int))
        AND (m.account_id IS NULL OR m.noticed_at IS NULL OR m.noticed_at < coalesce(a.last_login_at, a.created_at) OR m.state = 'RESTORED')
      ORDER BY coalesce(a.last_login_at, a.created_at) LIMIT $3::int`, [s.dormantDays, s.dormantNoticeDays, BATCH]);
  let noticed = 0, mailed = 0;
  const mailReady = s.dormantMail && mail ? await mail.ready().catch(() => false) : false;
  const [b] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'site.base_url'`);
  const base = (b?.v ?? '').replace(/\/+$/, '') || 'https://sogaebank.com';
  for (const d of due) {
    if (Date.now() - t0 > BUDGET_MS) break;
    await db.query(
      `INSERT INTO mtr_dormant (account_id, state, basis_at, noticed_at, notice_mailed_at, dormant_at, restored_at, restored_via, updated_at)
       VALUES ($1::uuid, 'NOTICED', $2::timestamptz, now(), NULL, NULL, NULL, NULL, now())
       ON CONFLICT (account_id) DO UPDATE SET state = 'NOTICED', basis_at = EXCLUDED.basis_at, noticed_at = now(), notice_mailed_at = NULL,
                                              dormant_at = NULL, restored_at = NULL, restored_via = NULL, updated_at = now()`, [d.id, d.basis]);
    await db.query(
      `INSERT INTO notifications (account_id, event_code, title, body, link_url)
       VALUES ($1::uuid, 'MTR_DORMANT_NOTICE', '오래 로그인하지 않아 곧 휴면 계정으로 바뀝니다', $2, '/my')`,
      [d.id, `${d.until} 무렵까지 로그인하지 않으시면 휴면 계정으로 바뀌고 이름 · 전화번호는 따로 보관됩니다. 로그인하시면 그대로 쓰실 수 있고, 휴면이 된 뒤에도 로그인하면 바로 풀립니다.`]);
    noticed++;
    if (mailReady && mail) {
      const [sup] = await db.query<{ x: boolean }>(`SELECT EXISTS (SELECT 1 FROM mail_suppressions s WHERE s.email = $1::citext AND s.released_at IS NULL) AS x`, [d.email]);
      if (!sup?.x) {
        const text = [
          '소개뱅크에 오래 로그인하지 않으셔서 알려 드립니다.',
          '',
          `· ${d.until} 무렵까지 로그인하지 않으시면 휴면 계정으로 바뀝니다.`,
          '· 휴면 계정이 되면 이름 · 전화번호는 다른 회원 정보와 따로 암호화해 보관하고, 알림 · 마케팅 대상에서 빠집니다.',
          '· 휴면이 된 뒤에도 이메일 · 비밀번호로 로그인하시면 바로 풀리고 그대로 쓰실 수 있습니다.',
          '',
          `계속 쓰시려면 로그인 화면(${base}/login)에서 로그인해 주십시오.`,
          '',
          '이 메일은 휴면 전 안내로 한 번만 보냅니다.',
          '(주)한국바이오헬스케어 소개뱅크 사업부',
        ].join('\n');
        const r = await mail.send({ to: d.email, subject: '[소개뱅크] 오래 로그인하지 않아 곧 휴면 계정으로 바뀝니다', text }).catch(() => ({ ok: false }));
        if (r.ok) { await db.query(`UPDATE mtr_dormant SET notice_mailed_at = now() WHERE account_id = $1::uuid`, [d.id]); mailed++; }
      }
    }
  }

  /* ② 휴면 — 알림 뒤 알림 일수 지남 · 그 뒤 로그인 없음 · 미접속 기준일 지남 */
  const go = await db.query<{ id: string }>(
    `SELECT a.id::text FROM v_mtr_dormant_pool a JOIN mtr_dormant m ON m.account_id = a.id
      WHERE m.state = 'NOTICED' AND m.noticed_at < now() - make_interval(days => $2::int)
        AND m.noticed_at > coalesce(a.last_login_at, a.created_at)
        AND coalesce(a.last_login_at, a.created_at) < now() - make_interval(days => $1::int)
      ORDER BY m.noticed_at LIMIT $3::int`, [s.dormantDays, s.dormantNoticeDays, BATCH]);
  let dormant = 0;
  for (const g of go) {
    if (Date.now() - t0 > BUDGET_MS) break;
    const [r] = await db.query<{ ok: boolean }>(`SELECT fn_mtr_dormant_apply($1::uuid) AS ok`, [g.id]);
    if (r?.ok) dormant++;
  }
  /* 알림 뒤 로그인한 회원 — 알림 줄은 남기되 다음 기준에서 다시 셈(위 ① 조건) */
  return { noticed, mailed, dormant, mailReady };
}

/** 로그인 · 간편 로그인 · 재설정 링크에서 부름 — 휴면이면 풀고 사이트 알림 한 번(아니면 아무것도 안 함) */
export async function mtrDormantWake(db: DatabaseService, accountId: string, via: 'LOGIN' | 'SOCIAL' | 'PW_RESET' | 'ADMIN'): Promise<boolean> {
  const [r] = await db.query<{ ok: boolean }>(`SELECT fn_mtr_dormant_wake($1::uuid, $2::text) AS ok`, [accountId, via]);
  if (!r?.ok) return false;
  await db.query(
    `INSERT INTO notifications (account_id, event_code, title, body, link_url)
     VALUES ($1::uuid, 'MTR_DORMANT_WAKE', '휴면 계정이 풀렸습니다', '다시 오신 것을 환영합니다. 따로 보관하던 이름 · 전화번호를 되돌렸습니다. 내 정보가 맞는지 확인해 주십시오.', '/my/account')`,
    [accountId]).catch(() => undefined);
  return true;
}

/* ── 운영 ── */
export async function dormantList(db: DatabaseService, viewIn?: string) {
  const view = (DORMANT_VIEWS as readonly string[]).includes(String(viewIn ?? '')) ? String(viewIn) : 'NOTICED';
  const s = await mtrSettings(db);
  const rows = await db.query<{ email: string | null } & Record<string, unknown>>(
    `SELECT m.account_id::text AS "accountId", a.email::text AS email, a.status, m.state, m.basis_at AS "basisAt", m.noticed_at AS "noticedAt",
            m.notice_mailed_at AS "noticeMailedAt", m.dormant_at AS "dormantAt", m.restored_at AS "restoredAt", m.restored_via AS "restoredVia",
            a.last_login_at AS "lastLoginAt", a.created_at AS "joinedAt"
       FROM mtr_dormant m JOIN accounts a ON a.id = m.account_id
      WHERE m.state = $1
      ORDER BY coalesce(m.restored_at, m.dormant_at, m.noticed_at) DESC LIMIT 200`, [view]);
  const [c] = await db.query<{ noticed: number; dormant: number; restored30: number; vault: number }>(
    `SELECT count(*) FILTER (WHERE state = 'NOTICED')::int AS noticed, count(*) FILTER (WHERE state = 'DORMANT')::int AS dormant,
            count(*) FILTER (WHERE state = 'RESTORED' AND restored_at > now() - interval '30 days')::int AS restored30,
            (SELECT count(*)::int FROM pii.mtr_dormant_vault) AS vault
       FROM mtr_dormant`);
  /* 미리 보기 — 지금 켜면 알림 대상 · 휴면 대상 수(사람 정보 없음) */
  const [p] = await db.query<{ notice: number; old: number }>(
    `SELECT count(*) FILTER (WHERE coalesce(a.last_login_at, a.created_at) < now() - make_interval(days => ($1::int - $2::int)))::int AS notice,
            count(*) FILTER (WHERE coalesce(a.last_login_at, a.created_at) < now() - make_interval(days => $1::int))::int AS old
       FROM v_mtr_dormant_pool a`, [s.dormantDays, s.dormantNoticeDays]);
  return {
    view, on: s.dormant, days: s.dormantDays, noticeDays: s.dormantNoticeDays, mail: s.dormantMail,
    counts: c ?? { noticed: 0, dormant: 0, restored30: 0, vault: 0 }, preview: p ?? { notice: 0, old: 0 },
    rows: rows.map(({ email, ...r }) => ({ ...r, email: mtrMaskMail(email) })),
    note: '휴면은 법무 확인이 필요한 회사 선택입니다(2023년 개인정보 보호법 개정으로 「유효기간제」 의무는 없어졌다는 점 — 추가 확인 필요). 켜기 전에 약관 · 처리방침 문구를 게시하십시오.',
  };
}

/** POST /admin/mtr/dormant/{accountId}/wake(SUPER) — 본인 확인 뒤 운영이 풂(사유 · 감사) */
export async function dormantWakeByAdmin(db: DatabaseService, accountId: string, reasonIn: string) {
  mtrText(reasonIn, 5, 200, 'MTR_REASON', '본인 확인 방법과 까닭을 5 ~ 200자로 적어 주십시오.');
  if (!MTR_UUID_RE.test(String(accountId ?? ''))) throw new NotFound('회원을 찾을 수 없습니다.');
  const [a] = await db.query<{ status: string }>(`SELECT status FROM accounts WHERE id = $1::uuid`, [accountId]);
  if (!a) throw new NotFound('회원을 찾을 수 없습니다.');
  if (a.status !== 'DORMANT') throw new StateConflict('MTR_NOT_DORMANT', '휴면 계정이 아닙니다.');
  const ok = await mtrDormantWake(db, accountId, 'ADMIN');
  if (!ok) throw new StateConflict('MTR_NOT_DORMANT', '휴면 계정이 아닙니다.');
  return { ok: true, accountId, note: '휴면을 풀었습니다. 이름 · 전화번호를 되돌렸습니다.' };
}
