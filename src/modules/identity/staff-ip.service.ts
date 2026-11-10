import { Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { AppError, Forbidden, PolicyViolation } from '../../core/errors';
import { Principal, Role } from '../../core/auth';
import { RequestCtx } from '../../core/request-context';
import { TelegramService } from '../../common/telegram/telegram.service';
import { clientIpRaw } from './abuse-guard';
import { OPS_ROLES } from './mfa.service';

/* ---------------------------------------------------------------------
 * v10.226 (D195 · docs/363) — 운영 화면 접속 인증
 *
 *   설정 admin.ip_verify(off · on)가 on 이면 운영 역할만 요구하는 API 는
 *   허용 IP(staff_ip_allow)이거나 그 운영자가 그 IP 로 오늘(한국 날짜) 인증했을 때만 — 아니면 403 IP_VERIFY_REQUIRED(AuthGuard).
 *   인증번호 6자리는 텔레그램으로 — 운영자 개인 대화(staff_access.telegram_chat)가 있으면 그곳, 없으면 운영 대화방(ops.telegram_chat).
 *   번호는 sha256 만 저장 · 5분 · 5번 틀리면 15분 막음 · 1분에 한 번 · 하루 10번. 문자(SMS)는 대행사 연동 뒤 channel 만 더함.
 *   설정은 30초 · 통과 여부는 운영자 · IP 마다 60초 동안 메모리에 둡니다(날이 바뀌면 다시 봄).
 * ------------------------------------------------------------------- */
const CODE_MIN = 5;
const MAX_TRIES = 5;
const LOCK_MIN = 15;
const DAY_MAX = 10;
const SETTING_MS = 30_000;
const PASS_MS = 60_000;

type Channel = 'TELEGRAM_ME' | 'TELEGRAM_OPS';
let setting: { at: number; on: boolean } | null = null;
const passCache = new Map<string, { at: number; day: string }>();
/** 시험 · 설정 저장 뒤 — 바로 다시 읽게 */
export function resetStaffIpCache() { setting = null; passCache.clear(); }

/** 접속자 IP(::ffff: 떼기) — 모르면 null */
export function staffIp(): string | null {
  const v = (clientIpRaw() ?? '').replace(/^::ffff:/, '').trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(v) ? v : null;
}
/** 가린 IP — 1.2.*.* · IPv6 는 앞 두 마디 */
export const maskIp = (ip: string | null) => !ip ? null : ip.includes('.') ? ip.split('.').slice(0, 2).join('.') + '.*.*' : ip.split(':').slice(0, 2).join(':') + ':…';
const kstDay = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const hash = (accountId: string, ip: string, code: string) => createHash('sha256').update(`${accountId}|${ip}|${code}`).digest('hex');

/**
 * 켜기 전 검사(AdminService.updateSetting — admin.ip_verify on) — 텔레그램 봇 토큰 · 모든 운영자의 받을 곳.
 *   받을 곳이 없는 운영자가 있으면 켜는 순간 그 사람이 잠기므로 막습니다. 운영 대화방(ops.telegram_chat)이 있으면 모두 받을 곳이 있음.
 */
export async function assertStaffIpCanTurnOn(db: DatabaseService) {
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    throw new PolicyViolation('IP_VERIFY_NO_TELEGRAM', '텔레그램 봇 토큰이 없어 인증번호를 보낼 수 없습니다 — 외부 연동 › 연동 키에서 먼저 넣으십시오.');
  }
  const [r] = await db.query<{ ops: string; n: number; who: string | null }>(
    `SELECT coalesce((SELECT btrim(value) FROM site_settings WHERE key = 'ops.telegram_chat'), '') AS ops,
            count(*)::int AS n, string_agg(a.email, ', ' ORDER BY a.email) AS who
       FROM accounts a WHERE a.status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role = ANY($1::text[]))
        AND NOT EXISTS (SELECT 1 FROM staff_access s WHERE s.account_id = a.id AND s.telegram_chat IS NOT NULL)`, [OPS_ROLES]);
  if (!r?.ops && r?.n) {
    throw new PolicyViolation('IP_VERIFY_NO_RECEIVER', `인증번호를 받을 곳이 없는 운영자가 ${r.n}명 있습니다(${r.who}) — 운영 대화방(ops.telegram_chat)을 정하거나 각자 개인 대화 번호를 등록한 뒤 켜십시오.`);
  }
}

