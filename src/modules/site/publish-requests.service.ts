import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { GwanPagesService } from './gwan-pages.service';
import { TelegramService } from '../../common/telegram/telegram.service';
import { MailService } from '../../common/mail/mail.service';
import { pagesBoard } from './pages-board';
import { LAYOUT_KEYS, LAYOUT_SPECS, SiteLayoutsService, cleanLayoutSafe, type LayoutKey } from './site-layouts.service';

/* ---------------------------------------------------------------------
 * v10.711 (D324 · docs/819) 페이지 게시 요청 · 승인
 *   ADMIN 이 초안을 다 고치면 「게시 요청」(꾸밀 페이지 LAYOUT · 관 안 페이지 PAGE · 한 줄 메모) → 운영 알림 PAGE_PUBLISH_REQUEST(INFO)
 *   SUPER 가 페이지 목록 「게시 요청」에서 승인(= 그 초안 게시 · 관 닫힘 · 수정 가능 규칙 그대로) 또는 되돌려 보냄(사유 2자 이상) · 요청한 사람은 철회
 *   요청 때 초안 지문(md5)을 떠 둠 — 그 뒤 초안이 바뀌면 승인 막음(422 PUBLISH_REQ_STALE · 다시 요청) · 같은 페이지에 열린 요청은 하나(DB)
 * ------------------------------------------------------------------- */
const md5 = (v: unknown) => createHash('md5').update(JSON.stringify(v ?? null)).digest('hex');

@Injectable()
export class PublishRequestsService {
  constructor(private readonly db: DatabaseService, private readonly layouts: SiteLayoutsService, private readonly pages: GwanPagesService,
              private readonly telegram: TelegramService, private readonly mail: MailService) {}

  private async sigOf(kind: string, ref: string): Promise<{ sig: string; label: string }> {
    if (kind === 'LAYOUT') {
      const k = String(ref).toUpperCase();
      if (!(LAYOUT_KEYS as readonly string[]).includes(k)) throw new NotFound('없는 페이지입니다.');
      const [r] = await this.db.query<{ draft: unknown }>(`SELECT draft FROM site_layouts WHERE key = $1`, [k]);
      return { sig: md5(cleanLayoutSafe(k as LayoutKey, r?.draft)), label: LAYOUT_SPECS[k as LayoutKey].name };
    }
    if (!/^\d{1,12}$/.test(ref)) throw new NotFound('없는 페이지입니다.');
    const [p] = await this.db.query<{ title: string; draft: unknown; gwan_code: string; slug: string }>(`SELECT title, draft, gwan_code, slug FROM gwan_pages WHERE id = $1`, [Number(ref)]);
    if (!p) throw new NotFound('없는 페이지입니다.');
    return { sig: md5([p.title, p.draft]), label: `${p.gwan_code} ${p.slug === 'home' ? '첫 화면' : `/info/${p.slug}`} 「${p.title}」` };
  }

