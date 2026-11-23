import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { storageFromEnv } from '../file/storage';

/* ---------------------------------------------------------------------
 * v10.650 (D311 · docs/793) 관 페이지 — 새 관 첫 화면(slug home) 블록 편집 · 관 안 페이지 등록
 *   초안(draft)은 ADMIN · SUPER 가 고침 · 게시는 SUPER(컨트롤러) · 게시하면 gwan_page_versions 에 판이 쌓임(고치기 · 지우기 막음 · DB)
 *   블록은 아래 8종만 · 칸마다 길이 · 주소 검사(HTML 은 받지 않음 · 링크는 관 안 주소(/…) 또는 https 만)
 * ------------------------------------------------------------------- */

export const PAGE_BLOCKS = ['HERO', 'TEXT', 'BUTTONS', 'IMAGE', 'GALLERY', 'LISTINGS', 'CATEGORIES', 'NOTICES', 'FAQ'] as const;   // v10.654 GALLERY 사진 묶음
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
export function cleanBlocks(input: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(input)) bad('블록은 목록이어야 합니다.');
  const arr = input as unknown[];
  if (arr.length > 30) bad('블록은 30개까지입니다.');
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

const PAGE_COLS = `p.id::int AS id, p.gwan_code AS "gwanCode", p.slug, p.title, p.show_in_menu AS "showInMenu", p.sort_order AS "sortOrder", p.status,
  p.published_version AS "publishedVersion", p.published_at AS "publishedAt", p.draft_updated_at AS "draftUpdatedAt",
  (SELECT name FROM accounts a WHERE a.id = p.draft_updated_by) AS "draftUpdatedByName",
  (p.published_version IS NULL OR p.draft IS DISTINCT FROM (SELECT v.blocks FROM gwan_page_versions v WHERE v.page_id = p.id AND v.version = p.published_version)
     OR p.title IS DISTINCT FROM (SELECT v.title FROM gwan_page_versions v WHERE v.page_id = p.id AND v.version = p.published_version)) AS "draftChanged"`;

@Injectable()
export class GwanPagesService {
  constructor(private readonly db: DatabaseService) {}

  async list(code: string) {
    const [g] = await this.db.query(`SELECT code FROM gwans WHERE code = $1`, [code]);
    if (!g) throw new NotFound('없는 관입니다.');
    return this.db.query(`SELECT ${PAGE_COLS} FROM gwan_pages p WHERE p.gwan_code = $1 ORDER BY (p.slug = 'home') DESC, p.sort_order, p.id`, [code]);
  }

  async create(code: string, input: { slug: string; title: string; showInMenu?: boolean; sortOrder?: number }) {
    const [g] = await this.db.query(`SELECT code FROM gwans WHERE code = $1`, [code]);
    if (!g) throw new NotFound('없는 관입니다.');
    const [dup] = await this.db.query(`SELECT id FROM gwan_pages WHERE gwan_code = $1 AND slug = $2`, [code, input.slug]);
    if (dup) throw new StateConflict('GWAN_PAGE_EXISTS', '이 관에 같은 주소의 페이지가 있습니다.');
    const me = RequestCtx.actorId() ?? null;
    const [r] = await this.db.query<{ id: number }>(
      `INSERT INTO gwan_pages (gwan_code, slug, title, show_in_menu, sort_order, draft_updated_by, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id::int AS id`,
      [code, input.slug, input.title.trim(), input.slug === 'home' ? false : input.showInMenu ?? true, input.sortOrder ?? 0, me]);
    return this.get(r!.id);
  }

  async get(id: number) {
    const [p] = await this.db.query<Record<string, unknown>>(`SELECT ${PAGE_COLS}, p.draft AS blocks FROM gwan_pages p WHERE p.id = $1`, [id]);
    if (!p) throw new NotFound('없는 페이지입니다.');
    const versions = await this.db.query(
      `SELECT v.version, v.title, v.published_at AS "publishedAt", (SELECT name FROM accounts a WHERE a.id = v.published_by) AS "publishedByName"
         FROM gwan_page_versions v WHERE v.page_id = $1 ORDER BY v.version DESC LIMIT 30`, [id]);
    return { ...p, versions };
  }

  async update(id: number, input: { title?: string; showInMenu?: boolean; sortOrder?: number; blocks?: unknown }) {
    const blocks = input.blocks === undefined ? null : JSON.stringify(cleanBlocks(input.blocks));
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
    return this.db.transaction(async () => {
      const [p] = await this.db.query<{ title: string; draft: unknown }>(`SELECT title, draft FROM gwan_pages WHERE id = $1 FOR UPDATE`, [id]);
      if (!p) throw new NotFound('없는 페이지입니다.');
      const blocks = cleanBlocks(p.draft);   // 옛 초안도 지금 규칙으로 한 번 더 봄
      if (!blocks.length) throw new PolicyViolation('GWAN_PAGE_EMPTY', '블록이 하나도 없어 게시할 수 없습니다.');
      const me = RequestCtx.actorId() ?? null;
      const [v] = await this.db.query<{ version: number }>(
        `INSERT INTO gwan_page_versions (page_id, version, title, blocks, published_by)
         VALUES ($1, coalesce((SELECT max(version) FROM gwan_page_versions WHERE page_id = $1), 0) + 1, $2, $3::jsonb, $4)
         RETURNING version`, [id, p.title, JSON.stringify(blocks), me]);
      await this.db.query(
        `UPDATE gwan_pages SET status = 'PUBLISHED', published_version = $2, published_at = now(), published_by = $3, draft = $4::jsonb WHERE id = $1`,
        [id, v!.version, me, JSON.stringify(blocks)]);
      return this.get(id);
    });
  }

  /** 숨김 · 다시 보임(SUPER) — 다시 보이려면 게시된 판이 있어야 함(DB) */
  async hide(id: number, hidden: boolean) {
    const [r] = await this.db.query(`UPDATE gwan_pages SET status = CASE WHEN $2 THEN 'HIDDEN' WHEN published_version IS NULL THEN 'DRAFT' ELSE 'PUBLISHED' END WHERE id = $1 RETURNING id`, [id, hidden]);
    if (!r) throw new NotFound('없는 페이지입니다.');
    return this.get(id);
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

  /* ── 공개(사용자 웹) — 게시된 판만 ── */
  async publicMenu(code: string) {
    return this.db.query(
      `SELECT p.slug, v.title FROM gwan_pages p JOIN gwan_page_versions v ON v.page_id = p.id AND v.version = p.published_version
         JOIN gwans g ON g.code = p.gwan_code AND g.is_active
        WHERE p.gwan_code = $1 AND p.status = 'PUBLISHED' AND p.show_in_menu AND p.slug <> 'home' ORDER BY p.sort_order, p.id`, [code]);
  }
  async publicPage(code: string, slug: string) {
    const [r] = await this.db.query(
      `SELECT p.slug, v.title, v.blocks, v.version, v.published_at AS "publishedAt"
         FROM gwan_pages p JOIN gwan_page_versions v ON v.page_id = p.id AND v.version = p.published_version
         JOIN gwans g ON g.code = p.gwan_code AND g.is_active
        WHERE p.gwan_code = $1 AND p.slug = $2 AND p.status = 'PUBLISHED'`, [code, slug]);
    if (!r) throw new NotFound('없는 페이지입니다.');
    return r;
  }
}
