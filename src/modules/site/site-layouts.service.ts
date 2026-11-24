import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { cleanBlocks } from './gwan-pages.service';
import { AgentService } from '../agent/agent.service';
import { translateSystem, parseTranslation } from '../i18n/translate.service';

/* ---------------------------------------------------------------------
 * v10.696 ~ 700 (D321 · docs/804 ~ 808) 꾸밀 페이지(구역 편집) — 메인 · 관 메인 · 소개몰 메인 · 페이지 목록
 *   지금 디자인은 그대로 · 구역마다 보이기 · 순서 · 글자 · 그림 · (소개몰) 고른 상품 · 구역 사이 블록(관 페이지 블록 · 조각은 안 받음)
 *   초안은 ADMIN · SUPER · 게시 · 예약 · 되돌리기는 SUPER(컨트롤러) · 게시하면 site_layout_versions 에 판이 쌓임(DB 가 고치기 · 지우기 막음)
 *   게시된 판이 없으면 공개 응답은 null — 사용자 웹은 코드의 처음 배치 그대로
 * ------------------------------------------------------------------- */

export const LAYOUT_KEYS = ['HOME', 'MNY', 'MAL', 'BIZ', 'LED', 'HLT', 'EARN'] as const;   // v10.702 (D322) EARN 허브 페이지
/** v10.701 (D322 · docs/809) 관 메인은 그 관이 닫혀 있을 때만 고침(대표 「관이 열려 있는 상태에서 변경 불가」) · 메인(HOME)은 수정 가능 스위치만 */
const GWAN_LAYOUT_KEYS = ['MNY', 'MAL', 'BIZ', 'LED', 'HLT', 'EARN'];   // 검정 ⑫ — 관 코드 목록은 이 모양(['MNY' … 'HLT'])으로
export const LAYOUT_GWAN: Partial<Record<string, string>> = Object.fromEntries(GWAN_LAYOUT_KEYS.map((c) => [c, c]));
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
    const blocks = cleanBlocks(raw, { noFragment: true, max: 10 });
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
  constructor(private readonly db: DatabaseService, private readonly agent: AgentService) {}

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
  }

  /** v10.701 (D322 · docs/809) 고칠 수 있는가 — SUPER 가 「수정 가능」으로 둔 페이지 · 관 메인은 그 관이 닫혀 있을 때만 */
  private async gate(k: LayoutKey): Promise<{ editable: boolean; gwanOpen: boolean; reason: string | null }> {
    const [r] = await this.db.query<{ editable: boolean; open: boolean | null }>(
      `SELECT l.editable, (SELECT g.is_active FROM gwans g WHERE g.code = $2) AS open FROM site_layouts l WHERE l.key = $1`, [k, LAYOUT_GWAN[k] ?? null]);
    const editable = r?.editable === true, gwanOpen = r?.open === true;
    return { editable, gwanOpen, reason: !editable ? 'SITE_LAYOUT_LOCKED' : gwanOpen ? 'SITE_LAYOUT_GWAN_OPEN' : null };
  }
  private async assertEditable(k: LayoutKey) {
    const g = await this.gate(k);
    if (g.reason === 'SITE_LAYOUT_LOCKED') throw new PolicyViolation('SITE_LAYOUT_LOCKED', '수정 불가로 둔 페이지입니다 — 최고 관리자(SUPER)가 페이지 목록에서 「수정 가능」으로 바꾼 뒤 고칩니다.');
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
    const next = cleanLayout(k, { ...l, i18n: { ...(l.i18n ?? {}), [lang]: { ...(l.i18n?.[lang] ?? {}), ...one } } });
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
    return LAYOUT_KEYS.map((k) => {
      const r = rows.find((x) => x.key === k) ?? {};
      const draft = (() => { try { return cleanLayout(k, r.draft); } catch { return cleanLayout(k, {}); } })();
      return {
        key: k, name: LAYOUT_SPECS[k].name, path: LAYOUT_SPECS[k].path,
        status: r.published ? 'PUBLISHED' : 'DEFAULT',
        editable: r.editable === true, editableAt: r.editableAt ?? null, editableByName: r.editableByName ?? null,
        gwanCode: LAYOUT_GWAN[k] ?? null, gwanOpen: open.has(LAYOUT_GWAN[k] ?? ''),
        publishedVersion: r.publishedVersion ?? null, publishedAt: r.publishedAt ?? null, publishedByName: r.publishedByName ?? null,
        draftUpdatedAt: r.draftUpdatedAt ?? null, draftUpdatedByName: r.draftUpdatedByName ?? null,
        draftChanged: JSON.stringify(draft) !== JSON.stringify(r.published ? cleanLayoutSafe(k, r.published) : cleanLayout(k, {})),
        scheduledAt: r.scheduledAt ?? null, scheduledByName: r.scheduledByName ?? null,
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
      return { key: k, version: 0, preview: true, layout: cleanLayoutSafe(k, r.draft) };
    }
    await this.publishDue().catch(() => 0);
    const [r] = await this.db.query<{ published: unknown; published_version: number | null }>(`SELECT published, published_version FROM site_layouts WHERE key = $1`, [k]);
    return { key: k, version: r?.published_version ?? 0, preview: false, layout: r?.published ? cleanLayoutSafe(k, r.published) : null };
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

/** 옛 초안 · 판이 지금 규칙에 안 맞으면 처음 배치로(화면이 깨지지 않게) */
export function cleanLayoutSafe(k: LayoutKey, v: unknown): Layout {
  try { return cleanLayout(k, v); } catch { return cleanLayout(k, {}); }
}
