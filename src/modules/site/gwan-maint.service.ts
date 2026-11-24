import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { GwanPagesService } from './gwan-pages.service';
import { SiteLayoutsService } from './site-layouts.service';
import { pagesBoard } from './pages-board';
import { PublishRequestsService } from './publish-requests.service';

/* ---------------------------------------------------------------------
 * v10.706 · v10.707 (D323 · docs/814 · 815) 관 점검 시간 예약 · 닫힌 관 손님 안내
 *   대표 11/24 「관이 열려 있는 상태에서 변경 불가 · 관을 닫고 수정」 뒤 다음개발 「관 점검 시간 예약」 —
 *   SUPER 가 관마다 시작 · 끝(최대 2시간) · 손님 안내 글을 예약 → 정기 작업 gwan_maint(1분마다)가
 *   ① 시작 시각: 관이 열려 있으면 닫음(was_open = true) · 닫혀 있으면 그대로(was_open = false)
 *   ② 사이: 시각이 된 예약 게시(꾸밀 페이지 · 관 안 페이지)를 내보냄(관이 닫혀 있어야 나감 — docs/809 · 813)
 *   ③ 끝 시각: 한 번 더 예약 게시를 내보낸 뒤, 열려 있던 관만 다시 엶 · 못 열면 운영 알림 GWAN_MAINT_REOPEN_FAIL(WARN)
 *   손님 안내 — 공개 GET /gwans/{code}/maintenance 가 지금 점검 중이면 끝 시각 · 글(사용자 웹이 관 화면 대신 안내)
 * ------------------------------------------------------------------- */

const COLS = `m.id::int AS id, m.gwan_code AS "gwanCode", g.name AS "gwanName", m.starts_at AS "startsAt", m.ends_at AS "endsAt", m.note,
  m.created_at AS "createdAt", (SELECT name FROM accounts a WHERE a.id = m.created_by) AS "createdByName",
  m.announce, m.notice_id::text AS "noticeId", m.notice_lead_min AS "noticeLeadMin",
  m.was_open AS "wasOpen", m.closed_at AS "closedAt", m.reopened_at AS "reopenedAt", m.reopen_error AS "reopenError", m.canceled_at AS "canceledAt",
  CASE WHEN m.canceled_at IS NOT NULL THEN 'CANCELED' WHEN m.reopened_at IS NOT NULL THEN 'DONE' WHEN m.closed_at IS NOT NULL THEN 'RUNNING' ELSE 'SCHEDULED' END AS status`;

@Injectable()
export class GwanMaintService {
  constructor(private readonly db: DatabaseService, private readonly pages: GwanPagesService, private readonly layouts: SiteLayoutsService,
              private readonly requests: PublishRequestsService) {}

