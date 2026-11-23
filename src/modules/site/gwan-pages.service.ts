import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { storageFromEnv } from '../file/storage';
import { randomBytes, createHash } from 'crypto';
import { AgentService } from '../agent/agent.service';
import { translateSystem, parseTranslation } from '../i18n/translate.service';

/* ---------------------------------------------------------------------
 * v10.650 (D311 · docs/793) 관 페이지 — 새 관 첫 화면(slug home) 블록 편집 · 관 안 페이지 등록
 *   초안(draft)은 ADMIN · SUPER 가 고침 · 게시는 SUPER(컨트롤러) · 게시하면 gwan_page_versions 에 판이 쌓임(고치기 · 지우기 막음 · DB)
 *   블록은 아래 8종만 · 칸마다 길이 · 주소 검사(HTML 은 받지 않음 · 링크는 관 안 주소(/…) 또는 https 만)
 * ------------------------------------------------------------------- */

export const PAGE_BLOCKS = ['HERO', 'TEXT', 'BUTTONS', 'IMAGE', 'GALLERY', 'TABLE', 'VIDEO', 'LISTINGS', 'CATEGORIES', 'NOTICES', 'FAQ', 'INQUIRY', 'FRAGMENT'] as const;   // v10.681 INQUIRY 문의 받기   // v10.674 FRAGMENT 공통 조각(초안에만 · 게시 때 펼침)   // v10.654 GALLERY 사진 묶음 · v10.656 TABLE 표 · v10.664 VIDEO 동영상(유튜브)

