import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { publicAuthor } from '../community/community.service';

/* v10.30 — 검색 팝업 추천 칩에 쓰는 업종의 관. v10.29 는 SQL 에 ('MNY','MAL','BIZ') 를 박아 두어 안전 점검 ⑫ 「관 코드 목록이 최신」에 걸렸습니다.
 *   고르는 관은 그대로입니다(소개몰 HLT 의 분류는 상품 분류라 뺌) — 전체 목록에서 빼는 모양으로만 바꿨습니다. */
const SUGGEST_GWANS = (['MNY', 'MAL', 'BIZ', 'HLT'] as const).filter((g) => g !== 'HLT');


/**
 * 프롬프트 검색.
 *
 * ── LLM 은 파서 전용입니다 ────────────────────────────────────
 *   LLM 이 하는 일     자유문장 → 구조화 파라미터
 *   LLM 이 안 하는 일   어느 관인지 판정 · 제한업종 차단
 *
 * **판정을 맡기면 모델이 바뀔 때마다 결과가 달라집니다.**
 * INV-6(제한업종)도 LLM 이 놓치면 그대로 뚫립니다. 그래서 LLM
 * 출력을 받아 **규칙 엔진이 다시 봅니다.**
 *
 * ── 개인정보 (법무 회신 2026-09-22) ───────────────────────────
 *   INV-SCH1  파서 호출에 계정·세션·IP·성향을 넣지 않습니다
 *   INV-SCH2  원문 검색어를 저장하지 않습니다
 *
 * 회신은 "비식별을 계속 지키는 한" 이 전제입니다. 개인화 검색으로
 * 넓히려면 **별도 법무 질의가 필요합니다.**
 */
@Injectable()
export class SearchService {
  constructor(private readonly db: DatabaseService) {}