@Injectable()
export class StaffIpService {
  constructor(private readonly db: DatabaseService, private readonly tg: TelegramService) {}

  async on(): Promise<boolean> {
    if (setting && Date.now() - setting.at < SETTING_MS) return setting.on;
    const [r] = await this.db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'admin.ip_verify'`).catch(() => []);
    setting = { at: Date.now(), on: (r?.v ?? '').trim() === 'on' };
    return setting.on;
  }

  private static isOps(roles: readonly string[]) { return roles.some((r) => OPS_ROLES.includes(r as Role)); }

  /** 허용 IP 이거나 오늘 인증했는가 */
  private async passed(accountId: string, ip: string | null): Promise<boolean> {
    if (!ip) return false;
    const day = kstDay();
    const k = `${accountId}|${ip}`;
    const c = passCache.get(k);
    if (c && c.day === day && Date.now() - c.at < PASS_MS) return true;
    const [r] = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM staff_ip_allow WHERE ip = $2::inet)
           OR EXISTS (SELECT 1 FROM staff_ip_passes WHERE account_id = $1 AND ip = $2::inet AND day = (now() AT TIME ZONE 'Asia/Seoul')::date) AS ok`,
      [accountId, ip]).catch(() => [{ ok: false }]);
    if (r?.ok) passCache.set(k, { at: Date.now(), day });
    return !!r?.ok;
  }

  /** AuthMiddleware — 운영 역할이 있을 때만 설정을 봄(회원 요청은 DB 를 더 부르지 않음) */
  async pending(p: Principal): Promise<boolean> {
    if (!StaffIpService.isOps(p.roles)) return false;
    if (!(await this.on())) return false;
    return !(await this.passed(p.accountId, staffIp()));
  }

  /** 받을 곳 — 개인 대화 · 운영 대화방 · 없음 */
  private async target(accountId: string): Promise<{ channel: Channel; chat: string } | null> {
    const [r] = await this.db.query<{ chat: string | null }>(`SELECT telegram_chat AS chat FROM staff_access WHERE account_id = $1`, [accountId]);
    if (r?.chat) return { channel: 'TELEGRAM_ME', chat: r.chat };
    const ops = await this.tg.chat();
    return ops ? { channel: 'TELEGRAM_OPS', chat: ops } : null;
  }

  /** 내 상태 — 운영 화면이 인증 화면을 보일지 */
  async status(p: Principal) {
    const ip = staffIp();
    const on = await this.on();
    const ops = StaffIpService.isOps(p.roles);
    const t = ops ? await this.target(p.accountId) : null;
    const tg = await this.tg.status();
    return {
      on, required: on && ops, verified: !on || !ops || (await this.passed(p.accountId, ip)), ip: maskIp(ip),
      channel: t?.channel ?? null, ready: !!t && tg.reason !== 'NO_TOKEN',
    };
  }

  /** 인증번호 보내기 */
  async send(p: Principal) {
    if (!StaffIpService.isOps(p.roles)) throw new Forbidden('FORBIDDEN', '운영 계정만 접속 인증을 합니다.');
    const ip = staffIp();
    if (!ip) throw new PolicyViolation('IP_UNKNOWN', '접속한 주소를 알 수 없어 인증할 수 없습니다.');
    const [q] = await this.db.query<{ recent: boolean; today: number; locked: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM staff_ip_codes WHERE account_id = $1 AND created_at > now() - interval '1 minute') AS recent,
              (SELECT count(*)::int FROM staff_ip_codes WHERE account_id = $1 AND (created_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date) AS today,
              EXISTS (SELECT 1 FROM staff_ip_codes WHERE account_id = $1 AND tries >= ${MAX_TRIES} AND created_at > now() - make_interval(mins => ${LOCK_MIN})) AS locked`,
      [p.accountId]);
    if (q?.locked) throw new AppError(423, { code: 'IP_VERIFY_LOCKED', message: `번호가 여러 번 틀려 ${LOCK_MIN}분 동안 막았습니다.` });
    if (q?.recent) throw new AppError(429, { code: 'IP_VERIFY_WAIT', message: '인증번호는 1분에 한 번 보낼 수 있습니다.' });
    if ((q?.today ?? 0) >= DAY_MAX) throw new AppError(429, { code: 'IP_VERIFY_DAY_LIMIT', message: `인증번호는 하루 ${DAY_MAX}번까지 보낼 수 있습니다.` });
    const t = await this.target(p.accountId);
    const tg = await this.tg.status();
    if (!t || tg.reason === 'NO_TOKEN') throw new PolicyViolation('IP_VERIFY_NO_CHANNEL', '인증번호를 받을 곳이 없습니다 — 최고 관리자에게 텔레그램 받을 곳 등록을 요청하십시오.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const [a] = await this.db.query<{ email: string }>(`SELECT email FROM accounts WHERE id = $1`, [p.accountId]);
    const who = t.channel === 'TELEGRAM_OPS' ? ` (${(a?.email ?? '').replace(/^(.{2}).*(@.*)$/, '$1***$2')})` : '';
    const r = await this.tg.send(`[소개뱅크 운영] 접속 인증번호 ${code}${who}\n${CODE_MIN}분 안에 넣으십시오 · 접속 주소 ${maskIp(ip)}\n직접 요청하지 않았다면 최고 관리자에게 알리십시오.`, t.chat);
    if (!r.ok) throw new AppError(502, { code: 'IP_VERIFY_SEND_FAILED', message: '인증번호를 보내지 못했습니다 — 잠시 뒤 다시 시도하십시오.', details: { reason: r.errorKind } });
    await this.db.query(
      `INSERT INTO staff_ip_codes (account_id, ip, code_hash, channel, expires_at) VALUES ($1, $2::inet, $3, $4, now() + make_interval(mins => ${CODE_MIN}))`,
      [p.accountId, ip, hash(p.accountId, ip, code), t.channel]);
    await this.audit('STAFF_IP_CODE_SENT', p.accountId, { ip: maskIp(ip), channel: t.channel });
    return { sent: true, channel: t.channel, minutes: CODE_MIN, ip: maskIp(ip) };
  }

  /** 인증번호 확인 — 맞으면 그 IP 를 오늘 자정까지 */
  async confirm(p: Principal, code: string) {
    const ip = staffIp();
    if (!ip) throw new PolicyViolation('IP_UNKNOWN', '접속한 주소를 알 수 없어 인증할 수 없습니다.');
    const [c] = await this.db.query<{ id: string; code_hash: string; tries: number; channel: Channel }>(
      `SELECT id, code_hash, tries, channel FROM staff_ip_codes
        WHERE account_id = $1 AND ip = $2::inet AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`, [p.accountId, ip]);
    if (!c) throw new AppError(404, { code: 'IP_VERIFY_NO_CODE', message: '유효한 인증번호가 없습니다 — 번호를 다시 받으십시오.' });
    if (c.tries >= MAX_TRIES) throw new AppError(423, { code: 'IP_VERIFY_LOCKED', message: `번호가 여러 번 틀려 ${LOCK_MIN}분 동안 막았습니다.` });
    if (hash(p.accountId, ip, code.trim()) !== c.code_hash) {
      const [u] = await this.db.query<{ tries: number }>(`UPDATE staff_ip_codes SET tries = tries + 1 WHERE id = $1 RETURNING tries`, [c.id]);
      if ((u?.tries ?? 0) >= MAX_TRIES) {
        await this.audit('STAFF_IP_LOCKED', p.accountId, { ip: maskIp(ip), minutes: LOCK_MIN });
        throw new AppError(423, { code: 'IP_VERIFY_LOCKED', message: `번호가 여러 번 틀려 ${LOCK_MIN}분 동안 막았습니다.` });
      }
      throw new AppError(403, { code: 'IP_VERIFY_INVALID', message: '번호가 맞지 않습니다.', details: { attemptsLeft: MAX_TRIES - (u?.tries ?? 0) } });
    }
    await this.db.query(`UPDATE staff_ip_codes SET used_at = now() WHERE id = $1`, [c.id]);
    await this.db.query(
      `INSERT INTO staff_ip_passes (account_id, ip, day, channel) VALUES ($1, $2::inet, (now() AT TIME ZONE 'Asia/Seoul')::date, $3)
       ON CONFLICT DO NOTHING`, [p.accountId, ip, c.channel]);
    passCache.delete(`${p.accountId}|${ip}`);
    await this.audit('STAFF_IP_VERIFIED', p.accountId, { ip: maskIp(ip), channel: c.channel });
    return { verified: true, ip: maskIp(ip), until: `${kstDay()} 24:00 (KST)` };
  }

  /* ── 운영 화면 「접속 인증」 ── */

  /** 한눈에 — 스위치 · 텔레그램 · 허용 IP · 운영자별 받을 곳 · 오늘 인증 · 최근 기록 */
  async overview() {
    const tg = await this.tg.status();
    const allow = await this.db.query(
      `SELECT a.id, host(a.ip) AS ip, a.memo, a.created_at AS "createdAt", c.email AS "createdBy"
         FROM staff_ip_allow a LEFT JOIN accounts c ON c.id = a.created_by ORDER BY a.created_at`);
    const staff = await this.db.query(
      `SELECT a.id, a.email, a.name, array_agg(DISTINCT r.role ORDER BY r.role) AS roles,
              s.telegram_chat IS NOT NULL AS "personalChat",
              (SELECT count(*)::int FROM staff_ip_passes p WHERE p.account_id = a.id AND p.day = (now() AT TIME ZONE 'Asia/Seoul')::date) AS "todayPasses",
              (SELECT max(p.verified_at) FROM staff_ip_passes p WHERE p.account_id = a.id) AS "lastVerifiedAt"
         FROM accounts a JOIN account_roles r ON r.account_id = a.id
         LEFT JOIN staff_access s ON s.account_id = a.id
        WHERE r.role = ANY($1::text[]) AND a.status = 'ACTIVE'
        GROUP BY a.id, a.email, a.name, s.telegram_chat ORDER BY a.email`, [OPS_ROLES]);
    const recent = await this.db.query(
      `SELECT x.at, x.kind, x.email, x.ip, x.channel FROM (
         SELECT p.verified_at AS at, 'VERIFIED' AS kind, a.email, host(p.ip) AS ip, p.channel FROM staff_ip_passes p JOIN accounts a ON a.id = p.account_id
         UNION ALL
         SELECT c.created_at, CASE WHEN c.tries >= ${MAX_TRIES} THEN 'LOCKED' WHEN c.used_at IS NULL AND c.expires_at < now() THEN 'EXPIRED' WHEN c.used_at IS NULL THEN 'SENT' ELSE 'USED' END,
                a.email, host(c.ip), c.channel FROM staff_ip_codes c JOIN accounts a ON a.id = c.account_id
       ) x WHERE x.at > now() - interval '14 days' ORDER BY x.at DESC LIMIT 50`);
    return {
      on: await this.on(), telegram: { ready: tg.ready, reason: tg.reason, opsChat: tg.chat },
      allow, staff: (staff as Array<Record<string, unknown>>).map((s) => ({ ...s, receive: s.personalChat ? 'TELEGRAM_ME' : tg.chat ? 'TELEGRAM_OPS' : null })),
      recent: (recent as Array<{ ip: string } & Record<string, unknown>>).map((r) => ({ ...r, ip: maskIp(r.ip) })),
      myIp: maskIp(staffIp()), myIpFull: staffIp(),
    };
  }

  async addAllow(ip: string, memo: string) {
    const v = ip.trim();
    const [ok] = await this.db.query<{ ok: boolean }>(`SELECT $1::inet IS NOT NULL AND masklen($1::inet) IN (32, 128) AS ok`, [v]).catch(() => [{ ok: false }]);
    if (!ok?.ok) throw new PolicyViolation('IP_FORMAT', 'IP 주소 하나를 넣으십시오(예: 121.168.92.13).');
    const [r] = await this.db.query<{ id: string }>(
      `INSERT INTO staff_ip_allow (ip, memo, created_by) VALUES ($1::inet, $2, $3) ON CONFLICT (ip) DO NOTHING RETURNING id`, [v, memo.trim(), RequestCtx.actorId()]);
    if (!r) throw new AppError(409, { code: 'IP_EXISTS', message: '이미 허용 목록에 있는 IP 입니다.' });
    passCache.clear();
    return { id: r.id, ip: v, memo: memo.trim() };
  }

  async removeAllow(id: string) {
    if (!/^[0-9]{1,18}$/.test(id)) throw new AppError(404, { code: 'IP_NOT_FOUND', message: '허용 목록에 없는 줄입니다.' });
    const [r] = await this.db.query<{ ip: string }>(`DELETE FROM staff_ip_allow WHERE id = $1 RETURNING host(ip) AS ip`, [id]);
    if (!r) throw new AppError(404, { code: 'IP_NOT_FOUND', message: '허용 목록에 없는 줄입니다.' });
    passCache.clear();
    return { removed: true, ip: r.ip };
  }

  /** 받을 곳 — 본인 또는 SUPER · 빈 값이면 지움(운영 대화방으로) */
  async setTelegram(accountId: string, chat: string | null) {
    const c = (chat ?? '').trim() || null;
    if (c && !/^-?[0-9]{5,20}$/.test(c)) throw new PolicyViolation('CHAT_FORMAT', '텔레그램 대화 번호는 숫자(5 ~ 20자리 · 앞에 - 가능)입니다.');
    const [a] = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM account_roles WHERE account_id = $1 AND role = ANY($2::text[])) AS ok`, [accountId, OPS_ROLES]);
    if (!a?.ok) throw new AppError(404, { code: 'STAFF_NOT_FOUND', message: '운영 계정이 아닙니다.' });
    await this.db.query(
      `INSERT INTO staff_access (account_id, telegram_chat, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (account_id) DO UPDATE SET telegram_chat = EXCLUDED.telegram_chat, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [accountId, c, RequestCtx.actorId()]);
    return { accountId, personalChat: !!c };
  }

  /** 받을 곳 시험 — 지금 정해진 곳으로 한 통(번호 없음) */
  async testSend(accountId: string) {
    const t = await this.target(accountId);
    if (!t) throw new PolicyViolation('IP_VERIFY_NO_CHANNEL', '받을 곳이 없습니다.');
    const r = await this.tg.send('[소개뱅크 운영] 접속 인증번호 받을 곳 시험입니다 — 이 글이 보이면 인증번호도 여기로 옵니다.', t.chat);
    return { ok: r.ok, channel: t.channel, reason: r.ok ? null : r.errorKind ?? null };
  }

  /** 감사 기록 — 결과만(번호는 남기지 않음) */
  private audit(action: string, targetId: string, data: Record<string, unknown>) {
    const c = RequestCtx.get();
    return this.db.query(
      `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent)
       VALUES ($1, $2, $3, 'ACCOUNT', $4, $5::jsonb, $6, $7)`,
      [c?.actorId ?? targetId, c?.actorRole ?? null, action, targetId, JSON.stringify(data), c?.ip ?? null, c?.userAgent ?? null],
    ).catch((e) => console.error('[AUDIT_WRITE_FAILED]', action, e.message));
  }
}