/** v10.664 (docs/795) 유튜브 주소 → 영상 번호(11자) — watch?v= · youtu.be/ · shorts/ · embed/ 만 · 그 밖은 null */
export function youtubeId(u: string): string | null {
  const m = /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})(?:[?&#].*)?$/.exec(u.trim());
  return m ? m[1]! : null;
}
const SORTS = ['RECENT', 'POPULAR', 'FEE_DESC', 'DEADLINE'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bad = (msg: string): never => { throw new PolicyViolation('GWAN_PAGE_BLOCK', msg); };
function str(v: unknown, max: number, what: string, need = false): string {
  const s = typeof v === 'string' ? v.replace(/\r/g, '').trim() : '';
  if (need && !s) bad(`${what}을(를) 넣으십시오.`);
  if (s.length > max) bad(`${what}은(는) ${max}자까지입니다.`);
  if (/<\s*\/?\s*[a-z!]/i.test(s)) bad(`${what}에 HTML 태그는 쓸 수 없습니다.`);
  return s;
}
/** 링크 — 관 안 주소(/로 시작 · //는 안 됨) 또는 https 주소만 */
function href(v: unknown, what: string): string {
  const s = str(v, 300, what, true);
  if (!(/^\/(?!\/)[\w\-./?=&%#~가-힣]*$/.test(s) || /^https:\/\/[\w.-]+(\/[\w\-./?=&%#~가-힣]*)?$/.test(s))) bad(`${what}은(는) /로 시작하는 관 안 주소나 https 주소만 됩니다.`);
  return s;
}
function int(v: unknown, lo: number, hi: number, def: number): number {
  const n = Number(v ?? def);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : def;
}

/** 블록 검사 · 정리 — 모르는 칸은 버림 */
export function cleanBlocks(input: unknown, opts: { noFragment?: boolean; max?: number } = {}): Array<Record<string, unknown>> {
  if (!Array.isArray(input)) bad('블록은 목록이어야 합니다.');
  const arr = input as unknown[];
  if (arr.length > (opts.max ?? 30)) bad(opts.max ? `조각의 블록은 ${opts.max}개까지입니다.` : '블록은 30개까지입니다.');
  return arr.map((b0, i) => {
    const b = (b0 ?? {}) as Record<string, unknown>;
    const n = `${i + 1}번째 블록`;
    switch (b.type) {
      case 'HERO': return { type: 'HERO', title: str(b.title, 80, `${n} 제목`, true), sub: str(b.sub, 200, `${n} 설명`),
        image: b.image ? href(b.image, `${n} 그림 주소`) : '',
        button: b.button && (b.button as Record<string, unknown>).label ? { label: str((b.button as Record<string, unknown>).label, 20, `${n} 단추 글자`, true), href: href((b.button as Record<string, unknown>).href, `${n} 단추 주소`) } : null };
      case 'TEXT': {
        const body = str(b.body, 5000, `${n} 글`, true);
        /* v10.654 글 속 사진 — 한 줄에 ![설명](주소) · 주소는 다른 링크와 같은 규칙 · 20장까지 */
        const pics = [...body.matchAll(/!\[([^\]]{0,100})\]\(([^)\s]{1,300})\)/g)];
        if (pics.length > 20) bad(`${n} 글 속 사진은 20장까지입니다.`);
        pics.forEach((m, k) => href(m[2], `${n} 글 속 ${k + 1}번 사진 주소`));
        return { type: 'TEXT', title: str(b.title, 80, `${n} 제목`), body };
      }
      case 'BUTTONS': {
        const items = Array.isArray(b.items) ? b.items as Array<Record<string, unknown>> : [];
        if (!items.length || items.length > 4) bad(`${n} 단추는 1 ~ 4개입니다.`);
        return { type: 'BUTTONS', items: items.map((x, k) => ({ label: str(x.label, 20, `${n} ${k + 1}번 단추 글자`, true), href: href(x.href, `${n} ${k + 1}번 단추 주소`) })) };
      }
      case 'IMAGE': return { type: 'IMAGE', src: href(b.src, `${n} 그림 주소`), alt: str(b.alt, 100, `${n} 그림 설명(대체 글)`, true), caption: str(b.caption, 200, `${n} 그림 아래 글`) };
      case 'GALLERY': {   // v10.654 사진 묶음 — 1 ~ 30장 · 격자(2 ~ 4칸)
        const items = Array.isArray(b.items) ? b.items as Array<Record<string, unknown>> : [];
        if (!items.length || items.length > 30) bad(`${n} 사진은 1 ~ 30장입니다.`);
        return { type: 'GALLERY', title: str(b.title, 80, `${n} 제목`), cols: int(b.cols, 2, 4, 3),
          items: items.map((x, k) => ({ src: href(x.src, `${n} ${k + 1}번 사진 주소`), alt: str(x.alt, 100, `${n} ${k + 1}번 사진 설명`, true), caption: str(x.caption, 200, `${n} ${k + 1}번 사진 아래 글`) })) };
      }
      case 'TABLE': {   // v10.656 (docs/794) 표 — 머리 칸 1 ~ 8 · 줄 1 ~ 50 · 칸마다 200자(HTML 없이)
        const head = Array.isArray(b.head) ? (b.head as unknown[]).map((x, k) => str(x, 200, `${n} 머리 ${k + 1}칸`)) : [];
        if (!head.length || head.length > 8) bad(`${n} 표의 칸(열)은 1 ~ 8개입니다.`);
        const rows = Array.isArray(b.rows) ? b.rows as unknown[] : [];
        if (!rows.length || rows.length > 50) bad(`${n} 표의 줄은 1 ~ 50줄입니다.`);
        return { type: 'TABLE', title: str(b.title, 80, `${n} 제목`), caption: str(b.caption, 200, `${n} 표 아래 글`), head,
          rows: rows.map((r, i) => head.map((_, k) => str(Array.isArray(r) ? r[k] : '', 200, `${n} ${i + 1}줄 ${k + 1}칸`))) };
      }
      case 'VIDEO': {   // v10.664 동영상 — 유튜브 주소만(개인정보 보호 주소 youtube-nocookie 로 끼워 보임)
        const url = str(b.url, 300, `${n} 동영상 주소`, true);
        const id = youtubeId(url);
        if (!id) bad(`${n} 동영상은 유튜브 주소(youtube.com/watch?v= · youtu.be/ · shorts/)만 됩니다.`);
        return { type: 'VIDEO', title: str(b.title, 80, `${n} 제목`), url, videoId: id, caption: str(b.caption, 200, `${n} 동영상 아래 글`) };
      }
      case 'INQUIRY': {   // v10.681 (D318) 문의 받기 — 고객센터 1:1 문의로 보냄(관 · 페이지 출처가 붙음) · 문의 유형은 정해 둔 것만
        const cat = ['HOWTO', 'LISTING', 'FEE', 'BILLING', 'REPORT', 'ETC'].includes(String(b.category)) ? String(b.category) : 'HOWTO';
        return { type: 'INQUIRY', title: str(b.title, 80, `${n} 제목`), body: str(b.body, 300, `${n} 안내 글`), label: str(b.label, 20, `${n} 단추 글자`) || '문의하기', category: cat };
      }
      case 'FRAGMENT': {   // v10.674 (D316) 공통 조각 — 번호만 · 게시 · 미리보기 때 서버가 펼침 · 조각 안에는 못 넣음
        if (opts.noFragment) bad(`${n} 조각 안에는 다른 조각을 넣을 수 없습니다.`);
        const id = Number(b.fragmentId);
        if (!Number.isInteger(id) || id < 1) bad(`${n} 조각 번호가 맞지 않습니다.`);
        return { type: 'FRAGMENT', fragmentId: id, name: str(b.name, 40, `${n} 조각 이름`) };
      }
      case 'LISTINGS': {
        const cat = typeof b.categoryId === 'string' && b.categoryId ? b.categoryId : '';
        if (cat && !UUID_RE.test(cat)) bad(`${n} 업종 번호가 맞지 않습니다.`);
        return { type: 'LISTINGS', title: str(b.title, 80, `${n} 제목`), limit: int(b.limit, 1, 20, 8), sort: SORTS.includes(String(b.sort)) ? String(b.sort) : 'RECENT', categoryId: cat };
      }
      case 'CATEGORIES': return { type: 'CATEGORIES', title: str(b.title, 80, `${n} 제목`) };
      case 'NOTICES': return { type: 'NOTICES', title: str(b.title, 80, `${n} 제목`), limit: int(b.limit, 1, 10, 5) };
      case 'FAQ': {
        const items = Array.isArray(b.items) ? b.items as Array<Record<string, unknown>> : [];
        if (!items.length || items.length > 20) bad(`${n} 질문은 1 ~ 20개입니다.`);
        return { type: 'FAQ', title: str(b.title, 80, `${n} 제목`), items: items.map((x, k) => ({ q: str(x.q, 200, `${n} ${k + 1}번 질문`, true), a: str(x.a, 2000, `${n} ${k + 1}번 답`, true) })) };
      }
      default: return bad(`${n}의 종류가 맞지 않습니다(${PAGE_BLOCKS.join(' · ')}).`);
    }
  });
}

const PAGE_COLS = `p.id::int AS id, p.gwan_code AS "gwanCode", p.slug, p.lang, p.title, p.show_in_menu AS "showInMenu", p.sort_order AS "sortOrder", p.status,
  p.published_version AS "publishedVersion", p.published_at AS "publishedAt", p.draft_updated_at AS "draftUpdatedAt",
  p.scheduled_at AS "scheduledAt", (SELECT name FROM accounts a WHERE a.id = p.scheduled_by) AS "scheduledByName",   -- v10.661 (D315) 예약 게시
  p.visibility, p.seo_description AS "seoDescription", p.seo_image AS "seoImage", p.noindex,   -- v10.691 · 692 (D320) 공개 범위 · 검색엔진
  (SELECT coalesce(sum(w.views), 0)::int FROM gwan_page_views w WHERE w.page_id = p.id AND w.day > (now() AT TIME ZONE 'Asia/Seoul')::date - 7) AS "views7",   -- v10.667 최근 7일
  (SELECT name FROM accounts a WHERE a.id = p.draft_updated_by) AS "draftUpdatedByName",
  (p.published_version IS NULL OR p.draft IS DISTINCT FROM (SELECT coalesce(v.source, v.blocks) FROM gwan_page_versions v WHERE v.page_id = p.id AND v.version = p.published_version)
     OR p.title IS DISTINCT FROM (SELECT v.title FROM gwan_page_versions v WHERE v.page_id = p.id AND v.version = p.published_version)) AS "draftChanged"`;

@Injectable()
export class GwanPagesService {
  constructor(private readonly db: DatabaseService, private readonly agent: AgentService) {}

  /* ── v10.670 (docs/796) 운영 알림 — 게시 · 예약 게시 · 숨김 · 예약 · 7일 넘게 게시 안 된 초안 ──
   *   운영 화면 › 운영 알림에 한 줄(INFO · 열쇠가 같으면 한 번만 · 한 줄씩 clock_timestamp) · 알림 실패는 게시와 상관없음 */
  private async note(code: string, title: string, key: string, detail: Record<string, unknown>) {
    await this.db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT $1::text, 'INFO', $2::text, $3::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = $1::text AND a.detail->>'key' = $4::text)
       ON CONFLICT DO NOTHING`, [code, title.slice(0, 200), JSON.stringify({ ...detail, key }), key]).catch(() => undefined);
  }
  private async pageLabel(id: number) {
    const [r] = await this.db.query<{ gwan_code: string; gname: string; slug: string; lang: string; title: string }>(
      `SELECT p.gwan_code, g.name AS gname, p.slug, p.lang, p.title FROM gwan_pages p JOIN gwans g ON g.code = p.gwan_code WHERE p.id = $1`, [id]);
    return r ? { label: `${r.gname}(${r.gwan_code}) › ${r.slug === 'home' ? '첫 화면' : `/info/${r.slug}`}${r.lang !== 'ko' ? ` · ${r.lang}` : ''} 「${r.title}」`, gwan: r.gwan_code, slug: r.slug } : { label: `페이지 ${id}`, gwan: null, slug: null };
  }
  /* ── v10.685 (D319 · docs/800) 내 담당 관 — 지금 운영자가 담당인 관마다 검수 대기 · 관 페이지에서 온 열린 문의 · 7일 지난 초안 ── */
  async myGwans() {
    const me = RequestCtx.actorId();
    if (!me) return [];
    return this.db.query(
      `SELECT g.code, g.name, g.is_active AS "isActive", m.sort_order AS "order",
              (SELECT count(*)::int FROM review_items r WHERE r.gwan_code = g.code AND r.status IN ('QUEUED', 'IN_PROGRESS')) AS "reviewPending",
              (SELECT count(*)::int FROM inquiries i WHERE i.source_gwan = g.code AND i.status = 'OPEN') AS "openInquiries",
              (SELECT count(*)::int FROM inquiries i WHERE i.source_gwan = g.code AND i.status = 'OPEN' AND i.assignee_id = $1) AS "myInquiries",
              (SELECT count(*)::int FROM gwan_pages p WHERE p.gwan_code = g.code AND p.draft_updated_at < now() - interval '7 days' AND p.scheduled_at IS NULL AND p.status <> 'HIDDEN'
                 AND (p.published_version IS NULL OR p.draft IS DISTINCT FROM (SELECT coalesce(v.source, v.blocks) FROM gwan_page_versions v WHERE v.page_id = p.id AND v.version = p.published_version))) AS "staleDrafts"
         FROM gwan_managers m JOIN gwans g ON g.code = m.gwan_code WHERE m.account_id = $1 ORDER BY g.sort_order`, [me]);
  }

  /* ── v10.674 (D316 · docs/797) 공통 조각 ── */
  /** 초안 블록의 FRAGMENT 를 그때의 조각 블록으로 펼침 — 없는 조각 422 · 펼친 뒤 30개 넘으면 422 */
  async expand(blocks: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
    const ids = [...new Set(blocks.filter((b) => b.type === 'FRAGMENT').map((b) => Number(b.fragmentId)))];
    if (!ids.length) return blocks;
    const rows = await this.db.query<{ id: number; name: string; blocks: unknown }>(`SELECT id::int AS id, name, blocks FROM gwan_page_fragments WHERE id = ANY($1::bigint[])`, [ids]);
    const map = new Map(rows.map((r) => [r.id, r]));
    const out: Array<Record<string, unknown>> = [];
    for (const b of blocks) {
      if (b.type !== 'FRAGMENT') { out.push(b); continue; }
      const f = map.get(Number(b.fragmentId));
      if (!f) bad(`없는 조각입니다(${b.fragmentId}번 · ${String(b.name ?? '')}) — 조각 블록을 빼거나 다른 조각을 고르십시오.`);
      out.push(...cleanBlocks(f!.blocks, { noFragment: true, max: 10 }));
    }
    if (out.length > 30) bad(`조각을 펼치면 블록이 ${out.length}개입니다 — 30개까지입니다.`);
    return out;
  }
  private static FRAG_USE = `SELECT p.id::int AS id, p.gwan_code AS "gwanCode", g.name AS "gwanName", p.slug, p.lang, p.title, p.status,
      EXISTS (SELECT 1 FROM gwan_page_versions v WHERE v.page_id = p.id AND v.version = p.published_version AND v.source @> jsonb_build_array(jsonb_build_object('type', 'FRAGMENT', 'fragmentId', $1::int))) AS "published"
    FROM gwan_pages p JOIN gwans g ON g.code = p.gwan_code
   WHERE p.draft @> jsonb_build_array(jsonb_build_object('type', 'FRAGMENT', 'fragmentId', $1::int)) ORDER BY p.gwan_code, p.slug, p.lang`;
  async fragments() {
    return this.db.query(
      `SELECT f.id::int AS id, f.name, jsonb_array_length(f.blocks) AS blocks, f.updated_at AS "updatedAt", (SELECT name FROM accounts a WHERE a.id = f.updated_by) AS "updatedByName",
              (SELECT count(*)::int FROM gwan_pages p WHERE p.draft @> jsonb_build_array(jsonb_build_object('type', 'FRAGMENT', 'fragmentId', f.id))) AS "usedBy"
         FROM gwan_page_fragments f ORDER BY f.name`);
  }
  async fragment(id: number) {
    const [f] = await this.db.query<Record<string, unknown>>(
      `SELECT id::int AS id, name, blocks, updated_at AS "updatedAt", (SELECT name FROM accounts a WHERE a.id = updated_by) AS "updatedByName" FROM gwan_page_fragments WHERE id = $1`, [id]);
    if (!f) throw new NotFound('없는 조각입니다.');
    return { ...f, usedBy: await this.db.query(GwanPagesService.FRAG_USE, [id]) };
  }
  async createFragment(input: { name: string; blocks?: unknown }) {
    if (!String(input.name ?? '').trim()) throw new PolicyViolation('GWAN_FRAGMENT_NAME', '조각 이름을 넣으십시오.');
    const blocks = cleanBlocks(input.blocks ?? [], { noFragment: true, max: 10 });
    const me = RequestCtx.actorId() ?? null;
    const [dup] = await this.db.query(`SELECT id FROM gwan_page_fragments WHERE lower(btrim(name)) = lower(btrim($1))`, [input.name]);
    if (dup) throw new StateConflict('GWAN_FRAGMENT_EXISTS', '같은 이름의 조각이 있습니다.');
    const [r] = await this.db.query<{ id: number }>(
      `INSERT INTO gwan_page_fragments (name, blocks, created_by, updated_by) VALUES (btrim($1), $2::jsonb, $3, $3) RETURNING id::int AS id`, [input.name, JSON.stringify(blocks), me]);
    return this.fragment(r!.id);
  }
  async updateFragment(id: number, input: { name?: string; blocks?: unknown }) {
    const blocks = input.blocks === undefined ? null : JSON.stringify(cleanBlocks(input.blocks, { noFragment: true, max: 10 }));
    if (input.name) {
      const [dup] = await this.db.query(`SELECT id FROM gwan_page_fragments WHERE lower(btrim(name)) = lower(btrim($1)) AND id <> $2`, [input.name, id]);
      if (dup) throw new StateConflict('GWAN_FRAGMENT_EXISTS', '같은 이름의 조각이 있습니다.');
    }
    const [r] = await this.db.query(
      `UPDATE gwan_page_fragments SET name = coalesce(btrim($2), name), blocks = coalesce($3::jsonb, blocks), updated_by = $4, updated_at = now() WHERE id = $1 RETURNING id`,
      [id, input.name ?? null, blocks, RequestCtx.actorId() ?? null]);
    if (!r) throw new NotFound('없는 조각입니다.');
    return this.fragment(id);
  }
  async deleteFragment(id: number) {
    const used = await this.db.query(GwanPagesService.FRAG_USE, [id]);
    if (used.length) throw new PolicyViolation('GWAN_FRAGMENT_IN_USE', `이 조각을 쓰는 페이지가 ${used.length}개 있어 지울 수 없습니다 — 페이지에서 조각 블록을 먼저 빼십시오.`);
    const [r] = await this.db.query(`DELETE FROM gwan_page_fragments WHERE id = $1 RETURNING id`, [id]);
    if (!r) throw new NotFound('없는 조각입니다.');
    return { deleted: id };
  }

  private staleCheckedAt = 0;
  /** 7일 넘게 게시 안 된 초안 — 한 시간에 한 번만 봄(공개 읽기 · 목록에서 부름) · 초안 고친 때마다 알림 한 번 */
  async staleDrafts(): Promise<number> {
    if (Date.now() - this.staleCheckedAt < 3_600_000) return 0;
    this.staleCheckedAt = Date.now();
    const rows = await this.db.query<{ id: number; at: string; who: string | null }>(
      `SELECT p.id::int AS id, p.draft_updated_at AS at, (SELECT name FROM accounts a WHERE a.id = p.draft_updated_by) AS who FROM gwan_pages p
        WHERE p.draft_updated_at < now() - interval '7 days' AND p.scheduled_at IS NULL AND p.status <> 'HIDDEN'
          AND (p.published_version IS NULL OR p.draft IS DISTINCT FROM (SELECT coalesce(v.source, v.blocks) FROM gwan_page_versions v WHERE v.page_id = p.id AND v.version = p.published_version))
        ORDER BY p.draft_updated_at LIMIT 20`);
    for (const r of rows) {
      const l = await this.pageLabel(r.id);
      const mg = l.gwan ? await this.db.query<{ name: string }>(`SELECT a.name FROM gwan_managers m JOIN accounts a ON a.id = m.account_id WHERE m.gwan_code = $1 ORDER BY m.sort_order`, [l.gwan]) : [];   // v10.680 담당자
      await this.note('GWAN_PAGE_STALE_DRAFT', `관 페이지 초안이 7일 넘게 게시되지 않음 — ${l.label}${mg.length ? ` · 담당 ${mg.map((x) => x.name).join(', ')}` : ''}`, `stale:${r.id}:${new Date(r.at).toISOString()}`, { pageId: r.id, gwan: l.gwan, slug: l.slug, draftUpdatedAt: r.at, by: r.who, managers: mg.map((x) => x.name) });
    }
    return rows.length;
  }

  /* ── v10.661 (D315 · docs/795) 예약 게시 — 시각이 지난 예약을 게시(예약할 때 뜬 내용 · 게시한 사람 = 예약한 SUPER) ──
   *   배치 줄을 더하지 않고 관리 목록 · 공개 페이지 · 메뉴를 읽을 때 부름(같은 줄은 SKIP LOCKED 로 한 번만) · 판의 게시 시각 = 예약 시각 */
  async publishDue(code?: string): Promise<number> {
    const due = await this.db.query<{ id: number }>(
      `SELECT id::int AS id FROM gwan_pages WHERE scheduled_at IS NOT NULL AND scheduled_at <= now() AND ($1::text IS NULL OR gwan_code = $1) ORDER BY scheduled_at LIMIT 20`, [code ?? null]);
    let n = 0;
    for (const d of due) {
      const ver = await this.db.transaction(async () => {
        const [p] = await this.db.query<{ scheduled_at: string; scheduled_by: string; scheduled_title: string; scheduled_blocks: unknown; scheduled_source: unknown }>(
          `SELECT scheduled_at, scheduled_by, scheduled_title, scheduled_blocks, scheduled_source FROM gwan_pages
            WHERE id = $1 AND scheduled_at IS NOT NULL AND scheduled_at <= now() FOR UPDATE SKIP LOCKED`, [d.id]);
        if (!p) return 0;
        const [v] = await this.db.query<{ version: number }>(
          `INSERT INTO gwan_page_versions (page_id, version, title, blocks, published_by, published_at, source)
           VALUES ($1, coalesce((SELECT max(version) FROM gwan_page_versions WHERE page_id = $1), 0) + 1, $2, $3::jsonb, $4, $5, $6::jsonb)
           RETURNING version`, [d.id, p.scheduled_title, JSON.stringify(p.scheduled_blocks), p.scheduled_by, p.scheduled_at, p.scheduled_source == null ? null : JSON.stringify(p.scheduled_source)]);   // v10.678 (D317) 펼치기 전 초안
        await this.db.query(
          `UPDATE gwan_pages SET status = 'PUBLISHED', published_version = $2, published_at = $3, published_by = $4,
                  scheduled_at = NULL, scheduled_by = NULL, scheduled_title = NULL, scheduled_blocks = NULL, scheduled_source = NULL WHERE id = $1`,
          [d.id, v!.version, p.scheduled_at, p.scheduled_by]);
        return v!.version;
      });
      if (ver) {   // v10.670 알림은 거래 밖(알림이 실패해도 게시는 그대로)
        n++;
        const l = await this.pageLabel(d.id);
        await this.note('GWAN_PAGE_PUBLISHED', `관 페이지 예약 게시 ${ver}판 — ${l.label}`, `pub:${d.id}:${ver}`, { pageId: d.id, version: ver, gwan: l.gwan, slug: l.slug, scheduled: true });
      }
    }
    return n;
  }
  /** 예약(SUPER · 컨트롤러) — at 이 null 이면 예약 취소 · 5분 뒤 ~ 90일 안 · 지금 초안 · 제목을 떠 둠 */
  async schedule(id: number, at: string | null) {
    if (at === null) {
      const [r] = await this.db.query(`UPDATE gwan_pages SET scheduled_at = NULL, scheduled_by = NULL, scheduled_title = NULL, scheduled_blocks = NULL, scheduled_source = NULL WHERE id = $1 RETURNING id`, [id]);
      if (!r) throw new NotFound('없는 페이지입니다.');
      return this.get(id);
    }
    const t = new Date(at);
    const now = Date.now();
    if (Number.isNaN(t.getTime()) || t.getTime() < now + 5 * 60_000 || t.getTime() > now + 90 * 86_400_000)
      throw new PolicyViolation('GWAN_PAGE_SCHEDULE', '예약 시각은 5분 뒤부터 90일 안이어야 합니다.');
    const [p] = await this.db.query<{ title: string; draft: unknown }>(`SELECT title, draft FROM gwan_pages WHERE id = $1`, [id]);
    if (!p) throw new NotFound('없는 페이지입니다.');
    const src = cleanBlocks(p.draft);
    const blocks = await this.expand(src);   // v10.674 조각은 예약할 때 펼쳐 떠 둠
    if (!blocks.length) throw new PolicyViolation('GWAN_PAGE_EMPTY', '블록이 하나도 없어 게시할 수 없습니다.');
    await this.db.query(
      `UPDATE gwan_pages SET scheduled_at = $2, scheduled_by = $3, scheduled_title = $4, scheduled_blocks = $5::jsonb, scheduled_source = $6::jsonb WHERE id = $1`,
      [id, t.toISOString(), RequestCtx.actorId() ?? null, p.title, JSON.stringify(blocks), JSON.stringify(src)]);   // v10.678 (D317) 펼치기 전 초안도
    const l = await this.pageLabel(id);
    await this.note('GWAN_PAGE_SCHEDULED', `관 페이지 예약 — ${t.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${l.label}`, `sch:${id}:${t.toISOString()}`, { pageId: id, at: t.toISOString(), gwan: l.gwan, slug: l.slug });
    return this.get(id);
  }

  async list(code: string) {
    const [g] = await this.db.query(`SELECT code FROM gwans WHERE code = $1`, [code]);
    if (!g) throw new NotFound('없는 관입니다.');
    await this.publishDue(code);
    await this.staleDrafts().catch(() => 0);   // v10.670
    return this.db.query(`SELECT ${PAGE_COLS} FROM gwan_pages p WHERE p.gwan_code = $1 ORDER BY (p.slug = 'home') DESC, p.sort_order, p.slug, (p.lang = 'ko') DESC, p.lang`, [code]);
  }

  async create(code: string, input: { slug: string; title: string; showInMenu?: boolean; sortOrder?: number; lang?: string }) {
    const [g] = await this.db.query(`SELECT code FROM gwans WHERE code = $1`, [code]);
    if (!g) throw new NotFound('없는 관입니다.');
    const lang = input.lang ?? 'ko';
    if (lang !== 'ko') {   // v10.657 (D313) 언어판 — 사이트 언어 목록에 있는 말만 · 한국어판을 복사해 시작
      const [l] = await this.db.query(`SELECT code FROM i18n_langs WHERE code = $1`, [lang]);
      if (!l) throw new PolicyViolation('GWAN_PAGE_LANG', '사이트 언어 목록에 없는 말입니다.');
    }
    const [dup] = await this.db.query(`SELECT id FROM gwan_pages WHERE gwan_code = $1 AND slug = $2 AND lang = $3`, [code, input.slug, lang]);
    if (dup) throw new StateConflict('GWAN_PAGE_EXISTS', '이 관에 같은 주소 · 언어의 페이지가 있습니다.');
    const [ko] = lang === 'ko' ? [] : await this.db.query<{ draft: unknown; show_in_menu: boolean; sort_order: number }>(
      `SELECT draft, show_in_menu, sort_order FROM gwan_pages WHERE gwan_code = $1 AND slug = $2 AND lang = 'ko'`, [code, input.slug]);
    const me = RequestCtx.actorId() ?? null;
    const [r] = await this.db.query<{ id: number }>(
      `INSERT INTO gwan_pages (gwan_code, slug, lang, title, show_in_menu, sort_order, draft, draft_updated_by, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8) RETURNING id::int AS id`,
      [code, input.slug, lang, input.title.trim(), input.slug === 'home' ? false : ko ? ko.show_in_menu : input.showInMenu ?? true,
       ko ? ko.sort_order : input.sortOrder ?? 0, JSON.stringify(ko ? ko.draft : []), me]);
    return this.get(r!.id);
  }

  async get(id: number) {
    const [p] = await this.db.query<Record<string, unknown>>(`SELECT ${PAGE_COLS}, p.draft AS blocks FROM gwan_pages p WHERE p.id = $1`, [id]);
    if (!p) throw new NotFound('없는 페이지입니다.');
    const versions = await this.db.query(
      `SELECT v.version, v.title, v.published_at AS "publishedAt", (SELECT name FROM accounts a WHERE a.id = v.published_by) AS "publishedByName"
         FROM gwan_page_versions v WHERE v.page_id = $1 ORDER BY v.version DESC LIMIT 30`, [id]);
    /* v10.666 (D315) 열린 미리보기 링크 */
    const previews = await this.db.query(
      `SELECT r.token, r.expires_at AS "expiresAt", r.created_at AS "createdAt", (SELECT name FROM accounts a WHERE a.id = r.created_by) AS "createdByName"
         FROM gwan_page_previews r WHERE r.page_id = $1 AND r.revoked_at IS NULL AND r.expires_at > now() ORDER BY r.created_at DESC`, [id]);
    return { ...p, versions, previews };
  }

  async update(id: number, input: { title?: string; showInMenu?: boolean; sortOrder?: number; blocks?: unknown;
    visibility?: string; seoDescription?: string; seoImage?: string; noindex?: boolean }) {
    const blocks = input.blocks === undefined ? null : JSON.stringify(cleanBlocks(input.blocks));
    /* v10.691 · 692 (D320) 공개 범위 · 검색엔진 설정 — 바로 반영(게시와 상관없음) · '' = 비움(블록에서 자동) · 첫 화면은 ALL 만(DB) */
    if (input.visibility !== undefined || input.seoDescription !== undefined || input.seoImage !== undefined || input.noindex !== undefined) {
      const desc = input.seoDescription === undefined ? undefined : str(input.seoDescription, 160, '검색엔진 설명');
      const img = input.seoImage === undefined ? undefined : input.seoImage.trim() ? href(input.seoImage, '검색엔진 그림 주소') : '';
      const [ok] = await this.db.query(
        `UPDATE gwan_pages SET visibility = coalesce($2, visibility),
                seo_description = CASE WHEN $3::text IS NULL THEN seo_description ELSE nullif($3, '') END,
                seo_image = CASE WHEN $4::text IS NULL THEN seo_image ELSE nullif($4, '') END, noindex = coalesce($5, noindex)
          WHERE id = $1 RETURNING id`, [id, input.visibility ?? null, desc ?? null, img ?? null, input.noindex ?? null]).catch((e: any) => {
        if (String(e?.constraint ?? e?.message).includes('gwan_pages_visibility_check')) throw new PolicyViolation('GWAN_PAGE_VISIBILITY', '첫 화면은 누구나 보게만 둘 수 있습니다.');
        throw e;
      });
      if (!ok) throw new NotFound('없는 페이지입니다.');
    }
    /* v10.684 (D318) 초안 고친 기록 — 고치기 전 초안 · 제목과 자리마다 비교(더함 · 뺌도 바뀜으로 셈) · 기록 실패는 저장과 상관없음 */
    const [before] = await this.db.query<{ draft: unknown[]; title: string }>(`SELECT draft, title FROM gwan_pages WHERE id = $1`, [id]);
    if (before) {
      const nb = blocks ? JSON.parse(blocks) as unknown[] : (before.draft ?? []);
      const ob = Array.isArray(before.draft) ? before.draft : [];
      let changed = Math.abs(nb.length - ob.length);
      for (let i = 0; i < Math.min(nb.length, ob.length); i++) if (JSON.stringify(nb[i]) !== JSON.stringify(ob[i])) changed++;
      const tc = input.title !== undefined && input.title.trim() !== before.title;
      if (changed || tc) await this.db.query(`INSERT INTO gwan_page_draft_log (page_id, by, blocks, changed, title_changed) VALUES ($1, $2, $3, $4, $5)`,
        [id, RequestCtx.actorId() ?? null, Math.min(nb.length, 30), changed, tc]).catch(() => undefined);
    }
    const [r] = await this.db.query(
      `UPDATE gwan_pages SET title = coalesce($2, title), show_in_menu = CASE WHEN slug = 'home' THEN false ELSE coalesce($3, show_in_menu) END,
              sort_order = coalesce($4, sort_order), draft = coalesce($5::jsonb, draft),
              draft_updated_by = $6, draft_updated_at = now()
        WHERE id = $1 RETURNING id`,
      [id, input.title?.trim() ?? null, input.showInMenu ?? null, input.sortOrder ?? null, blocks, RequestCtx.actorId() ?? null]);
    if (!r) throw new NotFound('없는 페이지입니다.');
    return this.get(id);
  }

  /** 게시(SUPER · 컨트롤러) — 초안을 새 판으로 쌓고 게시 상태로 */
  async publish(id: number) {
    const ver = await this.db.transaction(async () => {
      const [p] = await this.db.query<{ title: string; draft: unknown }>(`SELECT title, draft FROM gwan_pages WHERE id = $1 FOR UPDATE`, [id]);
      if (!p) throw new NotFound('없는 페이지입니다.');
      const src = cleanBlocks(p.draft);   // 옛 초안도 지금 규칙으로 한 번 더 봄
      const blocks = await this.expand(src);   // v10.674 (D316) 조각은 지금 내용으로 펼쳐 판에 넣음(판은 펼친 그대로 · 초안은 조각 블록 그대로)
      if (!blocks.length) throw new PolicyViolation('GWAN_PAGE_EMPTY', '블록이 하나도 없어 게시할 수 없습니다.');
      const me = RequestCtx.actorId() ?? null;
      const [v] = await this.db.query<{ version: number }>(
        `INSERT INTO gwan_page_versions (page_id, version, title, blocks, published_by, source)
         VALUES ($1, coalesce((SELECT max(version) FROM gwan_page_versions WHERE page_id = $1), 0) + 1, $2, $3::jsonb, $4, $5::jsonb)
         RETURNING version`, [id, p.title, JSON.stringify(blocks), me, JSON.stringify(src)]);
      await this.db.query(
        `UPDATE gwan_pages SET status = 'PUBLISHED', published_version = $2, published_at = now(), published_by = $3, draft = $4::jsonb WHERE id = $1`,
        [id, v!.version, me, JSON.stringify(src)]);
      return v!.version;
    });
    const l = await this.pageLabel(id);   // v10.670 알림은 거래 밖
    await this.note('GWAN_PAGE_PUBLISHED', `관 페이지 게시 ${ver}판 — ${l.label}`, `pub:${id}:${ver}`, { pageId: id, version: ver, gwan: l.gwan, slug: l.slug, scheduled: false });
    return this.get(id);
  }

  /** 숨김 · 다시 보임(SUPER) — 다시 보이려면 게시된 판이 있어야 함(DB) */
  async hide(id: number, hidden: boolean) {
    const [r] = await this.db.query(`UPDATE gwan_pages SET status = CASE WHEN $2 THEN 'HIDDEN' WHEN published_version IS NULL THEN 'DRAFT' ELSE 'PUBLISHED' END WHERE id = $1 RETURNING id`, [id, hidden]);
    if (!r) throw new NotFound('없는 페이지입니다.');
    const l = await this.pageLabel(id);   // v10.670
    await this.note('GWAN_PAGE_HIDDEN', `관 페이지 ${hidden ? '숨김' : '다시 보임'} — ${l.label}`, `hide:${id}:${hidden ? 1 : 0}:${Date.now()}`, { pageId: id, hidden, gwan: l.gwan, slug: l.slug });
    return this.get(id);
  }

  /** v10.684 (D318) 초안 고친 기록 — 최근 50줄 */
  async draftLog(id: number) {
    const [p] = await this.db.query(`SELECT id FROM gwan_pages WHERE id = $1`, [id]);
    if (!p) throw new NotFound('없는 페이지입니다.');
    return this.db.query(
      `SELECT l.at, (SELECT name FROM accounts a WHERE a.id = l.by) AS "byName", l.blocks, l.changed, l.title_changed AS "titleChanged"
         FROM gwan_page_draft_log l WHERE l.page_id = $1 ORDER BY l.at DESC, l.id DESC LIMIT 50`, [id]);
  }

  /** v10.655 게시된 판 하나(판 비교 · 내려받기) */
  async version(id: number, version: number) {
    const [v] = await this.db.query(
      `SELECT v.version, v.title, v.blocks, v.published_at AS "publishedAt", (SELECT name FROM accounts a WHERE a.id = v.published_by) AS "publishedByName"
         FROM gwan_page_versions v WHERE v.page_id = $1 AND v.version = $2`, [id, version]);
    if (!v) throw new NotFound('없는 판입니다.');
    return v;
  }

  /** 예전 판으로 초안 만들기 — 게시는 따로 */
  async restore(id: number, version: number) {
    const [v] = await this.db.query<{ title: string; blocks: unknown }>(`SELECT title, blocks FROM gwan_page_versions WHERE page_id = $1 AND version = $2`, [id, version]);
    if (!v) throw new NotFound('없는 판입니다.');
    await this.db.query(`UPDATE gwan_pages SET title = $2, draft = $3::jsonb, draft_updated_by = $4, draft_updated_at = now() WHERE id = $1`,
      [id, v.title, JSON.stringify(v.blocks), RequestCtx.actorId() ?? null]);
    return this.get(id);
  }

  /* ── v10.662 (docs/795) 번역 초안 자동 채우기 — 언어판(ko 아님)에 한국어판 초안을 AI 로 옮겨 그 언어판 초안으로 씀(게시는 SUPER) ──
   *   AI 통로 TRANSLATE(스위치 · 월 상한) · 모델 i18n.translate_model(요금표에 있어야) · 글 칸만 옮김(주소 · 영상 · 업종 번호 · 숫자 칸은 그대로) · 비용 기록 */
  async translate(id: number) {
    const [p] = await this.db.query<{ gwan_code: string; slug: string; lang: string }>(`SELECT gwan_code, slug, lang FROM gwan_pages WHERE id = $1`, [id]);
    if (!p) throw new NotFound('없는 페이지입니다.');
    if (p.lang === 'ko') throw new PolicyViolation('GWAN_PAGE_TRANSLATE', '한국어판은 번역하지 않습니다 — 언어판에서 누르십시오.');
    const [ko] = await this.db.query<{ title: string; draft: unknown }>(`SELECT title, draft FROM gwan_pages WHERE gwan_code = $1 AND slug = $2 AND lang = 'ko'`, [p.gwan_code, p.slug]);
    if (!ko) throw new PolicyViolation('GWAN_PAGE_LANG_KO', '한국어판이 없습니다.');
    const blocks = await this.expand(cleanBlocks(ko.draft));   // v10.674 조각은 펼쳐서 옮김(언어판에는 펼친 글로)
    const src: Record<string, string> = { title: ko.title };
    const TEXT_KEYS = ['title', 'sub', 'body', 'alt', 'caption', 'label', 'q', 'a'];
    const walk = (o: unknown, path: string) => {
      if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${path}.${i}`)); return; }
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        const key = `${path}.${k}`;
        if (typeof v === 'string' && v.trim() && TEXT_KEYS.includes(k)) src[key] = v;
        else if (k === 'head' || k === 'rows') walkCells(v, key);
        else if (v && typeof v === 'object') walk(v, key);
      }
    };
    const walkCells = (v: unknown, key: string) => {
      if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'string' ? (x.trim() && !/^[\d\s.,:%+\-/₩원]+$/.test(x) && (src[`${key}.${i}`] = x)) : walkCells(x, `${key}.${i}`)));
    };
    blocks.forEach((b, i) => walk(b, `b.${i}`));
    const g = await this.agent.allowed('TRANSLATE');
    if (!g.ok) throw new PolicyViolation('AGENT_OFF', `AI 번역을 쓸 수 없습니다(${g.reason}) — 정책 › AI 에이전트에서 스위치 · 월 상한을 확인하십시오.`);
    const prov = await this.agent.provider();
    if (!prov) throw new PolicyViolation('AGENT_OFF', 'AI 키가 없습니다 — 통합 현황 › 외부 연동 › 연동 키에서 넣으십시오.');
    const [m] = await this.db.query<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'i18n.translate_model'`);
    const model = m?.value || 'claude-haiku-5-5';
    const [priced] = await this.db.query(`SELECT 1 FROM agent_model_prices WHERE model = $1`, [model]);
    if (!priced) throw new PolicyViolation('MODEL_UNPRICED', `요금표에 없는 모델입니다(${model}).`);
    const keys = Object.keys(src);
    const reply = await prov.complete({ model, system: translateSystem(p.lang, 'information pages written by the operator of a referral marketplace'), messages: [{ role: 'user', content: JSON.stringify(src) }], maxTokens: 16000, effort: 'low' });
    await this.agent.record('TRANSLATE', model, reply.inputTokens, reply.outputTokens, reply.cacheReadTokens);
    if (reply.stopReason === 'refusal' || reply.stopReason === 'max_tokens') throw new PolicyViolation('GWAN_PAGE_TRANSLATE', '번역이 끝나지 않았습니다(거절 또는 길이) — 직접 옮겨 주십시오.');
    let tr: Record<string, string>;
    try {
      tr = prov.name === 'MOCK' ? Object.fromEntries(keys.map((k) => [k, `[MOCK ${p.lang}] ${src[k]}`])) : parseTranslation(reply.text, keys);
    } catch (e) { throw new PolicyViolation('GWAN_PAGE_TRANSLATE', `번역 답을 읽지 못했습니다 — 다시 누르십시오(${String((e as Error).message)}).`); }
    const out = JSON.parse(JSON.stringify(blocks)) as Array<Record<string, unknown>>;
    const put = (path: string, val: string) => {
      const ks = path.split('.').slice(2);   // b.<i>.…
      let o: any = out[Number(path.split('.')[1])];
      for (let i = 0; i < ks.length - 1; i++) o = o?.[ks[i]!];
      if (o && typeof o === 'object') o[ks[ks.length - 1]!] = val;
    };
    for (const k of keys) if (k !== 'title') put(k, tr[k]!.replace(/<[^>]*>/g, ''));
    const clean = cleanBlocks(out);   // 길이 · 태그 다시 검사(넘치면 422 — 직접 줄여야 함)
    await this.db.query(`UPDATE gwan_pages SET title = $2, draft = $3::jsonb, draft_updated_by = $4, draft_updated_at = now() WHERE id = $1`,
      [id, tr.title!.replace(/<[^>]*>/g, '').slice(0, 80), JSON.stringify(clean), RequestCtx.actorId() ?? null]);
    return { ...(await this.get(id)), translatedFields: keys.length, model };
  }

  /* ── v10.666 (D315 · docs/795) 미리보기 링크 — 로그인 없이 초안 보기 ── */
  async createPreview(id: number, hours = 24) {
    const [p] = await this.db.query(`SELECT id FROM gwan_pages WHERE id = $1`, [id]);
    if (!p) throw new NotFound('없는 페이지입니다.');
    const [c] = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM gwan_page_previews WHERE page_id = $1 AND revoked_at IS NULL AND expires_at > now()`, [id]);
    if ((c?.n ?? 0) >= 5) throw new PolicyViolation('GWAN_PAGE_PREVIEW_MAX', '열린 미리보기 링크는 페이지마다 5개까지입니다 — 쓰지 않는 링크를 끊으십시오.');
    const h = Math.min(Math.max(Math.floor(hours), 1), 72);
    const token = randomBytes(20).toString('hex');
    const [r] = await this.db.query(
      `INSERT INTO gwan_page_previews (token, page_id, expires_at, created_by) VALUES ($1, $2, now() + make_interval(hours => $3), $4)
       RETURNING token, expires_at AS "expiresAt"`, [token, id, h, RequestCtx.actorId() ?? null]);
    return r;
  }
  async revokePreview(id: number, token: string) {
    const [r] = await this.db.query(`UPDATE gwan_page_previews SET revoked_at = now() WHERE page_id = $1 AND token = $2 AND revoked_at IS NULL RETURNING token`, [id, token]);
    if (!r) throw new NotFound('없거나 이미 끊긴 링크입니다.');
    return { revoked: true };
  }
  /** 공개 — 링크가 살아 있으면 지금 초안(관이 준비중이어도 보임 · 검색엔진 막음은 사용자 웹) */
  async previewPage(token: string) {
    if (!/^[0-9a-f]{40}$/.test(token)) throw new NotFound('미리보기 링크가 없거나 끝났습니다.');
    const [r] = await this.db.query<{ gwan_code: string; slug: string; lang: string; title: string; draft: unknown; expires_at: string }>(
      `SELECT p.gwan_code, p.slug, p.lang, p.title, p.draft, r.expires_at FROM gwan_page_previews r JOIN gwan_pages p ON p.id = r.page_id
        WHERE r.token = $1 AND r.revoked_at IS NULL AND r.expires_at > now()`, [token]);
    if (!r) throw new NotFound('미리보기 링크가 없거나 끝났습니다.');
    let blocks: Array<Record<string, unknown>> = [];
    try { blocks = await this.expand(cleanBlocks(r.draft)); } catch { blocks = []; }   // v10.674 조각 펼침   // 규칙에 안 맞는 초안은 빈 화면(편집 화면에서 고침)
    return { gwanCode: r.gwan_code, slug: r.slug, lang: r.lang, title: r.title, blocks, version: 0, publishedAt: null, expiresAt: r.expires_at, preview: true };
  }

  /* ── v10.667 (D315 · docs/795) 방문 수 — 같은 기기(IP · 브라우저 글자 해시) · 같은 페이지 · 같은 날은 한 번(서버 기억 · 최대 5만 줄) ── */
  private seen = new Set<string>();
  private seenDay = '';
  async recordView(code: string, slug: string, ip: string, ua: string) {
    const day = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    if (day !== this.seenDay || this.seen.size > 50_000) { this.seen.clear(); this.seenDay = day; }
    const [p] = await this.db.query<{ id: number }>(
      `SELECT p.id::int AS id FROM gwan_pages p JOIN gwans g ON g.code = p.gwan_code AND g.is_active
        WHERE p.gwan_code = $1 AND p.slug = $2 AND p.status = 'PUBLISHED' AND p.lang IN ('ko', $3) ORDER BY (p.lang = $3) DESC LIMIT 1`, [code, slug, this.lang()]);
    if (!p) return { counted: false };
    const k = createHash('sha256').update(`${p.id}|${ip}|${ua}`).digest('hex').slice(0, 24);
    if (this.seen.has(k)) return { counted: false };
    this.seen.add(k);
    await this.db.query(
      `INSERT INTO gwan_page_views (page_id, day, views) VALUES ($1, $2::date, 1)
       ON CONFLICT (page_id, day) DO UPDATE SET views = gwan_page_views.views + 1`, [p.id, day]);
    return { counted: true };
  }
  async viewStats(id: number, days = 30) {
    const d = Math.min(Math.max(Math.floor(days), 7), 180);
    const [p] = await this.db.query(`SELECT id FROM gwan_pages WHERE id = $1`, [id]);
    if (!p) throw new NotFound('없는 페이지입니다.');
    const rows = await this.db.query<{ day: string; views: number }>(
      `SELECT to_char(x.day, 'YYYY-MM-DD') AS day, coalesce(w.views, 0)::int AS views
         FROM generate_series((now() AT TIME ZONE 'Asia/Seoul')::date - ($2::int - 1), (now() AT TIME ZONE 'Asia/Seoul')::date, interval '1 day') AS x(day)
         LEFT JOIN gwan_page_views w ON w.page_id = $1 AND w.day = x.day::date ORDER BY x.day`, [id, d]);
    return { days: d, total: rows.reduce((n, r) => n + r.views, 0), rows };
  }

  /* ── v10.679 (D317 · docs/798) 판 바로 되돌리기(SUPER) — 예전 판의 블록 그대로 새 판으로 게시 · 초안은 그대로(다르면 「게시 안 된 초안」) · 사유 · 알림 ── */
  async rollback(id: number, version: number, reason: string) {
    const why = String(reason ?? '').trim();
    if (why.length < 2) throw new PolicyViolation('GWAN_PAGE_ROLLBACK_REASON', '되돌리는 사유를 2자 이상 적으십시오.');
    const ver = await this.db.transaction(async () => {
      const [p] = await this.db.query<{ published_version: number | null }>(`SELECT published_version FROM gwan_pages WHERE id = $1 FOR UPDATE`, [id]);
      if (!p) throw new NotFound('없는 페이지입니다.');
      if (p.published_version === version) throw new PolicyViolation('GWAN_PAGE_ROLLBACK_SAME', '지금 게시된 판입니다.');
      const [v] = await this.db.query<{ title: string; blocks: unknown; source: unknown }>(`SELECT title, blocks, source FROM gwan_page_versions WHERE page_id = $1 AND version = $2`, [id, version]);
      if (!v) throw new NotFound('없는 판입니다.');
      const me = RequestCtx.actorId() ?? null;
      const [n] = await this.db.query<{ version: number }>(
        `INSERT INTO gwan_page_versions (page_id, version, title, blocks, published_by, source)
         VALUES ($1, coalesce((SELECT max(version) FROM gwan_page_versions WHERE page_id = $1), 0) + 1, $2, $3::jsonb, $4, $5::jsonb) RETURNING version`,
        [id, v.title, JSON.stringify(v.blocks), me, v.source == null ? null : JSON.stringify(v.source)]);
      await this.db.query(`UPDATE gwan_pages SET status = 'PUBLISHED', published_version = $2, published_at = now(), published_by = $3 WHERE id = $1`, [id, n!.version, me]);
      return n!.version;
    });
    const l = await this.pageLabel(id);
    await this.note('GWAN_PAGE_PUBLISHED', `관 페이지 되돌림 ${version}판 → ${ver}판 — ${l.label} · 사유: ${why.slice(0, 80)}`, `pub:${id}:${ver}`, { pageId: id, version: ver, from: version, reason: why.slice(0, 300), gwan: l.gwan, slug: l.slug, rollback: true });
    return this.get(id);
  }

  /* ── v10.675 (D317 · docs/798) 조각 쓰는 페이지 한꺼번에 다시 게시(SUPER) ──
   *   게시된 판이 있고 초안에 다른 고침이 없는 페이지만(초안 = 지난 게시의 펼치기 전 초안) — 다른 고침이 있으면 건너뜀(그 고침까지 SUPER 확인 없이 나가지 않게) */
  async republishFragment(fragmentId: number, pageIds?: number[]) {
    const used = await this.db.query<{ id: number; published: boolean }>(GwanPagesService.FRAG_USE, [fragmentId]);
    const want = pageIds?.length ? used.filter((u) => pageIds.includes(u.id)) : used;
    const out: Array<{ id: number; result: string; version?: number }> = [];
    for (const u of want) {
      const [st] = await this.db.query<{ status: string; clean: boolean }>(
        `SELECT p.status, (p.published_version IS NOT NULL AND p.draft IS NOT DISTINCT FROM (SELECT coalesce(v.source, v.blocks) FROM gwan_page_versions v WHERE v.page_id = p.id AND v.version = p.published_version)) AS clean
           FROM gwan_pages p WHERE p.id = $1`, [u.id]);
      if (!st || st.status !== 'PUBLISHED') { out.push({ id: u.id, result: 'NOT_PUBLISHED' }); continue; }
      if (!st.clean) { out.push({ id: u.id, result: 'DRAFT_CHANGED' }); continue; }
      try { const d = await this.publish(u.id) as { publishedVersion?: number }; out.push({ id: u.id, result: 'PUBLISHED', version: d.publishedVersion }); }
      catch (e) { out.push({ id: u.id, result: `FAILED: ${String((e as Error).message).slice(0, 120)}` }); }
    }
    return { fragmentId, published: out.filter((x) => x.result === 'PUBLISHED').length, skipped: out.filter((x) => x.result !== 'PUBLISHED').length, items: out };
  }

  /** v10.653 (D312) 페이지 그림 — 용도 PAGE_IMAGE · READY 만(운영이 올린 그림 · 누구나) */
  async pageImage(id: string) {
    if (!UUID_RE.test(id)) throw new NotFound('그림이 없습니다.');
    const [f] = await this.db.query<{ storage_key: string; content_type: string; size_bytes: string }>(
      `SELECT storage_key, content_type, size_bytes FROM files WHERE id = $1::uuid AND purpose = 'PAGE_IMAGE' AND status = 'READY'`, [id]);
    if (!f) throw new NotFound('그림이 없습니다.');
    const stream = await storageFromEnv().open(f.storage_key);
    if (!stream) throw new NotFound('그림이 없습니다.');
    return { stream, contentType: f.content_type, size: Number(f.size_bytes) };
  }

  /* ── v10.659 (docs/794) 안 쓰는 페이지 그림 — 올린 지 days 일 지났고 어느 초안 · 게시 판에도 없는 PAGE_IMAGE ── */
  private static UNUSED = `f.purpose = 'PAGE_IMAGE' AND f.status = 'READY' AND f.created_at < now() - make_interval(days => $1)
      AND NOT EXISTS (SELECT 1 FROM gwan_pages p WHERE position(f.id::text IN p.draft::text) > 0)
      AND NOT EXISTS (SELECT 1 FROM gwan_page_versions v WHERE position(f.id::text IN v.blocks::text) > 0)
      AND NOT EXISTS (SELECT 1 FROM gwan_page_fragments g WHERE position(f.id::text IN g.blocks::text) > 0)`;   // v10.674 조각 속 그림도 「쓰는 그림」
  async unusedImages(days = 30) {
    const d = Math.min(Math.max(Math.floor(days), 7), 365);
    const rows = await this.db.query(
      `SELECT f.id, f.original_name AS name, f.size_bytes::bigint AS size, f.created_at AS "createdAt", a.name AS "ownerName"
         FROM files f LEFT JOIN accounts a ON a.id = f.owner_account_id WHERE ${GwanPagesService.UNUSED} ORDER BY f.created_at LIMIT 500`, [d]);
    return { days: d, count: rows.length, bytes: rows.reduce((n, r: any) => n + Number(r.size), 0), items: rows };
  }
  /** 정리(SUPER · 컨트롤러) — 다시 「안 쓰는가」를 보고 지운 표시 · 저장소에서 지움(감사 기록) */
  async purgeImages(ids: string[], days = 30) {
    const d = Math.min(Math.max(Math.floor(days), 7), 365);
    const ok = ids.filter((x) => UUID_RE.test(x)).slice(0, 500);
    if (!ok.length) return { removed: 0, skipped: ids.length };
    const rows = await this.db.query<{ id: string; storage_key: string }>(
      `UPDATE files f SET status = 'DELETED', deleted_at = now() WHERE f.id = ANY($2::uuid[]) AND ${GwanPagesService.UNUSED}
       RETURNING f.id, f.storage_key`, [d, ok]);
    const st = storageFromEnv();
    for (const r of rows) await st.remove(r.storage_key).catch(() => undefined);
    return { removed: rows.length, skipped: ids.length - rows.length };
  }

  /* ── 공개(사용자 웹) — 게시된 판만 ── */
  /** v10.657 (D313) 화면 언어(X-Lang) 판이 게시돼 있으면 그것, 없으면 한국어판 */
  private lang() { const l = RequestCtx.lang(); return l && /^[a-z]{2}$/.test(l) ? l : 'ko'; }
  async publicMenu(code: string) {
    await this.publishDue(code).catch(() => 0);   // v10.661 예약 게시 — 실패해도 메뉴는 보임
    await this.staleDrafts().catch(() => 0);   // v10.670 한 시간에 한 번
    return this.db.query(
      `SELECT slug, title FROM (
         SELECT DISTINCT ON (p.slug) p.slug, v.title, p.sort_order, p.id
           FROM gwan_pages p JOIN gwan_page_versions v ON v.page_id = p.id AND v.version = p.published_version
           JOIN gwans g ON g.code = p.gwan_code AND g.is_active
          WHERE p.gwan_code = $1 AND p.status = 'PUBLISHED' AND p.show_in_menu AND p.slug <> 'home' AND p.lang IN ('ko', $2)   /* 회원만 페이지도 메뉴엔 보임(열면 로그인 안내) */
          ORDER BY p.slug, (p.lang = $2) DESC) x
        ORDER BY sort_order, id`, [code, this.lang()]);
  }
  /** v10.669 (docs/796) 사이트 검색 — 게시된 관 페이지(켠 관 · 허브 아님 · 화면 언어 판 먼저) 제목 · 블록 글자에 든 것 5개 · 2 ~ 50자 */
  async searchPages(q0: string) {
    const q = String(q0 ?? '').trim().slice(0, 50);
    if (q.length < 2) return [];
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await this.db.query<{ code: string; gwanName: string; slug: string; title: string; blocks: Array<Record<string, any>> }>(
      `SELECT code, "gwanName", slug, title, blocks FROM (
         SELECT DISTINCT ON (p.gwan_code, p.slug) p.gwan_code AS code, g.name AS "gwanName", p.slug, v.title, v.blocks, g.sort_order, p.sort_order AS ps,
                (v.title ILIKE $1) AS in_title
           FROM gwan_pages p JOIN gwan_page_versions v ON v.page_id = p.id AND v.version = p.published_version
           JOIN gwans g ON g.code = p.gwan_code AND g.is_active AND NOT g.is_hub
          WHERE p.status = 'PUBLISHED' AND p.lang IN ('ko', $2) AND p.visibility = 'ALL'   /* v10.691 회원만 페이지는 검색에서 뺌 */
            AND (v.title ILIKE $1 OR jsonb_path_query_array(v.blocks, 'strict $.**.* ? (@.type() == "string")')::text ILIKE $1)
          ORDER BY p.gwan_code, p.slug, (p.lang = $2) DESC) x
        ORDER BY in_title DESC, sort_order, ps LIMIT 5`, [like, this.lang()]);
    const plain = (s: string) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    return rows.map((r) => {
      const texts = (r.blocks ?? []).flatMap((b) => [b.sub, b.body, b.caption, ...((b.items ?? []) as Array<Record<string, any>>).map((x) => x.a ?? x.caption)]).filter((x): x is string => typeof x === 'string' && !!x.trim()).map(plain);
      const hitText = texts.find((t) => t.toLowerCase().includes(q.toLowerCase())) ?? texts[0] ?? '';
      const at = Math.max(0, hitText.toLowerCase().indexOf(q.toLowerCase()) - 30);
      return { gwanCode: r.code, gwanName: r.gwanName, slug: r.slug, title: r.title, snippet: (at > 0 ? '…' : '') + hitText.slice(at, at + 110) };
    });
  }

  async publicPage(code: string, slug: string) {
    await this.publishDue(code).catch(() => 0);   // v10.661
    const [r] = await this.db.query(
      `SELECT p.slug, p.lang, v.title, v.blocks, v.version, v.published_at AS "publishedAt",
              p.visibility, p.seo_description AS "seoDescription", p.seo_image AS "seoImage", p.noindex   /* v10.691 · 692 (D320) */
         FROM gwan_pages p JOIN gwan_page_versions v ON v.page_id = p.id AND v.version = p.published_version
         JOIN gwans g ON g.code = p.gwan_code AND g.is_active
        WHERE p.gwan_code = $1 AND p.slug = $2 AND p.status = 'PUBLISHED' AND p.lang IN ('ko', $3)
        ORDER BY (p.lang = $3) DESC LIMIT 1`, [code, slug, this.lang()]);
    if (!r) throw new NotFound('없는 페이지입니다.');
    /* v10.691 (D320) 회원만 — 로그인 안 했으면 403 GWAN_PAGE_LOGIN(제목만 알려 줌 · 사용자 웹이 로그인 안내) */
    if ((r as { visibility?: string }).visibility === 'MEMBER' && !RequestCtx.actorId())
      throw new Forbidden('GWAN_PAGE_LOGIN', `회원만 볼 수 있는 페이지입니다 — 로그인하십시오.`);
    return r;
  }
}
