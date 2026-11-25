import { createHash, randomBytes } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.800 (D334 · docs/916) ERP 연결 ② — ERP → 소개뱅크 쓰기 길 · 로그인 넘겨주기
 *
 *   ① 운영 알림  POST /internal/erp/alerts  — ERP 코드가 쓰던 ops_alerts INSERT 82곳을 이 길 하나로(설계서 4-4)
 *        mode RAISE(같은 시각 겹침만 막음 · clock_timestamp) · ONCE(풀리지 않은 같은 알림이 있으면 안 올림) · RESOLVE(풀림 표시)
 *        알림 종류는 ERP 업무 앞마디만(ACCT_ · HR_ · HRA_ · HRX_ · OFC_ · QLT_ · LGL_ · ITS_ · PRR_ · SAL_ · ERP_ · TRD_) — 소개뱅크 알림을 흉내 내지 못하게
 *   ② 회원 알림  POST /internal/erp/notify  — 급여 명세 · 결재 요청 등 화면 알림(notifications) · 받는 사람은 쓰는 계정만 · 링크는 / 또는 https://erp. 로만
 *   ③ 넘겨주기  운영 화면 POST /admin/erp/handoff(운영자 · 2단계 확인 뒤) → 60초 · 한 번 코드 → ERP 서버 POST /internal/erp/handoff/redeem → 같은 기기 줄(sid) · 같은 2단계 시각으로 새 증표
 *        코드는 해시만 저장 · 원문은 ERP 주소(#code=)에만 잠깐
 * ------------------------------------------------------------------- */

export const ERP_ALERT_RE = /^(ACCT|HR|HRA|HRX|OFC|QLT|LGL|ITS|PRR|SAL|ERP|TRD)_[A-Z0-9_]{1,40}$/;
export const HANDOFF_SEC = 60;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export async function erpAlert(db: DatabaseService, dto: { code: string; severity?: string; title?: string; detail?: unknown; mode?: string; note?: string }) {
  const code = String(dto.code ?? '');
  if (!ERP_ALERT_RE.test(code)) throw new PolicyViolation('ERP_ALERT_CODE', 'ERP 업무 알림 종류만 올릴 수 있습니다.');
  const mode = dto.mode ?? 'RAISE';
  if (mode === 'RESOLVE') {
    const rows = await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2 WHERE alert_code = $1 AND resolved_at IS NULL RETURNING id`,
      [code, String(dto.note ?? 'ERP 에서 풀림').slice(0, 200)]);
    return { ok: true, resolved: rows.length };
  }
  const sev = ['INFO', 'WARN', 'CRITICAL'].includes(String(dto.severity)) ? String(dto.severity) : 'WARN';
  const title = String(dto.title ?? '').trim();
  if (!title || title.length > 200) throw new PolicyViolation('ERP_ALERT_TITLE', '알림 제목은 1 ~ 200자입니다.');
  const detail = JSON.stringify(dto.detail ?? {});
  if (detail.length > 4000) throw new PolicyViolation('ERP_ALERT_DETAIL', '알림 내용이 너무 깁니다(4,000자).');
  const once = mode === 'ONCE' ? `AND NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = $1 AND resolved_at IS NULL)` : '';
  const rows = await db.query<{ id: number }>(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     SELECT $1, $2, $3, $4::jsonb, clock_timestamp() WHERE TRUE ${once}
     ON CONFLICT DO NOTHING RETURNING id`, [code, sev, title, detail]);
  return { ok: true, raised: rows.length, id: rows[0]?.id ?? null };
}

export async function erpNotify(db: DatabaseService, dto: { accountId: string; kind: string; title: string; body: string; link?: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(dto.accountId))) throw new NotFound('받는 계정이 없습니다.');
  const kind = String(dto.kind ?? '');
  if (!/^ERP_[A-Z0-9_]{2,40}$/.test(kind)) throw new PolicyViolation('ERP_NOTIFY_KIND', '알림 종류는 ERP_ 로 시작해야 합니다.');
  const link = dto.link ? String(dto.link) : null;
  if (link && !(/^\/[^/\\]/.test(link) || /^https:\/\/erp\.sogaebank\.com\//.test(link)) || (link && link.length > 300)) {
    throw new PolicyViolation('ERP_NOTIFY_LINK', '링크는 / 로 시작하는 주소나 ERP 주소만 됩니다.');
  }
  const [a] = await db.query<{ id: string }>(`SELECT id FROM accounts WHERE id = $1 AND status = 'ACTIVE'`, [dto.accountId]);
  if (!a) throw new NotFound('받는 계정이 없습니다.');
  const [row] = await db.query<{ id: number }>(
    `INSERT INTO notifications (account_id, event_code, title, body, link_url) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [a.id, kind, String(dto.title).slice(0, 200), String(dto.body).slice(0, 2000), link]);
  return { ok: true, id: row.id };
}

/** 운영 화면 「ERP 열기」 — 운영자 · 2단계 확인 뒤(컨트롤러 @Roles 가 봄) · 60초 · 한 번 */
export async function createHandoff(db: DatabaseService, accountId: string, sid: string | undefined, mfaAt: number | undefined) {
  await db.query(`DELETE FROM erp_handoff_codes WHERE expires_at < now() - interval '1 day'`);
  const code = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO erp_handoff_codes (code_hash, account_id, session_id, mfa_at, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [sha(code), accountId, sid ?? null, mfaAt ?? null, HANDOFF_SEC]);
  const base = (process.env.ERP_WEB_URL ?? '').replace(/\/+$/, '');
  return { code, expiresIn: HANDOFF_SEC, url: base ? `${base}/#/handoff?code=${encodeURIComponent(code)}` : null };
}

/** ERP 서버(서비스 토큰) — 코드를 한 번만 바꿔 줌 · 계정 · 기기 줄 · 2단계 시각을 돌려줌(증표 발급은 컨트롤러가 AuthService.issue) */
export async function redeemHandoff(db: DatabaseService, code: string) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(String(code ?? ''))) throw new NotFound('넘겨주기 코드가 없습니다.');
  const [r] = await db.query<{ account_id: string; session_id: string | null; mfa_at: number | null; live: boolean }>(
    `UPDATE erp_handoff_codes SET used_at = now()
      WHERE code_hash = $1 AND used_at IS NULL
      RETURNING account_id, session_id, mfa_at, (expires_at > now()) AS live`, [sha(code)]);
  if (!r) throw new NotFound('넘겨주기 코드가 없거나 이미 썼습니다.');
  if (!r.live) throw new StateConflict('ERP_HANDOFF_EXPIRED', '넘겨주기 코드 시간(60초)이 지났습니다 — 운영 화면에서 다시 여십시오.');
  return { accountId: r.account_id, sid: r.session_id ?? undefined, mfaAt: r.mfa_at ?? undefined };
}