  async list() {
    const rows = await this.db.query<Record<string, any>>(
      `SELECT r.id::int AS id, r.kind, r.ref, r.note, r.status, r.reason, r.requested_at AS "requestedAt", r.decided_at AS "decidedAt",
              (SELECT name FROM accounts a WHERE a.id = r.requested_by) AS "requestedByName", (SELECT name FROM accounts a WHERE a.id = r.decided_by) AS "decidedByName", r.draft_sig AS sig
         FROM page_publish_requests r WHERE r.status = 'OPEN' OR r.decided_at > now() - interval '30 days' ORDER BY (r.status = 'OPEN') DESC, r.requested_at DESC LIMIT 100`);
    const out = [];
    for (const r of rows) {
      let label = r.ref, stale = false;
      try { const s = await this.sigOf(r.kind, r.ref); label = s.label; stale = r.status === 'OPEN' && s.sig !== r.sig; } catch { /* 지운 페이지 */ }
      const { sig: _s, ...rest } = r;
      out.push({ ...rest, label, stale });
    }
    return out;
  }
  async create(input: { kind: string; ref: string; note?: string }) {
    const kind = input.kind === 'PAGE' ? 'PAGE' : 'LAYOUT';
    const ref = kind === 'LAYOUT' ? String(input.ref).toUpperCase() : String(input.ref);
    const { sig, label } = await this.sigOf(kind, ref);
    const note = String(input.note ?? '').trim().slice(0, 300) || null;
    try {
      const [r] = await this.db.query<{ id: number }>(
        `INSERT INTO page_publish_requests (kind, ref, draft_sig, note, requested_by) VALUES ($1, $2, $3, $4, $5) RETURNING id::int AS id`,
        [kind, ref, sig, note, RequestCtx.actorId() ?? null]);
      await this.db.query(
        `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
         SELECT 'PAGE_PUBLISH_REQUEST', 'INFO', $1::text, $2::jsonb, clock_timestamp() ON CONFLICT DO NOTHING`,
        [`게시 요청 — ${label}${note ? ` · ${note.slice(0, 60)}` : ''} · 관 관리 › 페이지 목록 › 게시 요청`.slice(0, 200), JSON.stringify({ key: `req:${r!.id}`, id: r!.id, kind, ref })]).catch(() => undefined);
      const sent = await this.tell(`[소개뱅크] 게시 요청 — ${label}${note ? `\n메모: ${note}` : ''}\n운영 화면 › 관 관리 › 페이지 목록 › 게시 요청에서 승인하거나 되돌려 보내 주십시오.`);   // v10.725
      return { id: r!.id, kind, ref, label, status: 'OPEN', ...sent };
    } catch (e) {
      if (String((e as Error)?.message).includes('page_publish_req_open_uq')) throw new PolicyViolation('PUBLISH_REQ_OPEN', '이 페이지에는 이미 열린 게시 요청이 있습니다.');
      throw e;
    }
  }
  /** v10.725 (docs/833) 게시 요청 알림 — 텔레그램(대화방이 준비됐을 때) · SUPER 메일(메일이 준비됐을 때) · 못 보내도 요청은 그대로 */
  private async tell(text: string): Promise<{ telegram: boolean; mailed: number }> {
    let telegram = false, mailed = 0;
    await pagesBoard(this.db, text.split('\n')[0]!.replace('[소개뱅크] ', ''), text);   // v10.734 운영자 게시판
    try { telegram = (await this.telegram.send(text)).ok === true; } catch { /* 준비 안 됨 */ }
    try {
      if (await this.mail.ready()) {
        const to = await this.db.query<{ email: string }>(`SELECT DISTINCT a.email::text AS email FROM accounts a JOIN account_roles r ON r.account_id = a.id WHERE r.role = 'SUPER' AND a.email IS NOT NULL LIMIT 5`);
        for (const x of to) { const r = await this.mail.send({ to: x.email, subject: '[소개뱅크] 페이지 게시 요청이 들어왔습니다', text }); if (r.ok) mailed++; }
      }
    } catch { /* 메일 실패는 요청과 상관없음 */ }
    return { telegram, mailed };
  }
  /** v10.737 (D326 · docs/845) 하루 넘게 대기한 요청 — 하루 한 번 다시 알림(텔레그램 · 메일 · 게시판) · 정기 작업 gwan_maint 가 부름 */
  async remind(): Promise<number> {
    const due = await this.db.query<{ id: number; kind: string; ref: string; requested_at: string }>(
      `SELECT id::int AS id, kind, ref, requested_at FROM page_publish_requests WHERE status = 'OPEN' AND requested_at < now() - interval '1 day'
          AND (reminded_at IS NULL OR reminded_at < now() - interval '1 day') ORDER BY requested_at LIMIT 10`);
    for (const r of due) {
      const [u] = await this.db.query(`UPDATE page_publish_requests SET reminded_at = now() WHERE id = $1 AND (reminded_at IS NULL OR reminded_at < now() - interval '1 day') RETURNING id`, [r.id]);
      if (!u) continue;
      let label = r.ref; try { label = (await this.sigOf(r.kind, r.ref)).label; } catch { /* 지운 페이지 */ }
      await this.tell(`[소개뱅크] 게시 요청이 하루 넘게 기다립니다 — ${label}(${String(r.requested_at).slice(0, 16)} UTC 요청)\n운영 화면 › 관 관리 › 페이지 목록 › 게시 요청`);
    }
    return due.length;
  }
  private async openOne(id: number) {
    const [r] = await this.db.query<{ kind: string; ref: string; draft_sig: string; requested_by: string | null; status: string }>(
      `SELECT kind, ref, draft_sig, requested_by, status FROM page_publish_requests WHERE id = $1`, [id]);
    if (!r) throw new NotFound('없는 게시 요청입니다.');
    if (r.status !== 'OPEN') throw new PolicyViolation('PUBLISH_REQ_STATE', '이미 끝난 게시 요청입니다.');
    return r;
  }
  /** 승인(SUPER) = 요청 때 초안 그대로 게시 — 초안이 바뀌었으면 422 PUBLISH_REQ_STALE */
  async approve(id: number) {
    const r = await this.openOne(id);
    const { sig } = await this.sigOf(r.kind, r.ref);
    if (sig !== r.draft_sig) throw new PolicyViolation('PUBLISH_REQ_STALE', '요청한 뒤 초안이 바뀌었습니다 — 되돌려 보내고 다시 요청을 받으십시오.');
    if (r.kind === 'LAYOUT') await this.layouts.publish(r.ref); else await this.pages.publish(Number(r.ref));   // 수정 가능 · 관 닫힘 규칙은 게시가 봄
    await this.db.query(`UPDATE page_publish_requests SET status = 'APPROVED', decided_by = $2, decided_at = now() WHERE id = $1 AND status = 'OPEN'`, [id, RequestCtx.actorId() ?? null]);
    await pagesBoard(this.db, `게시 요청 승인 — ${(await this.sigOf(r.kind, r.ref)).label}`);   // v10.734
    return { id, status: 'APPROVED' };
  }
  async reject(id: number, reason: string) {
    await this.openOne(id);
    const why = String(reason ?? '').trim();
    if (why.length < 2) throw new PolicyViolation('PUBLISH_REQ_REASON', '되돌려 보내는 사유를 2자 이상 적으십시오.');
    await this.db.query(`UPDATE page_publish_requests SET status = 'REJECTED', reason = $2, decided_by = $3, decided_at = now() WHERE id = $1 AND status = 'OPEN'`, [id, why.slice(0, 300), RequestCtx.actorId() ?? null]);
    await pagesBoard(this.db, `게시 요청 되돌려 보냄 — #${id} · ${why.slice(0, 80)}`);   // v10.734
    return { id, status: 'REJECTED' };
  }
  /** 철회 — 요청한 사람 또는 SUPER */
  async withdraw(id: number) {
    const r = await this.openOne(id);
    const me = RequestCtx.actorId() ?? null;
    const [sup] = me ? await this.db.query(`SELECT 1 FROM account_roles WHERE account_id = $1 AND role = 'SUPER'`, [me]) : [];
    if (r.requested_by !== me && !sup) throw new Forbidden('FORBIDDEN', '요청한 사람만 철회합니다.');
    await this.db.query(`UPDATE page_publish_requests SET status = 'WITHDRAWN', decided_by = $2, decided_at = now() WHERE id = $1 AND status = 'OPEN'`, [id, me]);
    return { id, status: 'WITHDRAWN' };
  }
}