  /** 문장에서 조건을 뽑습니다. 규칙 기반 — LLM 없이도 됩니다. */
  private parseRules(q: string) {
    const p: Record<string, unknown> = {};
    const t = q.replace(/\s+/g, ' ').trim();

    /* 평수 — "10평 이내" · "20평 이상" · 그냥 "30평"은 「30평대」(v10.31 — 검색 팝업의 「이렇게 찾습니다」(sug.ts)와 같게 읽음) */
    const size = t.match(/(\d{1,4})\s*평\s*(이내|이하|미만|이상|초과)?/);
    if (size) {
      const n = Number(size[1]);
      if (/이상|초과/.test(size[2] ?? '')) p.sizeMin = n;
      else if (size[2]) p.sizeMax = n;
      else p.sizeAround = n;
    }
    /* 금액 — "3천만원 이내" · "5억" */
    const eok = t.match(/(\d+(?:\.\d+)?)\s*억/);
    const man = t.match(/(\d+)\s*천\s*만/);
    const won = t.match(/(\d{3,})\s*만\s*원/);
    if (eok) p.priceMax = Math.round(Number(eok[1]) * 100_000_000);
    else if (man) p.priceMax = Number(man[1]) * 10_000_000;
    else if (won) p.priceMax = Number(won[1]) * 10_000;
    if (/이상|넘는/.test(t) && p.priceMax) { p.priceMin = p.priceMax; delete p.priceMax; }

    /* 지역 — v10.31: 검색 팝업(sug.ts SUGRULE.area)과 같은 별칭(강남 → 서울 강남 · 김포 → 경기 김포 · 판교 → 경기 성남 · 해운대 → 부산 해운대)을
     *   먼저 봅니다. 전에는 「강남에서 …」를 팝업은 「서울 강남」으로, 이 문장 결과는 지역 없음으로 읽어 둘이 달랐습니다. */
    const AREA_ALIAS: Array<[string, string, string]> = [
      ['강남', '서울', '강남'], ['김포', '경기', '김포'], ['판교', '경기', '성남'], ['해운대', '부산', '해운대']];
    const alias = AREA_ALIAS.find(([w]) => t.includes(w));
    const sido = t.match(/(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/);
    if (alias) { p.sido = alias[1]; p.sigungu = alias[2]; }
    else {
      if (sido) p.sido = sido[1];
      const sgg = t.match(/([가-힣]{2,4}(?:시|군|구))(?=\s|$|에|의|에서)/);
      if (sgg) p.sigungu = sgg[1];
    }

    /* 상태 */
    if (/급매|급하|빨리|당장|오늘/.test(t)) p.urgent = true;
    if (/가성비|싸게|저렴|알뜰/.test(t)) p.valueForMoney = true;
    if (/신규|새로|최근/.test(t)) p.recent = true;
    return p;
  }

  async prompt(dto: { q: string; gwan?: string }) {
    const started = Date.now();
    const params = this.parseRules(dto.q);
    if (dto.gwan) params.gwan = dto.gwan;

    /* ── 후보를 규칙 엔진이 고릅니다 ──
     *
     * ★ LLM 이 골라도 여기서 다시 봅니다. 그래야 모델이 바뀌어도
     *   같은 기준으로 판정됩니다. */
    const cands = await this.db.query(
      `SELECT * FROM fn_classify($1) LIMIT $2`,
      [dto.q, Number((await this.setting('search.popup.candidates')) ?? 3)]);

    /* 제한업종은 후보에서 뺍니다 — LLM 이 놓쳐도 여기서 걸립니다(INV-6) */
    const [blocked] = await this.db.query(`SELECT fn_classify_blocked($1) AS b`, [dto.q]);

    /* 기록 — 원문은 안 남깁니다(INV-SCH2) */
    await this.db.query(
      `INSERT INTO llm_parse_log (parsed_params, model, latency_ms, fallback)
       VALUES ($1::jsonb, $2, $3, $4)`,
      [JSON.stringify(params), null, Date.now() - started, true]);

    return {
      /* 무엇을 읽었는지 보여 줍니다 — "AI 가 분석했습니다" 라고
       * 쓰지 않습니다. 규칙 엔진이라 그 말은 거짓입니다. */
      read: params,
      candidates: cands.map((c: Record<string, unknown>) => ({
        /* K1 — fn_classify 의 컬럼은 category_code 입니다(c.code 는 항상 undefined 였음) */
        code: c.category_code, name: c.name, gwan: c.gwan_code,
        score: c.score, matched: c.matched,
      })),
      blocked: blocked?.b ?? null,
      note: blocked?.b
        ? '이 업종은 소개뱅크에서 다루지 않습니다.'
        : cands.length ? null : '뚜렷하지 않습니다. 관을 직접 골라 주십시오.',
      /* ★ 화면에 이 문구를 띄워야 합니다(법무 회신 조건). */
      privacy: '검색어는 분류를 위해 일시적으로 처리되며 저장되지 않습니다.',
    };
  }

  private async setting(key: string): Promise<string | null> {
    const [r] = await this.db.query(
      `SELECT nullif(btrim(value),'') AS v FROM site_settings WHERE key = $1`, [key]);
    return r?.v ?? null;
  }

  async parserHealth() {
    const [h] = await this.db.query(`SELECT * FROM v_search_parser_health`);
    const [on] = await this.db.query(
      `SELECT value FROM site_settings WHERE key = 'search.llm_parser.enabled'`);
    return {
      enabled: on?.value === 'on',
      ...h,
      note: !h?.calls ? '최근 24시간 호출이 없습니다.'
        : Number(h.fallback_pct) > 30
          ? '폴백이 잦습니다 — 돈만 쓰고 정확도는 규칙 엔진과 같아집니다.'
          : null,
    };
  }

  /**
   * v10.31 (합침) — 인기 검색어 한 곳. 쓰기는 POST /search/log(w1 logTerm), 읽기는 이 함수 하나 —
   *   GET /search/suggest 의 keywords(검색 팝업 칩) · GET /search/keywords(w2 「많이 찾는 키워드」)가 같은 규칙을 씁니다.
   *   규칙: search_term_stats 에서 결과가 나온 말(hits > zero_hits) · 2~20자 · 제한업종 낱말(restrict_vocab · BLOCK · AD_ONLY)은 뺌.
   *   q 를 주면 그 말이 든 것만(팝업) · gwanCode 를 주면 그 관의 게시 매물에 실제로 걸리는 말만(관 화면).
   */
  async popularKeywords(o: { q?: string; gwanCode?: string | null; limit?: number }) {
    const n = Math.min(Math.max(Number(o.limit) || 5, 1), 20);
    const q = (o.q ?? '').trim().replace(/\s+/g, ' ').slice(0, 50);
    const [blockRows, kwRows] = await Promise.all([
      this.db.query<{ t: string }>(
        `SELECT lower(term) AS t FROM restrict_vocab
          UNION SELECT lower(name) FROM restricted_industries WHERE is_active AND mode IN ('BLOCK','AD_ONLY')`),
      this.db.query<{ term: string; hits: number }>(
        `SELECT s.term, s.hits::int AS hits FROM search_term_stats s
          WHERE s.hits > s.zero_hits AND length(btrim(s.term)) BETWEEN 2 AND 20
            AND ($1 = '' OR lower(s.term) LIKE fn_search_like($1))
            AND ($2::text IS NULL OR EXISTS (
                  SELECT 1 FROM listings l WHERE l.status = 'PUBLISHED' AND l.gwan_code = $2
                     AND lower(coalesce(l.title,'') || ' ' || coalesce(l.body,'')) LIKE fn_search_like(fn_search_head(s.term))
                     AND fn_search_match(l.title, l.body, s.term)))
          ORDER BY s.hits DESC, s.term LIMIT 40`, [q, o.gwanCode ?? null]),
    ]);
    const blocked = blockRows.map((r) => r.t).filter(Boolean);
    return kwRows.filter((r) => !blocked.some((b) => r.term.toLowerCase().includes(b))).slice(0, n);
  }

  /**
   * v10.29 — 검색 팝업의 읽기 전용 재료 (시안 SPOP · sugPool).  GET /api/v1/search/suggest?q=
   *
   *   keywords     인기 검색어(search_term_stats) — 결과가 나온 말만, **제한업종 낱말은 빼고**(시안 kwSafe · M-08)
   *   categories   업종 이름(승인된 것 · 제한업종 표시가 없는 것) — 인기 검색어가 비면 추천 칩이 이것을 씁니다
   *   introducers  소개자(시안 「소개자도 포함」) — q 가 있을 때만. **이름은 첫 글자만**(김OO) · 연락처 · 소개글(headline)은 내보내지 않습니다.
   *                지역 · 분야로만 찾습니다(이름으로 찾지 않음 — 이름으로 사람을 찾는 길이 되지 않게).
   * 계정 정보를 쓰지 않습니다(INV-SCH1) · 검색어를 저장하지 않습니다(INV-SCH2).
   */
  async suggest(raw: unknown) {
    const one = String((Array.isArray(raw) ? raw[0] : raw) ?? '');
    const q = one.trim().replace(/\s+/g, ' ').slice(0, 50);
    const [blockRows, kwRows, catRows] = await Promise.all([
      this.db.query<{ t: string }>(
        `SELECT lower(term) AS t FROM restrict_vocab
          UNION SELECT lower(name) FROM restricted_industries WHERE is_active AND mode IN ('BLOCK','AD_ONLY')`),
      this.popularKeywords({ q, limit: 8 }),
      this.db.query<{ name: string }>(
        `SELECT name FROM (
           SELECT DISTINCT c.name FROM categories c
            WHERE c.status = 'APPROVED' AND c.restricted_code IS NULL AND c.gwan_code = ANY($2::text[])
              AND ($1 = '' OR lower(c.name) LIKE fn_search_like($1))) x
          ORDER BY name LIMIT 12`, [q, SUGGEST_GWANS]),
    ]);
    const blocked = blockRows.map((r) => r.t).filter(Boolean);
    const safe = (k: string) => !blocked.some((b) => k.toLowerCase().includes(b));
    const keywords = kwRows.map((r) => r.term);   // 제한업종 낱말은 popularKeywords 가 이미 뺌
    const categories = catRows.map((r) => r.name).filter(safe);

    let introducers: Array<{ alias: string; grade: string; regions: string[]; categories: string[] }> = [];
    if (q) {
      const rows = await this.db.query<{ _name: string | null; grade: string; regions: string[]; categories: string[] }>(
        `SELECT a.name AS _name, p.grade, p.regions, p.categories
           FROM introducer_profiles p JOIN accounts a ON a.id = p.account_id
          WHERE a.status = 'ACTIVE' AND a.withdrawn_at IS NULL
            AND (EXISTS (SELECT 1 FROM unnest(p.regions) r WHERE lower(r) LIKE fn_search_like($1))
              OR EXISTS (SELECT 1 FROM unnest(p.categories) c WHERE lower(c) LIKE fn_search_like($1)))
          ORDER BY array_position(ARRAY['REGION_PARTNER','TOP','EXPERT','VERIFIED','SEED'], p.grade), p.created_at
          LIMIT 4`, [q]);
      introducers = rows.map((r) => ({
        alias: publicAuthor(r._name), grade: r.grade,
        regions: (r.regions ?? []).slice(0, 3), categories: (r.categories ?? []).filter(safe).slice(0, 3),
      }));
    }
    return { keywords, categories, introducers };
  }

  /**
   * v10.31 — 검색어 집계(search_term_stats)를 실제로 쌓습니다.  POST /api/v1/search/log  {q}
   *
   * 시안 SPOP 의 추천 검색어(kw — 인기 검색어 · 제한업종 제외)가 이 집계에서 나옵니다. v10.29 는 읽기만 있고 쌓는 곳이 없어
   * 칩이 늘 업종 이름이었습니다. 사용자가 **검색을 제출하거나 결과 줄을 골랐을 때만** 화면이 부릅니다(글자마다 부르지 않음).
   *
   * 개인정보(INV-SCH2 — 원문 검색어를 저장하지 않음)를 지키려고 **이미 공개된 말만** 셉니다.
   *   ① 문장을 낱말로 나눕니다(조사 · 군더더기 제거 — 화면 sug.ts 의 sugWords 와 같은 규칙) + 짧은 말(3낱말 · 20자 이하)은 통째로 한 번
   *   ② 동의어 사전(fn_search_normalize)으로 우리 말로 바꿉니다
   *   ③ 숫자 3자리 이상 · @ · 제한업종 낱말(restrict_vocab · BLOCK · AD_ONLY)이 든 말은 버립니다
   *   ④ 남은 말이 **게시된 매물 · 요청 제목, 승인된 업종 이름, 동의어 사전** 가운데 하나에 있어야만 셉니다
   *      — 사람 이름 · 상호 · 연락처처럼 공개 목록에 없는 말은 남지 않습니다.
   * hits 는 셀 때마다 +1, 게시된 매물 · 요청 제목에 없으면 zero_hits 도 +1(사전이 모자란 말 — v_search_zero_hit_terms).
   * 계정 · IP 를 함께 저장하지 않습니다(INV-SCH1). 한 번에 최대 4개.
   */
  async logTerm(raw: unknown) {
    const q = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (q.length < 2) return { recorded: [] as string[] };
    const words = q.replace(/[^가-힣a-zA-Z0-9\s]/g, ' ').split(/\s+/)
      .map((w) => w.replace(/(에서|으로|에게|중에|중|에|의|를|을|는|은|이|가|와|과|도|만|까지|부터)$/, ''))
      .filter((w) => w.length >= 2 && w.length <= 15 && !SEARCH_STOP.includes(w));
    const cands: string[] = [];
    const phrase = q.toLowerCase();
    if (phrase.length <= 20 && phrase.split(' ').length <= 3) cands.push(phrase);
    words.forEach((w) => cands.push(w.toLowerCase()));
    const uniq = [...new Set(cands)].filter((t) => !/\d{3,}/.test(t) && !t.includes('@')).slice(0, 6);
    if (!uniq.length) return { recorded: [] as string[] };

    const blockRows = await this.db.query<{ t: string }>(
      `SELECT lower(term) AS t FROM restrict_vocab
        UNION SELECT lower(name) FROM restricted_industries WHERE is_active AND mode IN ('BLOCK','AD_ONLY')`);
    const blocked = blockRows.map((r) => r.t).filter(Boolean);

    const recorded: string[] = [];
    for (const t0 of uniq) {
      if (recorded.length >= 4) break;
      const [n] = await this.db.query<{ canonical: string | null }>(
        `SELECT canonical FROM fn_search_normalize($1)`, [t0]);
      const term = (n?.canonical ?? t0).toLowerCase().trim();
      if (!term || recorded.includes(term) || blocked.some((b) => term.includes(b))) continue;
      const [chk] = await this.db.query<{ titled: boolean; known: boolean }>(
        `SELECT (EXISTS (SELECT 1 FROM listings WHERE status='PUBLISHED' AND lower(title) LIKE fn_search_like($1))
              OR EXISTS (SELECT 1 FROM requests WHERE status='PUBLISHED' AND lower(title) LIKE fn_search_like($1))) AS titled,
                (EXISTS (SELECT 1 FROM categories WHERE status='APPROVED' AND restricted_code IS NULL AND lower(name) LIKE fn_search_like($1))
              OR EXISTS (SELECT 1 FROM search_synonyms WHERE lower(canonical) = $1 OR lower(term) = $1)) AS known`, [term]);
      if (!chk?.titled && !chk?.known) continue;
      await this.db.query(
        `INSERT INTO search_term_stats (term, hits, zero_hits, updated_at) VALUES ($1, 1, $2, now())
         ON CONFLICT (term) DO UPDATE SET hits = search_term_stats.hits + 1,
               zero_hits = search_term_stats.zero_hits + EXCLUDED.zero_hits, updated_at = now()`,
        [term, chk.titled ? 0 : 1]);
      recorded.push(term);
    }
    return { recorded };
  }
}

/* sug.ts 의 STOP 과 같은 목록(검색어 집계에서 뺄 군더더기) */
const SEARCH_STOP = ['가장', '제일', '많이', '되는', '있는', '싶은', '하는', '좋은', '어떤', '무슨', '추천', '해줘', '주세요', '알려', '찾아', '찾아요', '찾습니다', '있어', '있나요'];