  async list(code?: string) {
    return this.db.query(
      `SELECT ${COLS} FROM gwan_maintenances m JOIN gwans g ON g.code = m.gwan_code
        WHERE ($1::text IS NULL OR m.gwan_code = $1) AND (m.reopened_at IS NULL OR m.reopened_at > now() - interval '30 days')
        ORDER BY (m.reopened_at IS NULL AND m.canceled_at IS NULL) DESC, m.starts_at DESC LIMIT 100`, [code ?? null]);
  }
  private async one(id: number) {
    const [r] = await this.db.query(`SELECT ${COLS} FROM gwan_maintenances m JOIN gwans g ON g.code = m.gwan_code WHERE m.id = $1`, [id]);
    if (!r) throw new NotFound('없는 점검 시간입니다.');
    return r;
  }
  async create(input: { gwanCode: string; startsAt: string; endsAt: string; note?: string; announce?: boolean; notifyMembers?: boolean; noticeLeadMin?: number }) {
    const [g] = await this.db.query<{ is_hub: boolean; name: string }>(`SELECT is_hub, name FROM gwans WHERE code = $1`, [input.gwanCode]);
    if (!g) throw new NotFound('없는 관입니다.');
    const s = new Date(input.startsAt), e = new Date(input.endsAt), now = Date.now();
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) throw new PolicyViolation('GWAN_MAINT_TIME', '시각 모양이 맞지 않습니다.');
    if (s.getTime() < now - 60_000 || s.getTime() > now + 90 * 86_400_000) throw new PolicyViolation('GWAN_MAINT_TIME', '시작은 지금부터 90일 안이어야 합니다.');
    if (e.getTime() <= s.getTime() || e.getTime() - s.getTime() > 2 * 3_600_000) throw new PolicyViolation('GWAN_MAINT_TIME', '끝은 시작 뒤 2시간 안이어야 합니다.');
    const note = String(input.note ?? '').trim();
    if (note.length > 200 || /<\s*\/?\s*[a-z!]/i.test(note)) throw new PolicyViolation('GWAN_MAINT_TIME', '안내 글은 200자까지 · HTML 태그는 쓸 수 없습니다.');
    try {
      const id = await this.db.transaction(async () => {
        const [r] = await this.db.query<{ id: number }>(
          `INSERT INTO gwan_maintenances (gwan_code, starts_at, ends_at, note, created_by, announce, notice_lead_min) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::int AS id`,
          [input.gwanCode, s.toISOString(), e.toISOString(), note || null, RequestCtx.actorId() ?? null, input.announce === true, [60, 1440].includes(Number(input.noticeLeadMin)) ? Number(input.noticeLeadMin) : 0]);
        /* v10.710 (D324 · docs/818) 손님 미리 알림 — 상단 고정 공지(메인 공지 띠 · 소개광장 › 공지) · 지금부터 점검 끝까지 · 「회원 알림도」면 공지 알림 길(notify) */
        if (input.announce === true) {
          const k = (d: Date) => { const x = new Date(d.getTime() + 9 * 3_600_000); return `${x.getUTCMonth() + 1}/${x.getUTCDate()} ${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}`; };
          const title = `[점검 안내] ${g.name} ${k(s)} ~ ${k(e).slice(-5)}(한국 시각)`.slice(0, 120);
          const body = `${g.name}이(가) ${k(s)}부터 ${k(e)}까지(한국 시각) 잠시 점검합니다. 이 시간에는 ${g.name} 화면이 열리지 않습니다.${note ? `\n\n${note}` : ''}`;
          const [n] = await this.db.query<{ id: string }>(
            `INSERT INTO notices (gwan_code, title, body, is_pinned, published_at, ends_at, author_id, grades, notify, notify_code) VALUES ($1, $2, $3, true, CASE WHEN $8::int = 0 THEN now() ELSE greatest(now(), $7::timestamptz - make_interval(mins => $8)) END, $4, $5, ARRAY['PUBLIC'], $6, 'GWAN_MAINT') RETURNING id::text AS id`,
            [input.gwanCode, title, body, e.toISOString(), RequestCtx.actorId() ?? null, input.notifyMembers === true, s.toISOString(), [60, 1440].includes(Number(input.noticeLeadMin)) ? Number(input.noticeLeadMin) : 0]);   // v10.748 (D327) 공지 올리는 때 · 0 = 예약 즉시(지금)
          await this.db.query(`UPDATE gwan_maintenances SET notice_id = $2::uuid WHERE id = $1`, [r!.id, n!.id]);
        }
        return r!.id;
      });
      return this.one(id);
    } catch (err) {
      if (String((err as Error)?.message).includes('GWAN_MAINT_OVERLAP')) throw new PolicyViolation('GWAN_MAINT_OVERLAP', '같은 관에 겹치는 점검 시간이 있습니다.');
      throw err;
    }
  }
  /** 시작 전 취소(SUPER) */
  async cancel(id: number) {
    const [r] = await this.db.query(`UPDATE gwan_maintenances SET canceled_at = now(), canceled_by = $2 WHERE id = $1 AND closed_at IS NULL AND canceled_at IS NULL RETURNING id`, [id, RequestCtx.actorId() ?? null]);
    if (!r) throw new PolicyViolation('GWAN_MAINT_STATE', '시작 전인 점검만 취소합니다 — 점검 중이면 「지금 끝내기」를 쓰십시오.');
    await this.dropNotice(id, '점검 취소');   // v10.710
    return this.one(id);
  }
  /** 점검 중 지금 끝내기(SUPER) — 끝 시각을 지금으로 · 다음 차례(1분 안)에 다시 엶 · 바로 한 번 돌림 */
  async end(id: number) {
    const [r] = await this.db.query(`UPDATE gwan_maintenances SET ends_at = greatest(starts_at + interval '1 second', now()) WHERE id = $1 AND closed_at IS NOT NULL AND reopened_at IS NULL RETURNING id`, [id]);
    if (!r) throw new PolicyViolation('GWAN_MAINT_STATE', '점검 중인 것만 끝냅니다.');
    await this.tick();
    await this.dropNotice(id, '점검 일찍 끝남');   // v10.710
    return this.one(id);
  }
  /** 공개 — 지금 점검 중이면 끝 시각 · 글 · 다음 점검(48시간 안) */
  async publicStatus(code: string) {
    const [now] = await this.db.query(
      `SELECT starts_at AS "startsAt", ends_at AS "endsAt", note FROM gwan_maintenances
        WHERE gwan_code = $1 AND canceled_at IS NULL AND closed_at IS NOT NULL AND reopened_at IS NULL ORDER BY starts_at LIMIT 1`, [code]);
    const [next] = await this.db.query(
      `SELECT starts_at AS "startsAt", ends_at AS "endsAt", note FROM gwan_maintenances
        WHERE gwan_code = $1 AND canceled_at IS NULL AND closed_at IS NULL AND starts_at > now() AND starts_at < now() + interval '48 hours' ORDER BY starts_at LIMIT 1`, [code]);
    return { gwanCode: code, running: now ?? null, next: next ?? null };
  }

  /** v10.710 미리 알림 공지를 지금 내림(이미 끝났으면 그대로) */
  private async dropNotice(id: number, why: string) {
    await this.db.query(
      `UPDATE notices n SET ends_at = greatest(now(), n.published_at + interval '1 second'), ended_reason = $2, ended_by = $3
         FROM gwan_maintenances m WHERE m.id = $1 AND n.id = m.notice_id AND (n.ends_at IS NULL OR n.ends_at > now())`, [id, why, RequestCtx.actorId() ?? null]).catch(() => undefined);
  }
  private async note(code: string, severity: 'INFO' | 'WARN', title: string, key: string, detail: Record<string, unknown>) {
    await this.db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT $1::text, $2::text, $3::text, $4::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = $1::text AND a.detail->>'key' = $5::text)
       ON CONFLICT DO NOTHING`, [code, severity, title.slice(0, 200), JSON.stringify({ ...detail, key }), key]).catch(() => undefined);
    await pagesBoard(this.db, title);   // v10.734 운영자 게시판
  }
  /** 정기 작업 gwan_maint(1분마다) */
  async tick(): Promise<{ closed: number; reopened: number; published: number; failed: number; made: number }> {
    let closed = 0, reopened = 0, published = 0, failed = 0;
    const made = await this.fillRepeats().catch(() => 0);   // v10.721 반복 점검을 7일 앞까지
    await this.requests.remind().catch(() => 0);   // v10.737 하루 넘은 게시 요청 다시 알림
    const start = await this.db.query<{ id: number; gwan_code: string; ends_at: string }>(
      `SELECT id::int AS id, gwan_code, ends_at FROM gwan_maintenances WHERE canceled_at IS NULL AND closed_at IS NULL AND starts_at <= now() ORDER BY starts_at LIMIT 20`);
    for (const m of start) {
      const ok = await this.db.transaction(async () => {
        const [g] = await this.db.query<{ is_active: boolean }>(`SELECT is_active FROM gwans WHERE code = $1 FOR UPDATE`, [m.gwan_code]);
        const [row] = await this.db.query(`UPDATE gwan_maintenances SET closed_at = now(), was_open = $2 WHERE id = $1 AND closed_at IS NULL RETURNING id`, [m.id, g?.is_active === true]);
        if (!row) return false;
        if (g?.is_active) {
          await this.db.query(`UPDATE gwans SET is_active = false WHERE code = $1`, [m.gwan_code]);
          await this.db.query(`INSERT INTO gwan_open_log (gwan_code, opened, source, maint_id) VALUES ($1, false, 'MAINT', $2)`, [m.gwan_code, m.id]);   // v10.727
        }
        return true;
      });
      if (ok) { closed++; await this.note('GWAN_MAINT_START', 'INFO', `관 점검 시작 — ${m.gwan_code} · 끝 ${String(m.ends_at).slice(0, 16)} UTC`, `start:${m.id}`, { id: m.id, gwan: m.gwan_code }); }
    }
    const pub = async () => {
      try { published += await this.layouts.publishDue(); } catch { /* 다음 차례 */ }
      try { published += await this.pages.publishDue(); } catch { /* 다음 차례 */ }
    };
    await pub();
    const done = await this.db.query<{ id: number; gwan_code: string; was_open: boolean }>(
      `SELECT id::int AS id, gwan_code, was_open FROM gwan_maintenances WHERE canceled_at IS NULL AND closed_at IS NOT NULL AND reopened_at IS NULL AND ends_at <= now() ORDER BY ends_at LIMIT 20`);
    if (done.length) await pub();
    for (const m of done) {
      let err: string | null = null;
      if (m.was_open) {
        try {
          const up = await this.db.query(`UPDATE gwans SET is_active = true WHERE code = $1 AND NOT is_active RETURNING code`, [m.gwan_code]);
          if (up.length) await this.db.query(`INSERT INTO gwan_open_log (gwan_code, opened, source, maint_id) VALUES ($1, true, 'MAINT', $2)`, [m.gwan_code, m.id]);   // v10.727
        }
        catch (e) { err = String((e as Error).message).slice(0, 300); }
      }
      await this.db.query(`UPDATE gwan_maintenances SET reopened_at = now(), reopen_error = $2 WHERE id = $1 AND reopened_at IS NULL`, [m.id, err]);
      if (err) { failed++; await this.note('GWAN_MAINT_REOPEN_FAIL', 'WARN', `관 점검 뒤 다시 열지 못함 — ${m.gwan_code} · 관 관리 › 관 설정에서 여십시오 · ${err.slice(0, 80)}`, `fail:${m.id}`, { id: m.id, gwan: m.gwan_code, error: err }); }
      else { reopened++; if (m.was_open) await this.siteCheck(m.id, m.gwan_code); await this.note('GWAN_MAINT_END', 'INFO', `관 점검 끝 — ${m.gwan_code}${m.was_open ? ' · 다시 엶' : ' · 원래 닫힌 관이라 그대로'}`, `end:${m.id}`, { id: m.id, gwan: m.gwan_code, reopened: m.was_open }); }
    }
    return { closed, reopened, published, failed, made };
  }

  /* ── v10.721 (D325 · docs/829) 점검 시간 반복 — 요일 · 한국 시각 · 길이 · 7일 앞까지 점검을 만들어 둠(겹치거나 이미 있으면 건너뜀) ── */
  async repeats() {
    return this.db.query(
      `SELECT r.id::int AS id, r.gwan_code AS "gwanCode", g.name AS "gwanName", r.dow, to_char(r.at_kst, 'HH24:MI') AS "atKst", r.minutes, r.note, r.announce, r.is_active AS "isActive",
              (SELECT name FROM accounts a WHERE a.id = r.created_by) AS "createdByName", r.created_at AS "createdAt"
         FROM gwan_maint_repeats r JOIN gwans g ON g.code = r.gwan_code ORDER BY r.is_active DESC, r.gwan_code, r.dow, r.at_kst`);
  }
  async createRepeat(input: { gwanCode: string; dow: number; atKst: string; minutes: number; note?: string; announce?: boolean }) {
    const [g] = await this.db.query(`SELECT code FROM gwans WHERE code = $1`, [input.gwanCode]);
    if (!g) throw new NotFound('없는 관입니다.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.atKst)) throw new PolicyViolation('GWAN_MAINT_TIME', '시각 모양이 맞지 않습니다.');
    const note = String(input.note ?? '').trim();
    if (note.length > 200 || /<\s*\/?\s*[a-z!]/i.test(note)) throw new PolicyViolation('GWAN_MAINT_TIME', '안내 글은 200자까지 · HTML 태그는 쓸 수 없습니다.');
    const [r] = await this.db.query<{ id: number }>(
      `INSERT INTO gwan_maint_repeats (gwan_code, dow, at_kst, minutes, note, announce, created_by) VALUES ($1, $2, $3::time, $4, $5, $6, $7) RETURNING id::int AS id`,
      [input.gwanCode, input.dow, input.atKst, input.minutes, note || null, input.announce === true, RequestCtx.actorId() ?? null]);
    await this.fillRepeats();
    return { id: r!.id };
  }
  async stopRepeat(id: number) {
    const [r] = await this.db.query(`UPDATE gwan_maint_repeats SET is_active = false WHERE id = $1 AND is_active RETURNING id`, [id]);
    if (!r) throw new PolicyViolation('GWAN_MAINT_STATE', '없거나 이미 멈춘 반복입니다.');
    await this.db.query(`UPDATE gwan_maintenances SET canceled_at = now(), canceled_by = $2 WHERE repeat_id = $1 AND closed_at IS NULL AND canceled_at IS NULL`, [id, RequestCtx.actorId() ?? null]);   // 아직 시작 안 한 것은 취소
    return { id, stopped: true };
  }
  private async fillRepeats(): Promise<number> {
    const reps = await this.db.query<{ id: number; gwan_code: string; dow: number; at_kst: string; minutes: number; note: string | null; announce: boolean; created_by: string | null }>(
      `SELECT id::int AS id, gwan_code, dow, to_char(at_kst, 'HH24:MI') AS at_kst, minutes, note, announce, created_by FROM gwan_maint_repeats WHERE is_active`);
    let n = 0;
    const nowKst = new Date(Date.now() + 9 * 3_600_000);
    for (const r of reps) {
      for (let d = 0; d <= 7; d++) {
        const day = new Date(Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate() + d));
        if (day.getUTCDay() !== r.dow) continue;
        const [hh, mm] = r.at_kst.split(':').map(Number);
        const start = new Date(day.getTime() + ((hh! * 60 + mm!) - 9 * 60) * 60_000);   // 한국 시각 → UTC
        if (start.getTime() < Date.now() + 5 * 60_000) continue;
        const end = new Date(start.getTime() + r.minutes * 60_000);
        try {
          const ins = await this.db.query(
            `INSERT INTO gwan_maintenances (gwan_code, starts_at, ends_at, note, created_by, announce, repeat_id) VALUES ($1, $2, $3, $4, $5, false, $6)
             ON CONFLICT (repeat_id, starts_at) WHERE repeat_id IS NOT NULL DO NOTHING RETURNING id`,
            [r.gwan_code, start.toISOString(), end.toISOString(), r.note, r.created_by, r.id]);
          n += ins.length;
        } catch { /* 겹치는 점검이 있으면 건너뜀(GWAN_MAINT_OVERLAP) */ }
      }
    }
    return n;
  }

  /** v10.740 (D326 · docs/848) 점검 끝나 다시 연 뒤 사용자 웹 관 첫 화면을 한 번 열어 봄(200 이면 INFO · 아니면 WARN) — 사이트 안쪽 주소 SITE_INTERNAL_URL(없으면 127.0.0.1:5174) */
  private async siteCheck(id: number, code: string) {
    const fixed: Record<string, string> = { MNY: 'money', MAL: 'mall', BIZ: 'biz', HLT: 'health', LED: 'lead', EARN: 'earn' };
    const path = '/' + (fixed[code] ?? `g/${code.toLowerCase()}`);
    const base = (process.env.SITE_INTERNAL_URL || 'http://127.0.0.1:5174').replace(/\/$/, '');
    let status = 0, why = '';
    try {
      const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 15_000);
      try { status = (await fetch(base + path, { signal: ac.signal, redirect: 'manual' })).status; } finally { clearTimeout(tm); }
    } catch (e) { why = String((e as Error)?.name ?? 'error'); }
    const ok = status === 200;
    await this.note(ok ? 'GWAN_MAINT_SITE_OK' : 'GWAN_MAINT_SITE_FAIL', ok ? 'INFO' : 'WARN',
      ok ? `관 점검 뒤 화면 확인 — ${code} ${path} 200` : `관 점검 뒤 화면이 열리지 않음 — ${code} ${path} · ${status || why} · 사용자 웹에서 직접 확인하십시오`, `site:${id}`, { id, gwan: code, path, status });
    return { status };
  }

  /** v10.750 (D327 · docs/858) 게시된 페이지 깨진 링크 — 정기 작업 page_link_check(매일 05:10) · 사이트 안 링크(/…)만 · 최대 200 · 404 면 운영 알림 PAGE_LINK_BROKEN(WARN · 날마다 한 번) */
  async linkCheck(): Promise<{ checked: number; broken: Array<{ url: string; status: number; where: string }> }> {
    const found = new Map<string, string>();
    const take = (blocks: unknown, where: string) => {
      const walk = (o: unknown) => {
        if (Array.isArray(o)) { o.forEach(walk); return; }
        if (!o || typeof o !== 'object') return;
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          if (typeof v === 'string') {
            if ((k === 'href' || k === 'src') && /^\/(?!\/)/.test(v) && !found.has(v.split('#')[0]!)) found.set(v.split('#')[0]!, where);
            if (k === 'body') for (const m of v.matchAll(/\]\((\/(?!\/)[^)\s]*)\)/g)) if (!found.has(m[1]!.split('#')[0]!)) found.set(m[1]!.split('#')[0]!, where);
          } else walk(v);
        }
      };
      walk(blocks);
    };
    const pgs = await this.db.query<{ gwan_code: string; slug: string; blocks: unknown }>(
      `SELECT p.gwan_code, p.slug, v.blocks FROM gwan_pages p JOIN gwan_page_versions v ON v.page_id = p.id AND v.version = p.published_version WHERE p.status = 'PUBLISHED' LIMIT 500`);
    for (const p of pgs) take(p.blocks, `${p.gwan_code} ${p.slug === 'home' ? '첫 화면' : `/info/${p.slug}`}`);
    const lays = await this.db.query<{ key: string; published: { inserts?: unknown; slides?: unknown } | null }>(`SELECT key, published FROM site_layouts WHERE published IS NOT NULL`);
    for (const l of lays) { take(l.published?.inserts, `꾸밀 페이지 ${l.key}`); take(l.published?.slides, `꾸밀 페이지 ${l.key} 안내 장`); }
    const urls = [...found.entries()].filter(([u]) => !u.startsWith('/api/')).slice(0, 200);   // 그림(/api/v1/…)은 파일 쪽이라 뺌
    const base = (process.env.SITE_INTERNAL_URL || 'http://127.0.0.1:5174').replace(/\/$/, '');
    const broken: Array<{ url: string; status: number; where: string }> = [];
    for (const [u, where] of urls) {
      try {
        const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 10_000);
        try { const st = (await fetch(base + u, { signal: ac.signal, redirect: 'manual' })).status; if (st === 404) broken.push({ url: u, status: st, where }); } finally { clearTimeout(tm); }
      } catch { /* 사이트가 안 닿으면 깨진 링크로 세지 않음(사이트 문제는 다른 알림) */ }
    }
    if (broken.length) {
      const day = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
      await this.note('PAGE_LINK_BROKEN', 'WARN', `깨진 링크 ${broken.length}개 — ${broken.slice(0, 3).map((b) => `${b.where} ${b.url}`).join(' · ')}${broken.length > 3 ? ' …' : ''}`, `links:${day}`, { broken: broken.slice(0, 50) });
    }
    return { checked: urls.length, broken };
  }

  /** v10.727 (D325 · docs/835) 관 열기 · 닫기 기록 — 최근 200줄 */
  async openLog(code?: string) {
    return this.db.query(
      `SELECT l.id::int AS id, l.gwan_code AS "gwanCode", g.name AS "gwanName", l.opened, l.source, (SELECT name FROM accounts a WHERE a.id = l.by) AS "byName", l.maint_id::int AS "maintId", l.at
         FROM gwan_open_log l JOIN gwans g ON g.code = l.gwan_code WHERE ($1::text IS NULL OR l.gwan_code = $1) ORDER BY l.at DESC, l.id DESC LIMIT 200`, [code ?? null]);
  }
}

/** v10.713 (docs/821) 관 점검 기록 — 월보 한 줄(그 달에 시작한 점검 · 취소 뺌) */
export async function maintLine(db: DatabaseService, from: string, to: string): Promise<{ text: string; failed: number } | null> {
  const [r] = await db.query<{ n: number; gw: number; minutes: number; failed: number; open: number }>(
    `SELECT count(*)::int AS n, count(DISTINCT gwan_code)::int AS gw,
            coalesce(sum(extract(epoch FROM (coalesce(reopened_at, now()) - closed_at)) / 60) FILTER (WHERE closed_at IS NOT NULL AND was_open), 0)::int AS minutes,
            count(*) FILTER (WHERE reopen_error IS NOT NULL)::int AS failed,
            count(*) FILTER (WHERE closed_at IS NOT NULL AND reopened_at IS NULL)::int AS open
       FROM gwan_maintenances
      WHERE canceled_at IS NULL AND starts_at >= ($1::date AT TIME ZONE 'Asia/Seoul') AND starts_at < (($2::date + 1) AT TIME ZONE 'Asia/Seoul')`, [from, to]);
  if (!r || !r.n) return { text: '관 점검 0건', failed: 0 };
  return { text: `관 점검 ${r.n}건(관 ${r.gw}곳) · 손님이 관을 못 본 시간 합 ${r.minutes}분${r.failed ? ` · 다시 열지 못함 ${r.failed}건` : ''}${r.open ? ` · 지금 점검 중 ${r.open}건` : ''}`, failed: r.failed };
}
