import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { cleanBlocks, GwanPagesService } from './gwan-pages.service';
import { createHash } from 'crypto';
import { pagesBoard } from './pages-board';
import { toCsv } from './csv';
import { assertPublisher, canPublish } from './page-publisher';
import { AgentService } from '../agent/agent.service';
import { translateSystem, parseTranslation } from '../i18n/translate.service';

/* ---------------------------------------------------------------------
 * v10.696 ~ 700 (D321 · docs/804 ~ 808) 꾸밀 페이지(구역 편집) — 메인 · 관 메인 · 소개몰 메인 · 페이지 목록
 *   지금 디자인은 그대로 · 구역마다 보이기 · 순서 · 글자 · 그림 · (소개몰) 고른 상품 · 구역 사이 블록(관 페이지 블록 · 조각은 안 받음)
 *   초안은 ADMIN · SUPER · 게시 · 예약 · 되돌리기는 SUPER(컨트롤러) · 게시하면 site_layout_versions 에 판이 쌓임(DB 가 고치기 · 지우기 막음)
 *   게시된 판이 없으면 공개 응답은 null — 사용자 웹은 코드의 처음 배치 그대로
 * ------------------------------------------------------------------- */

export const LAYOUT_KEYS = ['HOME', 'MNY', 'MAL', 'BIZ', 'LED', 'HLT', 'EARN', 'COMM', 'HELP', 'PARTNER', 'MALL_ITEM'] as const;   // v10.702 (D322) EARN 허브 페이지 · v10.755 · 757 ~ 759 (D328) 소개광장 · 고객센터 · 파트너센터 · 상품 상세
/** v10.701 (D322 · docs/809) 관 메인은 그 관이 닫혀 있을 때만 고침(대표 「관이 열려 있는 상태에서 변경 불가」) · 메인(HOME)은 수정 가능 스위치만 */
const GWAN_LAYOUT_KEYS = ['MNY', 'MAL', 'BIZ', 'LED', 'HLT', 'EARN'];   // 검정 ⑫ — 관 코드 목록은 이 모양(['MNY' … 'HLT'])으로
export const LAYOUT_GWAN: Partial<Record<string, string>> = { ...Object.fromEntries(GWAN_LAYOUT_KEYS.map((c) => [c, c])), MALL_ITEM: 'HLT' };   // v10.755 상품 상세는 소개몰 관 규칙
export type LayoutKey = (typeof LAYOUT_KEYS)[number];

interface Spec {
  name: string;
  path: string;
  sections: Array<[string, string]>;   // [열쇠, 이름] — 처음 순서
  texts: Array<[string, string, number]>;   // [열쇠, 이름, 최대 글자] — 비우면 처음 글
  slides?: Array<[string, string]>;   // HOME hero 오른쪽 안내 장
  picks?: Array<[string, string, number]>;   // HLT 고른 상품 [구역, 이름, 최대]
  inserts: 'each' | 'edge';   // each = 맨 위(_top) + 구역마다 뒤 · edge = 위(top) · 아래(bottom)만
}

/** 페이지마다 고칠 수 있는 것 — 사용자 웹(site/src/lib/layout.ts)과 운영 화면(SitePages.tsx)이 같은 열쇠를 씀 */
export const LAYOUT_SPECS: Record<LayoutKey, Spec> = {
  HOME: {
    name: '메인', path: '/',
    sections: [['forme', '나를 위한 소개'], ['weather', '오늘의 날씨'], ['today', '오늘의 소개뱅크'], ['needs', '지금, 어떤 소개가 필요하세요?'],
      ['picks', '오늘의 PICK'], ['poll', '이건 어때?(투표)'], ['strip', '띠 배너'], ['town', '지금 우리동네'], ['trust', '믿고 연결받는 안심소개'],
      ['startup', '최근 뜨는 창업'], ['core', '소개뱅크 핵심']],
    texts: [['heroTitleA', 'hero 제목 첫 줄', 40], ['heroTitleB', 'hero 제목 둘째 줄', 40], ['heroLeadA', 'hero 설명 첫 줄', 80], ['heroLeadB', 'hero 설명 둘째 줄', 80],
      ['h.forme', '「나를 위한 소개」 제목', 40], ['h.today', '「오늘의 소개뱅크」 제목', 40], ['h.needs', '「어떤 소개가 필요하세요?」 제목', 40], ['h.picks', '「오늘의 PICK」 제목', 40],
      ['h.poll', '「이건 어때?」 제목', 40], ['h.town', '「지금 우리동네」 제목', 40], ['h.trust', '「안심소개」 제목', 40], ['h.startup', '「최근 뜨는 창업」 제목', 40], ['h.core', '「소개뱅크 핵심」 제목', 40]],
    slides: [['pf', '안심소개 · 전문가 포트폴리오'], ['biz', '소개창업'], ['health', '소개몰'], ['community', '소개광장']],
    inserts: 'each',
  },
  MNY: {
    name: '소개장터 메인', path: '/money',
    sections: [['quick', '바로가기 칸'], ['cat', '업종 고르기'], ['cols', '요청 · 업체 · 목록'], ['band', '띠 광고'], ['bottom', '연결 사례 · 지역']],
    texts: [['title', '머리 띠 제목', 40], ['lead', '머리 띠 설명', 120]],
    inserts: 'edge',
  },
  MAL: {
    name: '안심소개 메인', path: '/mall',
    sections: [['search', '검색 줄'], ['axis', '축 탭'], ['notice', '인증업체 안내'], ['body', '목록 · 상담'], ['features', '특징']],
    texts: [], inserts: 'edge',
  },
  BIZ: {
    name: '소개창업 메인', path: '/biz',
    sections: [['search', '검색 줄'], ['axis', '축 탭'], ['body', '목록'], ['features', '특징']],
    texts: [], inserts: 'edge',
  },
  LED: {
    name: '소개리드 메인', path: '/lead',
    sections: [['warn', '안내 띠'], ['list', '상담 업종'], ['cta', '파트너 안내']],
    texts: [['title', '제목', 40], ['desc', '설명', 160]],
    inserts: 'each',
  },
  HLT: {
    name: '소개몰 메인', path: '/health',
    sections: [['hero', '머리 띠(검색)'], ['nav', '바로가기 줄'], ['ing', '성분으로 찾기'], ['con', '고민으로 찾기'], ['low', '성분별 최저가'],
      ['today', '오늘의 추천'], ['two', '많이 산 · 새 상품'], ['deal', '특가'], ['band', '아래 띠'], ['listings', '도매 · 납품 매물']],
    texts: [['heroTitle', '머리 띠 제목', 40], ['heroLead', '머리 띠 설명', 120], ['bandTitle', '아래 띠 제목', 40], ['bandLead', '아래 띠 설명', 120]],
    picks: [['fresh', '새 상품(비우면 최근 올린 순)', 8], ['deal', '특가(비우면 특별가격 상품)', 12]],
    inserts: 'each',
  },
  EARN: {   // v10.702 (D322 · docs/810) 허브(소개하고 벌기) 사용자 웹 /earn
    name: '소개하고 벌기(허브) 메인', path: '/earn',
    sections: [['cards', '하위 관 카드'], ['guide', '이용 안내']],
    texts: [['title', '제목', 40], ['desc', '설명', 160], ['guide', '이용 안내 글', 300]],
    inserts: 'each',
  },
  /* v10.757 ~ 759 · 755 (D328 · docs/863 · 865 ~ 867) — 관이 아닌 페이지(메인처럼 스위치만) · 상품 상세는 소개몰 관 규칙 · 안내 띠 글 + 위 · 아래 블록 */
  COMM: {
    name: '소개광장 메인', path: '/community',
    sections: [], texts: [['band', '안내 띠 글', 120]], inserts: 'edge',
  },
  HELP: {
    name: '고객센터 홈', path: '/support',
    sections: [], texts: [['band', '안내 띠 글', 120]], inserts: 'edge',
  },
  PARTNER: {
    name: '파트너센터 첫 화면', path: '/partner',
    sections: [], texts: [['band', '안내 띠 글', 120]], inserts: 'edge',
  },
  MALL_ITEM: {
    name: '소개몰 상품 상세(모든 상품)', path: '/health/p/…',
    sections: [], texts: [['band', '안내 띠 글', 120]], inserts: 'edge',
  },
};

const bad = (msg: string): never => { throw new PolicyViolation('SITE_LAYOUT_INVALID', msg); };
function txt(v: unknown, max: number, what: string): string {
  const s = typeof v === 'string' ? v.replace(/\r/g, '').trim() : '';
  if (s.length > max) bad(`${what}은(는) ${max}자까지입니다.`);
  if (/<\s*\/?\s*[a-z!]/i.test(s)) bad(`${what}에 HTML 태그는 쓸 수 없습니다.`);
  return s;
}
function link(v: unknown, what: string): string {
  const s = txt(v, 300, what);
  if (s && !(/^\/(?!\/)[\w\-./?=&%#~가-힣]*$/.test(s) || /^https:\/\/[\w.-]+(\/[\w\-./?=&%#~가-힣]*)?$/.test(s))) bad(`${what}은(는) /로 시작하는 사이트 안 주소나 https 주소만 됩니다.`);
  return s;
}

export interface Layout {
  sections: Array<{ key: string; show: boolean }>;
  texts: Record<string, string>;
  slides?: Record<string, { show: boolean; tag?: string; title?: string; desc?: string; cta?: string; href?: string; image?: string }>;
  picks?: Record<string, string[]>;
  inserts: Record<string, Array<Record<string, unknown>>>;
  /** v10.708 (docs/816) 언어별 글자 — { en: { heroTitleA: '…', 'slide.pf.title': '…' } } · 한국어는 texts · 비우면 그 언어 사전 글 */
  i18n?: Record<string, Record<string, string>>;
  /** v10.764 (docs/872) 번역할 때의 한국어 글 지문(언어마다 md5 앞 12자) — 지금 한국어 글 지문과 다르면 「다시 번역 필요」 */
  i18nSig?: Record<string, string>;
}
/** v10.764 한국어 글 지문 — 언어별로 옮기는 칸(i18nKeys)의 한국어 값만 */
export function koSig(key: LayoutKey, l: Pick<Layout, 'texts' | 'slides'>): string {
  const src: Record<string, string> = {};
  for (const [tk] of LAYOUT_SPECS[key].texts) if (l.texts?.[tk]) src[tk] = l.texts[tk]!;
  for (const [sk] of LAYOUT_SPECS[key].slides ?? []) for (const f of ['tag', 'title', 'desc', 'cta'] as const) { const v = l.slides?.[sk]?.[f]; if (v) src[`slide.${sk}.${f}`] = v; }
  return createHash('md5').update(JSON.stringify(src)).digest('hex').slice(0, 12);
}
/** v10.764 다시 번역이 필요한 언어 — 번역 지문이 있고 지금 한국어 지문과 다름 */
export function staleLangs(key: LayoutKey, l: Layout): string[] {
  const now = koSig(key, l);
  return Object.entries(l.i18nSig ?? {}).filter(([lang, sig]) => l.i18n?.[lang] && sig !== now).map(([lang]) => lang);
}
/** v10.708 언어별로 고칠 수 있는 글 열쇠 — 글자(texts) + 안내 장 글(slide.<장>.<칸>) */
export function i18nKeys(key: LayoutKey): Array<[string, string, number]> {
  const sp = LAYOUT_SPECS[key];
  return [...sp.texts, ...(sp.slides ?? []).flatMap(([k, nm]) => ([['tag', 20], ['title', 40], ['desc', 120], ['cta', 20]] as const).map(([f, max]) => [`slide.${k}.${f}`, `${nm} ${f}`, max] as [string, string, number]))];
}

/** 초안 검사 · 정리 — 모르는 칸은 버림 · 빠진 구역은 처음 순서로 뒤에 붙임(코드에 구역이 늘어도 사라지지 않게) */
export function cleanLayout(key: LayoutKey, input: unknown): Layout {
  const sp = LAYOUT_SPECS[key];
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const known = new Map(sp.sections);
  const seen = new Set<string>();
  const sections: Layout['sections'] = [];
  for (const s of Array.isArray(o.sections) ? o.sections : []) {
    const k = String(s?.key ?? '');
    if (!known.has(k) || seen.has(k)) continue;
    seen.add(k); sections.push({ key: k, show: s?.show !== false });
  }
  for (const [k] of sp.sections) if (!seen.has(k)) sections.push({ key: k, show: true });
  const texts: Record<string, string> = {};
  for (const [k, nm, max] of sp.texts) { const v = txt(o.texts?.[k], max, nm); if (v) texts[k] = v; }
  const out: Layout = { sections, texts, inserts: {} };
  if (sp.slides) {
    out.slides = {};
    for (const [k, nm] of sp.slides) {
      const s = o.slides?.[k] ?? {};
      const one: NonNullable<Layout['slides']>[string] = { show: s.show !== false };
      for (const [f, max] of [['tag', 20], ['title', 40], ['desc', 120], ['cta', 20]] as const) { const v = txt(s[f], max, `${nm} ${f}`); if (v) one[f] = v; }
      const h = link(s.href, `${nm} 주소`); if (h) one.href = h;
      const im = link(s.image, `${nm} 그림`); if (im) one.image = im;
      out.slides[k] = one;
    }
  }
  if (sp.picks) {
    out.picks = {};
    for (const [k, nm, max] of sp.picks) {
      const arr = Array.isArray(o.picks?.[k]) ? o.picks[k] : [];
      const codes = [...new Set(arr.map((x: unknown) => String(x ?? '').trim()).filter(Boolean))] as string[];
      if (codes.length > max) bad(`${nm}은(는) ${max}개까지 고릅니다.`);
      if (codes.some((c) => !/^[A-Za-z0-9_.\-]{1,60}$/.test(c))) bad(`${nm}의 상품 코드 모양이 맞지 않습니다.`);
      if (codes.length) out.picks[k] = codes;
    }
  }
  const spots = sp.inserts === 'each' ? ['_top', ...sp.sections.map(([k]) => k)] : ['top', 'bottom'];
  let total = 0;
  for (const at of spots) {
    const raw = o.inserts?.[at];
    if (!Array.isArray(raw) || !raw.length) continue;
    const blocks = cleanBlocks(raw, { max: 10 });   // v10.720 (docs/828) 공통 조각도 넣음(사용자 웹에 줄 때 펼침)
    total += blocks.length;
    if (blocks.length) out.inserts[at] = blocks;
  }
  if (total > 30) bad('끼운 블록은 페이지 전체에서 30개까지입니다.');
  /* v10.708 언어별 글자 — 두 글자 언어 코드(ko 빼고) · 열쇠는 i18nKeys · 비운 칸은 버림 */
  const keys = i18nKeys(key);
  if (keys.length && o.i18n && typeof o.i18n === 'object') {
    const i18n: Record<string, Record<string, string>> = {};
    for (const [lang, m] of Object.entries(o.i18n as Record<string, any>)) {
      if (!/^[a-z]{2}$/.test(lang) || lang === 'ko' || !m || typeof m !== 'object') continue;
      const one: Record<string, string> = {};
      for (const [k, nm, max] of keys) { const v = txt(m[k], max, `${lang} ${nm}`); if (v) one[k] = v; }
      if (Object.keys(one).length) i18n[lang] = one;
    }
    if (Object.keys(i18n).length > 8) bad('언어별 글자는 8개 언어까지입니다.');
    if (Object.keys(i18n).length) out.i18n = i18n;
  }
  /* v10.764 번역 지문 — 남은 언어 것만 · 모양이 맞는 것만 */
  if (out.i18n && o.i18nSig && typeof o.i18nSig === 'object') {
    const sig: Record<string, string> = {};
    for (const [lang, v] of Object.entries(o.i18nSig as Record<string, unknown>)) if (out.i18n[lang] && typeof v === 'string' && /^[0-9a-f]{12}$/.test(v)) sig[lang] = v;
    if (Object.keys(sig).length) out.i18nSig = sig;
  }
  return out;
}
/** v10.709 (docs/817) 초안 고친 기록 — 바뀐 곳 요약(운영 화면 「게시하면 바뀌는 것」과 같은 말) */
export function layoutChanges(key: LayoutKey, a: Layout, b: Layout): string[] {
  const sp = LAYOUT_SPECS[key];
  const nm = Object.fromEntries(sp.sections);
  const out: string[] = [];
  if (a.sections.map((x) => x.key).join(',') !== b.sections.map((x) => x.key).join(',')) out.push('구역 순서');
  for (const x of b.sections) { const o = a.sections.find((y) => y.key === x.key); if (o && o.show !== x.show) out.push(`「${nm[x.key]}」 ${x.show ? '보이기' : '숨기기'}`); }
  for (const [tk, tn] of sp.texts) if ((a.texts[tk] ?? '') !== (b.texts[tk] ?? '')) out.push(tn);
  for (const [sk, sn] of sp.slides ?? []) if (JSON.stringify(a.slides?.[sk] ?? {}) !== JSON.stringify(b.slides?.[sk] ?? {})) out.push(`안내 장 「${sn}」`);
  for (const [pk, pn] of sp.picks ?? []) if (JSON.stringify(a.picks?.[pk] ?? []) !== JSON.stringify(b.picks?.[pk] ?? [])) out.push(pn);
  for (const at of new Set([...Object.keys(a.inserts), ...Object.keys(b.inserts)])) if (JSON.stringify(a.inserts[at] ?? []) !== JSON.stringify(b.inserts[at] ?? [])) out.push(`블록 「${at === '_top' || at === 'top' ? '맨 위' : at === 'bottom' ? '맨 아래' : `${nm[at] ?? at} 뒤`}」`);
  for (const lang of new Set([...Object.keys(a.i18n ?? {}), ...Object.keys(b.i18n ?? {})])) if (JSON.stringify(a.i18n?.[lang] ?? {}) !== JSON.stringify(b.i18n?.[lang] ?? {})) out.push(`${lang} 글자`);
  return out.slice(0, 40);
}
/** 처음 배치와 같은가(게시해도 바뀌는 것이 없음) */
function isDefault(key: LayoutKey, l: Layout): boolean {
  const d = cleanLayout(key, {});
  return JSON.stringify(d) === JSON.stringify(l);
}

const COLS = `l.key, l.draft, l.editable, l.editable_at AS "editableAt", (SELECT name FROM accounts a WHERE a.id = l.editable_by) AS "editableByName", l.draft_updated_at AS "draftUpdatedAt", (SELECT name FROM accounts a WHERE a.id = l.draft_updated_by) AS "draftUpdatedByName",
  l.published, l.published_version AS "publishedVersion", l.published_at AS "publishedAt", (SELECT name FROM accounts a WHERE a.id = l.published_by) AS "publishedByName",
  l.scheduled_at AS "scheduledAt", (SELECT name FROM accounts a WHERE a.id = l.scheduled_by) AS "scheduledByName"`;

@Injectable()
export class SiteLayoutsService {
  constructor(private readonly db: DatabaseService, private readonly agent: AgentService, private readonly pages: GwanPagesService) {}

  private k(key: string): LayoutKey {
    const k = String(key ?? '').toUpperCase();
    if (!(LAYOUT_KEYS as readonly string[]).includes(k)) throw new NotFound('없는 페이지입니다.');
    return k as LayoutKey;
  }
  private async note(title: string, key: string, detail: Record<string, unknown>) {
    await this.db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'SITE_LAYOUT_PUBLISHED', 'INFO', $1::text, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = 'SITE_LAYOUT_PUBLISHED' AND a.detail->>'key' = $3::text)
       ON CONFLICT DO NOTHING`, [title.slice(0, 200), JSON.stringify({ ...detail, key }), key]).catch(() => undefined);
    await pagesBoard(this.db, title);   // v10.734 운영자 게시판
  }

  /** v10.701 (D322 · docs/809) 고칠 수 있는가 — SUPER 가 「수정 가능」으로 둔 페이지 · 관 메인은 그 관이 닫혀 있을 때만 */
  private async gate(k: LayoutKey): Promise<{ editable: boolean; gwanOpen: boolean; reason: string | null }> {
    const [r] = await this.db.query<{ editable: boolean; open: boolean | null }>(
      `SELECT l.editable, (SELECT g.is_active FROM gwans g WHERE g.code = $2) AS open FROM site_layouts l WHERE l.key = $1`, [k, LAYOUT_GWAN[k] ?? null]);
    const editable = r?.editable === true, gwanOpen = r?.open === true;
    const mgr = editable && !gwanOpen ? await this.managerOnly(LAYOUT_GWAN[k] ?? null) : false;
    return { editable, gwanOpen, reason: !editable ? 'SITE_LAYOUT_LOCKED' : gwanOpen ? 'SITE_LAYOUT_GWAN_OPEN' : mgr ? 'SITE_LAYOUT_MANAGER_ONLY' : null };
  }
  /** v10.726 (D325 · docs/834) 관별 페이지 편집 권한 — 설정 site.page_edit_managers_only = on 이면 SUPER 가 아닌 운영자는 자기가 담당자인 관만(메인은 SUPER 만) · 정기 작업(사람 없음)은 막지 않음 */
  private async managerOnly(gwan: string | null): Promise<boolean> {
    const me = RequestCtx.actorId();
    if (!me) return false;
    const [on] = await this.db.query<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'site.page_edit_managers_only'`);
    if (on?.value !== 'on') return false;
    const [sup] = await this.db.query(`SELECT 1 FROM account_roles WHERE account_id = $1 AND role = 'SUPER'`, [me]);
    if (sup) return false;
    if (!gwan) return true;
    const [m] = await this.db.query(`SELECT 1 FROM gwan_managers WHERE gwan_code = $1 AND account_id = $2`, [gwan, me]);
    return !m;
  }
  private async assertEditable(k: LayoutKey) {
    const g = await this.gate(k);
    if (g.reason === 'SITE_LAYOUT_LOCKED') throw new PolicyViolation('SITE_LAYOUT_LOCKED', '수정 불가로 둔 페이지입니다 — 최고 관리자(SUPER)가 페이지 목록에서 「수정 가능」으로 바꾼 뒤 고칩니다.');
    if (g.reason === 'SITE_LAYOUT_MANAGER_ONLY') throw new PolicyViolation('SITE_LAYOUT_MANAGER_ONLY', '이 관의 담당자만 고칠 수 있습니다(관별 페이지 편집 권한) — 관 설정 › 기본 정보 › 관 담당자를 확인하십시오.');
    if (g.reason === 'SITE_LAYOUT_GWAN_OPEN') throw new PolicyViolation('SITE_LAYOUT_GWAN_OPEN', '관이 열려 있어 고칠 수 없습니다 — 관 설정에서 관을 닫은(중지) 뒤 고치고, 다 고친 뒤 다시 여십시오.');
  }
  /** v10.709 (docs/817) 초안 쓰기 + 고친 기록 한 줄(바뀐 곳이 없으면 기록 안 함) */
  private async writeDraft(k: LayoutKey, l: Layout, how?: string) {
    const [r] = await this.db.query<{ draft: unknown }>(`SELECT draft FROM site_layouts WHERE key = $1`, [k]);
    const ch = layoutChanges(k, cleanLayoutSafe(k, r?.draft), l);
    const me = RequestCtx.actorId() ?? null;
    await this.db.query(`UPDATE site_layouts SET draft = $2::jsonb, draft_updated_at = now(), draft_updated_by = $3 WHERE key = $1`, [k, JSON.stringify(l), me]);
    if (ch.length || how) await this.db.query(`INSERT INTO site_layout_draft_log (key, by, changes) VALUES ($1, $2, $3::jsonb)`, [k, me, JSON.stringify(how ? [how, ...ch].slice(0, 40) : ch)]);
  }
  /** v10.709 초안 고친 기록 — 최근 50줄 */
  async draftLog(key: string) {
    const k = this.k(key);
    return this.db.query(`SELECT l.at, (SELECT name FROM accounts a WHERE a.id = l.by) AS "byName", l.changes FROM site_layout_draft_log l WHERE l.key = $1 ORDER BY l.at DESC, l.id DESC LIMIT 50`, [k]);
  }
  /* ── v10.708 (docs/816) 언어별 글자 번역 초안 — 한국어 글(지금 초안 · 비운 칸은 사전 글이라 옮기지 않음)을 AI 로 그 언어에 · 초안의 i18n[lang] 에 씀(게시는 SUPER) ── */
  async translate(key: string, lang: string) {
    const k = this.k(key);
    if (!/^[a-z]{2}$/.test(lang) || lang === 'ko') throw new PolicyViolation('SITE_LAYOUT_TRANSLATE', '한국어가 아닌 두 글자 언어 코드를 고르십시오.');
    const [ln] = await this.db.query(`SELECT code FROM i18n_langs WHERE code = $1`, [lang]);
    if (!ln) throw new PolicyViolation('SITE_LAYOUT_TRANSLATE', '사이트 언어 목록에 없는 말입니다.');
    await this.assertEditable(k);
    const [r] = await this.db.query<{ draft: unknown }>(`SELECT draft FROM site_layouts WHERE key = $1`, [k]);
    const l = cleanLayoutSafe(k, r?.draft);
    const src: Record<string, string> = {};
    for (const [tk] of LAYOUT_SPECS[k].texts) if (l.texts[tk]) src[tk] = l.texts[tk]!;
    for (const [sk] of LAYOUT_SPECS[k].slides ?? []) for (const f of ['tag', 'title', 'desc', 'cta'] as const) { const v = l.slides?.[sk]?.[f]; if (v) src[`slide.${sk}.${f}`] = v; }
    const keys = Object.keys(src);
    if (!keys.length) throw new PolicyViolation('SITE_LAYOUT_TRANSLATE', '옮길 한국어 글이 없습니다 — 비운 칸은 그 언어 사전 글이 나옵니다.');
    const g = await this.agent.allowed('TRANSLATE');
    if (!g.ok) throw new PolicyViolation('AGENT_OFF', `AI 번역을 쓸 수 없습니다(${g.reason}) — 정책 › AI 에이전트에서 스위치 · 월 상한을 확인하십시오.`);
    const prov = await this.agent.provider();
    if (!prov) throw new PolicyViolation('AGENT_OFF', 'AI 키가 없습니다 — 통합 현황 › 외부 연동 › 연동 키에서 넣으십시오.');
    const [m] = await this.db.query<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'i18n.translate_model'`);
    const model = m?.value || 'claude-haiku-5-5';
    const [priced] = await this.db.query(`SELECT 1 FROM agent_model_prices WHERE model = $1`, [model]);
    if (!priced) throw new PolicyViolation('MODEL_UNPRICED', `요금표에 없는 모델입니다(${model}).`);
    const reply = await prov.complete({ model, system: translateSystem(lang, 'short headings and banner texts on the main pages of a referral marketplace'), messages: [{ role: 'user', content: JSON.stringify(src) }], maxTokens: 4000, effort: 'low' });
    await this.agent.record('TRANSLATE', model, reply.inputTokens, reply.outputTokens, reply.cacheReadTokens);
    if (reply.stopReason === 'refusal' || reply.stopReason === 'max_tokens') throw new PolicyViolation('SITE_LAYOUT_TRANSLATE', '번역이 끝나지 않았습니다(거절 또는 길이) — 직접 옮겨 주십시오.');
    let tr: Record<string, string>;
    try { tr = prov.name === 'MOCK' ? Object.fromEntries(keys.map((x) => [x, `[MOCK ${lang}] ${src[x]}`])) : parseTranslation(reply.text, keys); }
    catch (e) { throw new PolicyViolation('SITE_LAYOUT_TRANSLATE', `번역 답을 읽지 못했습니다 — 다시 누르십시오(${String((e as Error).message)}).`); }
    const max = Object.fromEntries(i18nKeys(k).map(([x, , n]) => [x, n]));
    const one = Object.fromEntries(keys.map((x) => [x, String(tr[x] ?? '').replace(/<[^>]*>/g, '').trim().slice(0, max[x] ?? 40)]).filter(([, v]) => v));
    const next = cleanLayout(k, { ...l, i18n: { ...(l.i18n ?? {}), [lang]: { ...(l.i18n?.[lang] ?? {}), ...one } }, i18nSig: { ...(l.i18nSig ?? {}), [lang]: koSig(k, l) } });   // v10.764 번역 지문
    await this.writeDraft(k, next, `${lang} 번역 초안(AI)`);
    return { ...(await this.get(k)), translatedFields: Object.keys(one).length, model };
  }

  /** v10.701 수정 가능 스위치(SUPER · 컨트롤러) */
  async setEditable(key: string, on: boolean) {
    const k = this.k(key);
    await this.db.query(`UPDATE site_layouts SET editable = $2, editable_by = $3, editable_at = now() WHERE key = $1`, [k, on === true, RequestCtx.actorId() ?? null]);
    return this.get(k);
  }

  /** 예약 시각이 지난 것 게시 — 공개 · 관리 화면을 읽을 때(배치 줄 더하지 않음) · v10.701 수정 불가 · 관이 다시 열렸으면 기다림 */
  async publishDue(): Promise<number> {
    const due = await this.db.query<{ key: string }>(`SELECT key FROM site_layouts WHERE scheduled_at IS NOT NULL AND scheduled_at <= now()`);
    for (let i = due.length - 1; i >= 0; i--) if ((await this.gate(due[i]!.key as LayoutKey)).reason) due.splice(i, 1);
    let n = 0;
    for (const d of due) {
      const ver = await this.db.transaction(async () => {
        const [r] = await this.db.query<{ scheduled_at: string; scheduled_by: string; scheduled_layout: unknown }>(
          `SELECT scheduled_at, scheduled_by, scheduled_layout FROM site_layouts WHERE key = $1 AND scheduled_at IS NOT NULL AND scheduled_at <= now() FOR UPDATE SKIP LOCKED`, [d.key]);
        if (!r) return 0;
        const [v] = await this.db.query<{ version: number }>(
          `INSERT INTO site_layout_versions (key, version, layout, published_by, published_at, how)
           VALUES ($1, coalesce((SELECT max(version) FROM site_layout_versions WHERE key = $1), 0) + 1, $2::jsonb, $3, $4, 'SCHEDULE') RETURNING version`,
          [d.key, JSON.stringify(r.scheduled_layout), r.scheduled_by, r.scheduled_at]);
        await this.db.query(
          `UPDATE site_layouts SET published = $2::jsonb, published_version = $3, published_at = $4, published_by = $5,
                  scheduled_at = NULL, scheduled_by = NULL, scheduled_layout = NULL WHERE key = $1`,
          [d.key, JSON.stringify(r.scheduled_layout), v!.version, r.scheduled_at, r.scheduled_by]);
        return v!.version;
      });
      if (ver) { n++; await this.note(`꾸밀 페이지 예약 게시 ${ver}판 — ${LAYOUT_SPECS[d.key as LayoutKey].name}`, `pub:${d.key}:${ver}`, { page: d.key, version: ver, scheduled: true }); }
    }
    return n;
  }

  specs() {
    return LAYOUT_KEYS.map((k) => ({ key: k, ...LAYOUT_SPECS[k] }));
  }
  async list() {
    await this.publishDue().catch(() => 0);
    const rows = await this.db.query<Record<string, any>>(`SELECT ${COLS} FROM site_layouts l`);
    const open = new Set((await this.db.query<{ code: string }>(`SELECT code FROM gwans WHERE is_active`)).map((x) => x.code));
    const views = Object.fromEntries((await this.db.query<{ key: string; n: number }>(
      `SELECT key, sum(views)::int AS n FROM site_layout_views WHERE day > (now() AT TIME ZONE 'Asia/Seoul')::date - 7 GROUP BY key`)).map((x) => [x.key, x.n]));   // v10.722
    return LAYOUT_KEYS.map((k) => {
      const r = rows.find((x) => x.key === k) ?? {};
      const draft = (() => { try { return cleanLayout(k, r.draft); } catch { return cleanLayout(k, {}); } })();
      return {
        key: k, name: LAYOUT_SPECS[k].name, path: LAYOUT_SPECS[k].path,
        status: r.published ? 'PUBLISHED' : 'DEFAULT',
        editable: r.editable === true, editableAt: r.editableAt ?? null, editableByName: r.editableByName ?? null,
        gwanCode: LAYOUT_GWAN[k] ?? null, gwanOpen: open.has(LAYOUT_GWAN[k] ?? ''), views7: views[k] ?? 0,
        publishedVersion: r.publishedVersion ?? null, publishedAt: r.publishedAt ?? null, publishedByName: r.publishedByName ?? null,
        draftUpdatedAt: r.draftUpdatedAt ?? null, draftUpdatedByName: r.draftUpdatedByName ?? null,
        draftChanged: JSON.stringify(draft) !== JSON.stringify(r.published ? cleanLayoutSafe(k, r.published) : cleanLayout(k, {})),
        scheduledAt: r.scheduledAt ?? null, scheduledByName: r.scheduledByName ?? null,
        staleLangs: staleLangs(k, draft),   // v10.764 다시 번역 필요
      };
    });
  }
  async get(key: string) {
    const k = this.k(key);
    await this.publishDue().catch(() => 0);
    const [r] = await this.db.query<Record<string, any>>(`SELECT ${COLS} FROM site_layouts l WHERE l.key = $1`, [k]);
    if (!r) throw new NotFound('없는 페이지입니다.');
    const versions = await this.db.query(
      `SELECT v.version, v.how, v.reason, v.published_at AS "publishedAt", (SELECT name FROM accounts a WHERE a.id = v.published_by) AS "publishedByName"
         FROM site_layout_versions v WHERE v.key = $1 ORDER BY v.version DESC LIMIT 30`, [k]);
    const previews = await this.db.query(
      `SELECT token, expires_at AS "expiresAt", created_at AS "createdAt", (SELECT name FROM accounts a WHERE a.id = p.created_by) AS "createdByName"
         FROM site_layout_previews p WHERE p.key = $1 AND p.revoked_at IS NULL AND p.expires_at > now() ORDER BY created_at DESC`, [k]);
    const draft = cleanLayoutSafe(k, r.draft);
    const pub = r.published ? cleanLayoutSafe(k, r.published) : null;
    const gt = await this.gate(k);
    return {
      key: k, spec: { key: k, ...LAYOUT_SPECS[k] }, draft, published: pub,
      editable: gt.editable, gwanCode: LAYOUT_GWAN[k] ?? null, gwanOpen: gt.gwanOpen, lockReason: gt.reason, editableAt: r.editableAt, editableByName: r.editableByName,
      publishedVersion: r.publishedVersion, publishedAt: r.publishedAt, publishedByName: r.publishedByName,
      draftUpdatedAt: r.draftUpdatedAt, draftUpdatedByName: r.draftUpdatedByName,
      draftChanged: JSON.stringify(draft) !== JSON.stringify(pub ?? cleanLayout(k, {})),
      scheduledAt: r.scheduledAt, scheduledByName: r.scheduledByName, versions, previews,
      staleLangs: staleLangs(k, draft),   // v10.764
      canPublish: await canPublish(this.db),   // v10.771 이 사람이 게시 · 예약 · 되돌리기를 할 수 있음
    };
  }
  async saveDraft(key: string, layout: unknown) {
    const k = this.k(key);
    const l = cleanLayout(k, layout);   // 입력 규칙을 먼저(무엇이 틀렸는지 알려 줌) · 그다음 수정 가능 · 관 닫힘
    await this.assertEditable(k);
    await this.writeDraft(k, l);
    return this.get(k);
  }
  async publish(key: string) {
    const k = this.k(key);
    await assertPublisher(this.db);   // v10.771 (docs/879)
    await this.assertEditable(k);
    const ver = await this.db.transaction(async () => {
      const [r] = await this.db.query<{ draft: unknown; published: unknown }>(`SELECT draft, published FROM site_layouts WHERE key = $1 FOR UPDATE`, [k]);
      if (!r) throw new NotFound('없는 페이지입니다.');
      const l = cleanLayout(k, r.draft);
      if (!r.published && isDefault(k, l)) throw new PolicyViolation('SITE_LAYOUT_EMPTY', '처음 배치와 같아 게시할 것이 없습니다 — 고친 뒤 「초안 저장」을 먼저 누르십시오.');
      const me = RequestCtx.actorId() ?? null;
      const [v] = await this.db.query<{ version: number }>(
        `INSERT INTO site_layout_versions (key, version, layout, published_by, how)
         VALUES ($1, coalesce((SELECT max(version) FROM site_layout_versions WHERE key = $1), 0) + 1, $2::jsonb, $3, 'PUBLISH') RETURNING version`, [k, JSON.stringify(l), me]);
      await this.db.query(`UPDATE site_layouts SET published = $2::jsonb, published_version = $3, published_at = now(), published_by = $4, draft = $2::jsonb WHERE key = $1`,
        [k, JSON.stringify(l), v!.version, me]);
      return v!.version;
    });
    await this.note(`꾸밀 페이지 게시 ${ver}판 — ${LAYOUT_SPECS[k].name}`, `pub:${k}:${ver}`, { page: k, version: ver, scheduled: false });
    return this.get(k);
  }
  /** 예약(SUPER) — at 이 null 이면 취소 · 5분 뒤 ~ 90일 안 · 지금 초안을 떠 둠 */
  async schedule(key: string, at: string | null) {
    const k = this.k(key);
    await assertPublisher(this.db);   // v10.771 (docs/879) 예약 · 취소
    if (at === null) {
      await this.db.query(`UPDATE site_layouts SET scheduled_at = NULL, scheduled_by = NULL, scheduled_layout = NULL WHERE key = $1`, [k]);
      return this.get(k);
    }
    await this.assertEditable(k);
    const t = new Date(at);
    const now = Date.now();
    if (Number.isNaN(t.getTime()) || t.getTime() < now + 5 * 60_000 || t.getTime() > now + 90 * 86_400_000)
      throw new PolicyViolation('SITE_LAYOUT_SCHEDULE', '예약 시각은 5분 뒤부터 90일 안이어야 합니다.');
    const [r] = await this.db.query<{ draft: unknown }>(`SELECT draft FROM site_layouts WHERE key = $1`, [k]);
    const l = cleanLayout(k, r?.draft);
    await this.db.query(`UPDATE site_layouts SET scheduled_at = $2, scheduled_by = $3, scheduled_layout = $4::jsonb WHERE key = $1`,
      [k, t.toISOString(), RequestCtx.actorId() ?? null, JSON.stringify(l)]);
    return this.get(k);
  }
  /** 예전 판으로 초안 만들기(게시는 따로) · version 0 = 처음 배치로 */
  async restore(key: string, version: number) {
    const k = this.k(key);
    await this.assertEditable(k);
    let l: Layout;
    if (version === 0) l = cleanLayout(k, {});
    else {
      const [v] = await this.db.query<{ layout: unknown }>(`SELECT layout FROM site_layout_versions WHERE key = $1 AND version = $2`, [k, version]);
      if (!v) throw new NotFound('없는 판입니다.');
      l = cleanLayoutSafe(k, v.layout);
    }
    await this.writeDraft(k, l, version === 0 ? '처음 배치로' : `${version}판으로`);
    return this.get(k);
  }
  /** 바로 되돌리기(SUPER) — 예전 판을 새 판으로 다시 게시 · 초안은 그대로 · 사유 */
  async rollback(key: string, version: number, reason: string) {
    const k = this.k(key);
    const why = String(reason ?? '').trim();
    if (why.length < 2) throw new PolicyViolation('SITE_LAYOUT_ROLLBACK_REASON', '되돌리는 사유를 2자 이상 적으십시오.');
    await assertPublisher(this.db);   // v10.771
    await this.assertEditable(k);
    const ver = await this.db.transaction(async () => {
      const [r] = await this.db.query<{ published_version: number | null }>(`SELECT published_version FROM site_layouts WHERE key = $1 FOR UPDATE`, [k]);
      if (r?.published_version === version) throw new PolicyViolation('SITE_LAYOUT_ROLLBACK_SAME', '지금 게시된 판입니다.');
      const [v] = await this.db.query<{ layout: unknown }>(`SELECT layout FROM site_layout_versions WHERE key = $1 AND version = $2`, [k, version]);
      if (!v) throw new NotFound('없는 판입니다.');
      const me = RequestCtx.actorId() ?? null;
      const [n] = await this.db.query<{ version: number }>(
        `INSERT INTO site_layout_versions (key, version, layout, published_by, how, reason)
         VALUES ($1, coalesce((SELECT max(version) FROM site_layout_versions WHERE key = $1), 0) + 1, $2::jsonb, $3, 'ROLLBACK', $4) RETURNING version`,
        [k, JSON.stringify(v.layout), me, why.slice(0, 300)]);
      await this.db.query(`UPDATE site_layouts SET published = $2::jsonb, published_version = $3, published_at = now(), published_by = $4 WHERE key = $1`, [k, JSON.stringify(v.layout), n!.version, me]);
      return n!.version;
    });
    await this.note(`꾸밀 페이지 되돌림 ${version}판 → ${ver}판 — ${LAYOUT_SPECS[k].name} · 사유: ${why.slice(0, 80)}`, `pub:${k}:${ver}`, { page: k, version: ver, from: version, reason: why.slice(0, 300), rollback: true });
    return this.get(k);
  }
  async createPreview(key: string, hours = 24) {
    const k = this.k(key);
    const [c] = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM site_layout_previews WHERE key = $1 AND revoked_at IS NULL AND expires_at > now()`, [k]);
    if ((c?.n ?? 0) >= 5) throw new PolicyViolation('SITE_LAYOUT_PREVIEW_MAX', '열린 미리보기 링크는 페이지마다 5개까지입니다 — 쓰지 않는 링크를 끊으십시오.');
    const h = Math.min(Math.max(Math.floor(hours), 1), 72);
    const token = randomBytes(20).toString('hex');
    const [r] = await this.db.query(
      `INSERT INTO site_layout_previews (token, key, expires_at, created_by) VALUES ($1, $2, now() + make_interval(hours => $3), $4) RETURNING token, expires_at AS "expiresAt"`,
      [token, k, h, RequestCtx.actorId() ?? null]);
    return r;
  }
  async revokePreview(key: string, token: string) {
    const k = this.k(key);
    const [r] = await this.db.query(`UPDATE site_layout_previews SET revoked_at = now() WHERE key = $1 AND token = $2 AND revoked_at IS NULL RETURNING token`, [k, token]);
    if (!r) throw new NotFound('없거나 이미 끊긴 링크입니다.');
    return { revoked: true };
  }

  /** 공개 — 게시된 판(없으면 layout null = 처음 배치) · preview 토큰이 살아 있으면 지금 초안 */
  async publicLayout(key: string, preview?: string) {
    const k = this.k(key);
    if (preview) {
      if (!/^[0-9a-f]{40}$/.test(preview)) throw new NotFound('미리보기 링크가 없거나 끝났습니다.');
      const [r] = await this.db.query<{ draft: unknown }>(
        `SELECT l.draft FROM site_layout_previews p JOIN site_layouts l ON l.key = p.key WHERE p.token = $1 AND p.key = $2 AND p.revoked_at IS NULL AND p.expires_at > now()`, [preview, k]);
      if (!r) throw new NotFound('미리보기 링크가 없거나 끝났습니다.');
      return { key: k, version: 0, preview: true, layout: await this.expandLayout(cleanLayoutSafe(k, r.draft)) };
    }
    await this.publishDue().catch(() => 0);
    const [r] = await this.db.query<{ published: unknown; published_version: number | null }>(`SELECT published, published_version FROM site_layouts WHERE key = $1`, [k]);
    /* v10.760 (D328 · docs/868) A/B 비교 중이면 B 판도 같이 — 사용자 웹이 방문자 쿠키(sgb_ab)로 고름 */
    const [ab] = await this.db.query<{ id: number; layout_b: unknown }>(`SELECT id::int AS id, layout_b FROM site_layout_ab WHERE key = $1 AND status = 'RUNNING' AND starts_at <= now() AND ends_at > now()`, [k]).catch(() => []);
    return { key: k, version: r?.published_version ?? 0, preview: false, layout: r?.published ? await this.expandLayout(cleanLayoutSafe(k, r.published)) : null,
      ab: ab ? { id: ab.id, layout: await this.expandLayout(cleanLayoutSafe(k, ab.layout_b)) } : null };
  }
  /** v10.720 공통 조각 블록을 지금 내용으로 펼침(조각을 지웠거나 못 읽으면 그 블록만 뺌) */
  private async expandLayout(l: Layout): Promise<Layout> {
    const ins: Layout['inserts'] = {};
    for (const [at, b] of Object.entries(l.inserts)) ins[at] = await this.pages.expand(b).catch(() => b.filter((x) => x.type !== 'FRAGMENT'));
    return { ...l, inserts: ins };
  }

  /* ── v10.722 (D325 · docs/830) 꾸밀 페이지 방문 수 — 같은 기기(IP · 브라우저 글자 해시) · 같은 날 한 번(서버 기억 · 최대 5만 줄) ── */
  private seen = new Set<string>();
  private seenDay = '';
  async recordView(key: string, ip: string, ua: string, variant?: string) {
    const k = this.k(key);
    const v = variant === 'a' || variant === 'A' ? 'A' : variant === 'b' || variant === 'B' ? 'B' : null;   // v10.760 A/B 판
    const day = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    if (day !== this.seenDay || this.seen.size > 50_000) { this.seen = new Set(); this.seenDay = day; }
    const sig = `${k}|${createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 16)}`;
    if (this.seen.has(sig)) return { counted: false };
    this.seen.add(sig);
    await this.db.query(`INSERT INTO site_layout_views (key, day, views) VALUES ($1, $2, 1) ON CONFLICT (key, day) DO UPDATE SET views = site_layout_views.views + 1`, [k, day]);
    if (v) await this.db.query(
      `INSERT INTO site_layout_ab_views (ab_id, variant, day, views)
       SELECT id, $2, $3, 1 FROM site_layout_ab WHERE key = $1 AND status = 'RUNNING' AND starts_at <= now() AND ends_at > now()
       ON CONFLICT (ab_id, variant, day) DO UPDATE SET views = site_layout_ab_views.views + 1`, [k, v, day]).catch(() => undefined);
    return { counted: true };
  }

  /** v10.717 (docs/825) 게시 판 하나(판 비교) */
  async version(key: string, version: number) {
    const k = this.k(key);
    const [v] = await this.db.query<{ layout: unknown; published_at: string; how: string }>(`SELECT layout, published_at, how FROM site_layout_versions WHERE key = $1 AND version = $2`, [k, version]);
    if (!v) throw new NotFound('없는 판입니다.');
    return { key: k, version, how: v.how, publishedAt: v.published_at, layout: cleanLayoutSafe(k, v.layout) };
  }
  /** v10.716 (docs/824) 여러 페이지 한꺼번에 예약 게시(SUPER) — 하나씩 같은 규칙(수정 가능 · 관 닫힘 · 초안 떠 둠) · 결과를 줄마다 */
  async scheduleBatch(keys: string[], at: string) {
    const out: Array<{ key: string; ok: boolean; error?: string }> = [];
    for (const key of [...new Set(keys)].slice(0, LAYOUT_KEYS.length)) {
      try { await this.schedule(key, at); out.push({ key: this.k(key), ok: true }); }
      catch (e) { out.push({ key: String(key).toUpperCase(), ok: false, error: String((e as Error).message).slice(0, 160) }); }
    }
    return { at, scheduled: out.filter((x) => x.ok).length, items: out };
  }
  /** v10.735 · 736 (docs/843 · 844) 달력 — 예약 게시(꾸밀 페이지 · 관 안 페이지) · 관 점검 시간을 한 목록으로(기간 · 최대 62일) */
  async schedules(from: string, to: string) {
    const f = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : new Date().toISOString().slice(0, 10);
    const t0 = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : f;
    if ((new Date(t0).getTime() - new Date(f).getTime()) / 86_400_000 > 62) throw new PolicyViolation('SITE_SCHEDULE_RANGE', '달력은 62일까지 봅니다.');
    const rng = `>= ($1::date AT TIME ZONE 'Asia/Seoul') AND %s < (($2::date + 1) AT TIME ZONE 'Asia/Seoul')`;
    const L = await this.db.query<{ key: string; at: string }>(`SELECT key, scheduled_at AS at FROM site_layouts WHERE scheduled_at ${rng.replace('%s', 'scheduled_at')}`, [f, t0]);
    const P = await this.db.query<{ id: number; gwan_code: string; slug: string; title: string; at: string }>(`SELECT id::int AS id, gwan_code, slug, title, scheduled_at AS at FROM gwan_pages WHERE scheduled_at ${rng.replace('%s', 'scheduled_at')}`, [f, t0]);
    const M = await this.db.query<{ id: number; gwan_code: string; starts_at: string; ends_at: string; note: string | null; status: string }>(
      `SELECT id::int AS id, gwan_code, starts_at, ends_at, note, CASE WHEN reopened_at IS NOT NULL THEN 'DONE' WHEN closed_at IS NOT NULL THEN 'RUNNING' ELSE 'SCHEDULED' END AS status
         FROM gwan_maintenances WHERE canceled_at IS NULL AND starts_at ${rng.replace('%s', 'starts_at')}`, [f, t0]);
    const items = [
      ...L.map((x) => ({ type: 'LAYOUT', at: x.at, end: null, label: `${LAYOUT_SPECS[x.key as LayoutKey]?.name ?? x.key} 예약 게시`, ref: x.key })),
      ...P.map((x) => ({ type: 'PAGE', at: x.at, end: null, label: `${x.gwan_code} ${x.slug === 'home' ? '첫 화면' : `/info/${x.slug}`} 「${x.title}」 예약 게시`, ref: String(x.id) })),
      ...M.map((x) => ({ type: 'MAINT', at: x.starts_at, end: x.ends_at, label: `${x.gwan_code} 관 점검${x.note ? ` · ${x.note}` : ''}`, ref: String(x.id), status: x.status })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return { from: f, to: t0, items };
  }
  /** v10.739 (docs/847) 판 내려받기 — 지금 초안(또는 게시 판 하나)을 JSON 파일로(백업 · 다른 서버로 옮기기) */
  async exportLayout(key: string, version?: number) {
    const k = this.k(key);
    const l = version ? (await this.version(k, version)).layout : cleanLayoutSafe(k, (await this.db.query<{ draft: unknown }>(`SELECT draft FROM site_layouts WHERE key = $1`, [k]))[0]?.draft);
    return { kind: 'sogaebank.site-layout', v: 1, key: k, from: version ? `${version}판` : '초안', exportedAt: new Date().toISOString(), layout: l };
  }
  /** v10.739 판 올리기 — 같은 열쇠의 파일만 · 지금 규칙으로 검사 · 초안으로(게시는 따로) · 수정 가능 · 관 닫힘 */
  async importLayout(key: string, file: unknown) {
    const k = this.k(key);
    const f = (file && typeof file === 'object' ? file : {}) as Record<string, unknown>;
    if (f.kind !== 'sogaebank.site-layout' || String(f.key ?? '').toUpperCase() !== k) throw new PolicyViolation('SITE_LAYOUT_IMPORT', '이 페이지에서 내려받은 판 파일이 아닙니다.');
    const l = cleanLayout(k, f.layout);
    await this.assertEditable(k);
    await this.writeDraft(k, l, `파일에서 올림(${String(f.from ?? '')} · ${String(f.exportedAt ?? '').slice(0, 10)})`);
    return this.get(k);
  }
  /** v10.741 (docs/849) 관 메인 글자 AI 초안 — 관 이름 · 설명으로 한국어 글자를 제안(초안에 쓰지 않음 · 화면이 칸에 채움 · 저장은 사람) */
  async suggest(key: string) {
    const k = this.k(key);
    const keys = LAYOUT_SPECS[k].texts.filter(([tk]) => !tk.startsWith('h.'));
    if (!keys.length) throw new PolicyViolation('SITE_LAYOUT_SUGGEST', '이 페이지는 고칠 글자가 없습니다.');
    const code = LAYOUT_GWAN[k];
    const [g] = code ? await this.db.query<{ name: string; description: string | null }>(`SELECT name, description FROM gwans WHERE code = $1`, [code]) : [{ name: '소개뱅크', description: '아는 사람과 기업을 필요한 곳에 소개하고 소개비를 받는 P2P 소개 플랫폼' }];
    const gate = await this.agent.allowed('TRANSLATE');
    if (!gate.ok) throw new PolicyViolation('AGENT_OFF', `AI 를 쓸 수 없습니다(${gate.reason}) — 정책 › AI 에이전트에서 스위치 · 월 상한을 확인하십시오.`);
    const prov = await this.agent.provider();
    if (!prov) throw new PolicyViolation('AGENT_OFF', 'AI 키가 없습니다 — 통합 현황 › 외부 연동 › 연동 키에서 넣으십시오.');
    const [m] = await this.db.query<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'i18n.translate_model'`);
    const model = m?.value || 'claude-haiku-5-5';
    const [priced] = await this.db.query(`SELECT 1 FROM agent_model_prices WHERE model = $1`, [model]);
    if (!priced) throw new PolicyViolation('MODEL_UNPRICED', `요금표에 없는 모델입니다(${model}).`);
    const ask = Object.fromEntries(keys.map(([tk, tn, max]) => [tk, `${tn} — 한국어 ${max}자 안`]));
    const system = 'You write short, plain Korean UI copy for a referral marketplace page. Reply with one JSON object only, same keys as given, each value a Korean string within the stated length. No HTML, no emoji, no exaggeration or price claims.';
    const reply = await prov.complete({ model, system, messages: [{ role: 'user', content: JSON.stringify({ page: LAYOUT_SPECS[k].name, hall: g?.name ?? '', about: g?.description ?? '', fields: ask }) }], maxTokens: 1500, effort: 'low' });
    await this.agent.record('TRANSLATE', model, reply.inputTokens, reply.outputTokens, reply.cacheReadTokens);
    let out: Record<string, string> = {};
    if (prov.name === 'MOCK') out = Object.fromEntries(keys.map(([tk, tn]) => [tk, `[MOCK] ${g?.name ?? ''} ${tn}`]));
    else { try { out = parseTranslation(reply.text, keys.map(([tk]) => tk)); } catch { throw new PolicyViolation('SITE_LAYOUT_SUGGEST', 'AI 답을 읽지 못했습니다 — 다시 누르십시오.'); } }
    const max = Object.fromEntries(keys.map(([tk, , n]) => [tk, n]));
    return { key: k, model, texts: Object.fromEntries(Object.entries(out).map(([tk, v]) => [tk, String(v ?? '').replace(/<[^>]*>/g, '').trim().slice(0, max[tk] ?? 40)]).filter(([, v]) => v)) };
  }
  /** v10.743 (docs/851) 페이지 목록 CSV — 꾸밀 페이지 · 관 안 페이지 한 표(상태 · 수정 가능 · 관 열림 · 7일 방문 · 예약 · 30일 의견) */
  async sitePagesCsv() {
    const { layouts, pages } = await this.sitePages();
    const fb = Object.fromEntries((await this.db.query<{ k: string; yes: number; no: number }>(
      `SELECT page_kind || ':' || page_ref AS k, count(*) FILTER (WHERE helpful)::int AS yes, count(*) FILTER (WHERE NOT helpful)::int AS no FROM page_feedback WHERE at > now() - interval '30 days' GROUP BY 1`)).map((x) => [x.k, x]));
    const rows: unknown[][] = [
      ...layouts.map((r: any) => ['꾸밀 페이지', r.name, r.path, r.status === 'PUBLISHED' ? `게시 ${r.publishedVersion}판` : '처음 배치', r.draftChanged ? '예' : '', r.editable ? '가능' : '불가', r.gwanOpen ? '열림' : '', r.views7 ?? 0, r.scheduledAt ?? '', fb[`LAYOUT:${r.key}`]?.yes ?? 0, fb[`LAYOUT:${r.key}`]?.no ?? 0]),
      ...pages.map((p: any) => ['관 안 페이지', `${p.gwanName} ${p.slug === 'home' ? '첫 화면' : `/info/${p.slug}`} ${p.title}`, p.slug === 'home' ? `/g/${String(p.gwanCode).toLowerCase()}` : `/info/${p.slug}`, p.status, '', p.editable ? '가능' : '불가', p.gwanOpen ? '열림' : '', p.views7 ?? 0, p.scheduledAt ?? '', fb[`PAGE:${p.gwanCode}/${p.slug}`]?.yes ?? 0, fb[`PAGE:${p.gwanCode}/${p.slug}`]?.no ?? 0]),
    ];
    return { csv: toCsv(['구분', '페이지', '주소', '상태', '게시 안 한 초안', '수정', '관', '7일 방문', '예약(UTC)', '의견 도움됨(30일)', '의견 아쉬움(30일)'], rows), rows: rows.length, filename: '페이지목록.csv' };
  }
  /** v10.733 (docs/841) 관 메인 배치 복사 — 다른 꾸밀 페이지에서 같은 열쇠의 구역 차례 · 보이기 · 글자 · 위 · 아래 · 맨 위 블록만 가져와 초안으로(게시는 따로) */
  async copyFrom(key: string, from: string) {
    const k = this.k(key), f = this.k(from);
    if (k === f) throw new PolicyViolation('SITE_LAYOUT_COPY', '같은 페이지입니다.');
    await this.assertEditable(k);
    const [r] = await this.db.query<{ draft: unknown }>(`SELECT draft FROM site_layouts WHERE key = $1`, [f]);
    const src = cleanLayoutSafe(f, r?.draft);
    const mySecs = new Set(LAYOUT_SPECS[k].sections.map(([x]) => x));
    const myTexts = new Set(LAYOUT_SPECS[k].texts.map(([x]) => x));
    const edge: Record<string, string> = LAYOUT_SPECS[k].inserts === 'each' ? { top: '_top', _top: '_top' } : { _top: 'top', top: 'top', bottom: 'bottom' };
    const inserts: Layout['inserts'] = {};
    for (const [at, b] of Object.entries(src.inserts)) { const to = edge[at] ?? (LAYOUT_SPECS[k].inserts === 'each' && mySecs.has(at) ? at : null); if (to) inserts[to] = [...(inserts[to] ?? []), ...b].slice(0, 10); }
    const next = cleanLayout(k, {
      sections: src.sections.filter((x) => mySecs.has(x.key)),
      texts: Object.fromEntries(Object.entries(src.texts).filter(([x]) => myTexts.has(x))),
      inserts,
    });
    await this.writeDraft(k, next, `${LAYOUT_SPECS[f].name}에서 복사`);
    return this.get(k);
  }

  /* ── v10.760 (D328 · docs/868) A/B 비교 — A = 게시된 판 · B = 지금 초안을 떠 둠 · 방문자 반반(쿠키 sgb_ab) · 1 ~ 31일 · 페이지마다 하나 ── */
  async abList(key: string) {
    const k = this.k(key);
    const rows = await this.db.query<Record<string, any>>(
      `SELECT t.id::int AS id, t.status, t.winner, t.starts_at AS "startsAt", t.ends_at AS "endsAt", t.created_at AS "createdAt", t.ended_at AS "endedAt",
              (SELECT name FROM accounts a WHERE a.id = t.created_by) AS "createdByName",
              coalesce((SELECT sum(v.views)::int FROM site_layout_ab_views v WHERE v.ab_id = t.id AND v.variant = 'A'), 0) AS "viewsA",
              coalesce((SELECT sum(v.views)::int FROM site_layout_ab_views v WHERE v.ab_id = t.id AND v.variant = 'B'), 0) AS "viewsB"
         FROM site_layout_ab t WHERE t.key = $1 ORDER BY t.id DESC LIMIT 10`, [k]);
    return { key: k, items: rows };
  }
  async abStart(key: string, days: number) {
    const k = this.k(key);
    await assertPublisher(this.db);
    await this.assertEditable(k);
    const d = Math.floor(Number(days));
    if (!(d >= 1 && d <= 31)) throw new PolicyViolation('SITE_LAYOUT_AB', 'A/B 비교 기간은 1 ~ 31일입니다.');
    const [r] = await this.db.query<{ draft: unknown; published: unknown }>(`SELECT draft, published FROM site_layouts WHERE key = $1`, [k]);
    if (!r?.published) throw new PolicyViolation('SITE_LAYOUT_AB', '게시된 판(A)이 있어야 비교합니다 — 먼저 게시하십시오.');
    const b = cleanLayout(k, r.draft);
    if (JSON.stringify(b) === JSON.stringify(cleanLayoutSafe(k, r.published))) throw new PolicyViolation('SITE_LAYOUT_AB', '초안(B)이 게시된 판(A)과 같습니다 — 초안을 고쳐 저장한 뒤 시작하십시오.');
    try {
      await this.db.query(`INSERT INTO site_layout_ab (key, layout_b, starts_at, ends_at, created_by) VALUES ($1, $2::jsonb, now(), now() + make_interval(days => $3), $4)`, [k, JSON.stringify(b), d, RequestCtx.actorId() ?? null]);
    } catch (e) {
      if (String((e as Error)?.message).includes('site_layout_ab_running_uq')) throw new PolicyViolation('SITE_LAYOUT_AB', '이 페이지는 이미 A/B 비교 중입니다 — 끝낸 뒤 새로 시작하십시오.');
      throw e;
    }
    await this.note(`꾸밀 페이지 A/B 비교 시작 — ${LAYOUT_SPECS[k].name} · ${d}일`, `ab:${k}:${Date.now()}`, { page: k, days: d });
    return this.abList(k);
  }
  /** 끝내기 — winner B 면 B 판을 새 판으로 게시(게시 규칙 그대로) · A 면 그대로 · 사람이 끝내지 않아도 기간이 지나면 B 는 보이지 않음 */
  async abEnd(key: string, winner: string) {
    const k = this.k(key);
    await assertPublisher(this.db);
    const w = winner === 'B' ? 'B' : 'A';
    const [t] = await this.db.query<{ id: number; layout_b: unknown }>(`SELECT id::int AS id, layout_b FROM site_layout_ab WHERE key = $1 AND status = 'RUNNING'`, [k]);
    if (!t) throw new NotFound('진행 중인 A/B 비교가 없습니다.');
    if (w === 'B') {
      await this.assertEditable(k);
      const ver = await this.db.transaction(async () => {
        const l = cleanLayoutSafe(k, t.layout_b);
        const me = RequestCtx.actorId() ?? null;
        const [v] = await this.db.query<{ version: number }>(
          `INSERT INTO site_layout_versions (key, version, layout, published_by, how, reason)
           VALUES ($1, coalesce((SELECT max(version) FROM site_layout_versions WHERE key = $1), 0) + 1, $2::jsonb, $3, 'PUBLISH', $4) RETURNING version`, [k, JSON.stringify(l), me, `A/B 비교 ${t.id}번 B 판`]);
        await this.db.query(`UPDATE site_layouts SET published = $2::jsonb, published_version = $3, published_at = now(), published_by = $4 WHERE key = $1`, [k, JSON.stringify(l), v!.version, me]);
        return v!.version;
      });
      await this.note(`꾸밀 페이지 A/B 비교 끝 — ${LAYOUT_SPECS[k].name} · B 판을 ${ver}판으로 게시`, `pub:${k}:${ver}`, { page: k, version: ver, ab: t.id });
    }
    await this.db.query(`UPDATE site_layout_ab SET status = 'ENDED', winner = $2, ended_by = $3, ended_at = now() WHERE id = $1 AND status = 'RUNNING'`, [t.id, w, RequestCtx.actorId() ?? null]);
    return this.abList(k);
  }

  /** v10.773 (docs/881) 게시 기록 CSV(감사) — 그 달(한국) 꾸밀 페이지 판 · 관 안 페이지 판 · 누가 · 언제 · 어떻게 */
  async publishLogCsv(month: string) {
    const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7);
    const a = await this.db.query<Record<string, any>>(
      `SELECT v.published_at AS at, v.key AS ref, v.version, v.how, v.reason, (SELECT email FROM accounts x WHERE x.id = v.published_by) AS who
         FROM site_layout_versions v
        WHERE v.published_at >= (($1 || '-01')::date AT TIME ZONE 'Asia/Seoul') AND v.published_at < ((($1 || '-01')::date + interval '1 month') AT TIME ZONE 'Asia/Seoul')`, [m]);
    const b = await this.db.query<Record<string, any>>(
      `SELECT v.published_at AS at, p.gwan_code || ' ' || CASE WHEN p.slug = 'home' THEN '첫 화면' ELSE '/info/' || p.slug END AS ref, v.version,
              (SELECT email FROM accounts x WHERE x.id = v.published_by) AS who
         FROM gwan_page_versions v JOIN gwan_pages p ON p.id = v.page_id
        WHERE v.published_at >= (($1 || '-01')::date AT TIME ZONE 'Asia/Seoul') AND v.published_at < ((($1 || '-01')::date + interval '1 month') AT TIME ZONE 'Asia/Seoul')`, [m]);
    const rows: unknown[][] = [
      ...a.map((x) => [new Date(x.at).toISOString(), '꾸밀 페이지', `${LAYOUT_SPECS[x.ref as LayoutKey]?.name ?? x.ref}(${x.ref})`, x.version, HOW_KO[x.how] ?? x.how, x.reason ?? '', x.who ?? '(예약 · 정기 작업)']),
      ...b.map((x) => [new Date(x.at).toISOString(), '관 안 페이지', x.ref, x.version, '게시', '', x.who ?? '(예약 · 정기 작업)']),
    ].sort((p, q) => String(p[0]).localeCompare(String(q[0])));
    return { csv: toCsv(['때(UTC)', '구분', '페이지', '판', '어떻게', '사유', '누가'], rows), rows: rows.length, month: m, filename: `페이지게시기록_${m}.csv` };
  }

  /** v10.700 (docs/808) 페이지 목록 — 꾸밀 페이지 6 · 관 안 페이지(새 관 첫 화면 포함) 한 표 */
  async sitePages() {
    const layouts = await this.list();
    const pages = await this.db.query<Record<string, any>>(
      `SELECT p.id::int AS id, p.gwan_code AS "gwanCode", g.name AS "gwanName", p.slug, p.lang, p.title, p.status, p.published_version AS "publishedVersion",
              p.published_at AS "publishedAt", p.draft_updated_at AS "draftUpdatedAt", (SELECT name FROM accounts a WHERE a.id = p.draft_updated_by) AS "draftUpdatedByName",
              p.scheduled_at AS "scheduledAt", p.visibility, p.editable, g.is_active AS "gwanOpen",
              coalesce((SELECT sum(v.views)::int FROM gwan_page_views v WHERE v.page_id = p.id AND v.day > current_date - 7), 0) AS views7
         FROM gwan_pages p JOIN gwans g ON g.code = p.gwan_code
        ORDER BY g.sort_order NULLS LAST, p.gwan_code, (p.slug = 'home') DESC, p.sort_order, p.slug, p.lang`);
    return { layouts, pages };
  }
}

const HOW_KO: Record<string, string> = { PUBLISH: '게시', SCHEDULE: '예약 게시', ROLLBACK: '되돌림' };

/** 옛 초안 · 판이 지금 규칙에 안 맞으면 처음 배치로(화면이 깨지지 않게) */
export function cleanLayoutSafe(k: LayoutKey, v: unknown): Layout {
  try { return cleanLayout(k, v); } catch { return cleanLayout(k, {}); }
}

/** v10.731 (docs/839) 페이지 바뀐 기록 — 월보 한 줄(그 달 한국 날짜 · 꾸밀 페이지 게시 · 되돌림 · 관 안 페이지 게시 · 게시 요청) */
export async function pagesLine(db: DatabaseService, from: string, to: string): Promise<{ text: string } | null> {
  const [a] = await db.query<{ pub: number; rb: number }>(`SELECT count(*) FILTER (WHERE how <> 'ROLLBACK')::int AS pub, count(*) FILTER (WHERE how = 'ROLLBACK')::int AS rb FROM site_layout_versions WHERE published_at >= ($1::date AT TIME ZONE 'Asia/Seoul') AND published_at < (($2::date + 1) AT TIME ZONE 'Asia/Seoul')`, [from, to]);
  const [b] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM gwan_page_versions WHERE published_at >= ($1::date AT TIME ZONE 'Asia/Seoul') AND published_at < (($2::date + 1) AT TIME ZONE 'Asia/Seoul')`, [from, to]);
  const [c] = await db.query<{ n: number; ok: number; no: number }>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'APPROVED')::int AS ok, count(*) FILTER (WHERE status = 'REJECTED')::int AS no FROM page_publish_requests WHERE requested_at >= ($1::date AT TIME ZONE 'Asia/Seoul') AND requested_at < (($2::date + 1) AT TIME ZONE 'Asia/Seoul')`, [from, to]);
  return { text: `페이지 게시 — 메인 · 관 메인 ${a?.pub ?? 0}번(되돌림 ${a?.rb ?? 0}) · 관 안 페이지 ${b?.n ?? 0}번 · 게시 요청 ${c?.n ?? 0}건(승인 ${c?.ok ?? 0} · 되돌려 보냄 ${c?.no ?? 0})` };
}
