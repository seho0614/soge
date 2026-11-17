import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { maskMail } from '../../common/mail/mail-admin.service';

export const FAQ_TOPICS = ['ACCOUNT', 'DEAL', 'MONEY', 'MALL', 'ADS', 'SAFETY', 'ETC'] as const;
export const FAQ_CHANNELS = ['FAQ', 'CS', 'GUIDE', 'BOT'] as const;
export const FAQ_TOP_MAX = 10;

/** 운영 화면이 보내는 값(새로 만들기는 모두 · 고치기는 바꿀 칸만) */
export interface FaqInput {
  category?: string; question?: string; answer?: string; topic?: string; channels?: string[]; keywords?: string[];
  linkHref?: string; linkLabel?: string; handoff?: boolean; gwanCode?: string; sortOrder?: number; isTop?: boolean; isActive?: boolean;
}

/**
 * v10.332 (D224 · docs/463) — 운영 화면 「자주 묻는 질문」 관리(SB-ADM-SIT-100)
 *
 *   대표 11/17 「고객센터 … 보통의 고객센터 기능」 → 「기본 + 운영 화면 FAQ 관리」.
 *   전에는 질문 글을 마이그레이션으로만 바꿀 수 있었습니다. 이제 ADMIN · SUPER 가 등록 · 고치기 · 숨기기 · 순서 · 「많이 찾는 질문」을 정합니다.
 *   지우기는 없습니다(숨기기 = is_active false). 바꿀 때마다 감사 기록(FAQ_CREATE · FAQ_UPDATE — 컨트롤러 @Audit).
 *   사용자 웹은 GET /faq 를 그대로 읽습니다(고객센터 · 이용안내 · 챗봇 · AI 상담).
 */
@Injectable()
export class FaqAdminService {
  constructor(private readonly db: DatabaseService) {}

  async list() {
    const rows = await this.db.query<Record<string, unknown> & { by: string | null }>(
      `SELECT f.id::text AS id, f.category, f.question, f.answer, f.topic, f.is_top AS "isTop", f.is_active AS "isActive",
              f.channels, f.keywords, f.link_href AS "linkHref", f.link_label AS "linkLabel", f.handoff,
              f.gwan_code AS "gwanCode", f.sort_order AS "sortOrder", f.updated_at AS "updatedAt", a.email AS by,
              coalesce(d.views, 0)::int AS views30, coalesce(d.yes, 0)::int AS yes30, coalesce(d.no, 0)::int AS no30
         FROM faqs f LEFT JOIN accounts a ON a.id = f.updated_by
         LEFT JOIN (SELECT faq_id, sum(views) AS views, sum(yes) AS yes, sum(no) AS no FROM faq_daily
                     WHERE day > (now() AT TIME ZONE 'Asia/Seoul')::date - 30 GROUP BY faq_id) d ON d.faq_id = f.id
        ORDER BY f.is_active DESC, f.sort_order, f.category, f.question`);
    const top = rows.filter((r) => r.isActive && r.isTop).length;
    /* v10.334 (D226) — 「많이 찾는 질문 후보」: 보이는 질문 중 아직 TOP 이 아닌 것 · 최근 30일 펼침 순 10개 */
    const candidates = rows.filter((r) => r.isActive && !r.isTop && Number(r.views30) > 0)
      .sort((x, y) => Number(y.views30) - Number(x.views30)).slice(0, 10).map((r) => ({ id: r.id, question: r.question, views30: r.views30 }));
    /* v10.336 (D228) — 「못 찾은 낱말 30일」: 다룸 표시 뒤 다시 찾은 것만 다시 나옴 · 횟수 순 20개 */
    const misses = await this.db.query<{ word: string; hits30: number; last: string }>(
      `SELECT m.word, sum(m.hits)::int AS hits30, max(m.day)::text AS last
         FROM faq_search_misses m LEFT JOIN faq_search_miss_done d ON d.word = m.word
        WHERE m.day > (now() AT TIME ZONE 'Asia/Seoul')::date - 30
          AND (d.word IS NULL OR m.day > (d.done_at AT TIME ZONE 'Asia/Seoul')::date)
        GROUP BY m.word ORDER BY sum(m.hits) DESC, max(m.day) DESC, m.word LIMIT 20`);
    return { rows: rows.map((r) => ({ ...r, by: maskMail(r.by) })), topics: FAQ_TOPICS, channels: FAQ_CHANNELS, topMax: FAQ_TOP_MAX, top, candidates, misses };
  }

  /** v10.336 (D228) — 못 찾은 낱말 「다룸」(새 질문을 만들었거나 다룰 필요 없음). 다시 찾으면 목록에 다시 나옴 */
  async missDone(word: string) {
    const w = (word ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
    if (w.length < 2 || w.length > 40) throw new PolicyViolation('FAQ_MISS_WORD', '낱말은 2 ~ 40자입니다.');
    const [hit] = await this.db.query(`SELECT 1 FROM faq_search_misses WHERE word = $1 LIMIT 1`, [w]);
    if (!hit) throw new NotFound('그 낱말은 못 찾은 낱말 목록에 없습니다.');
    await this.db.query(
      `INSERT INTO faq_search_miss_done (word, done_by, done_at) VALUES ($1, $2, now())
       ON CONFLICT (word) DO UPDATE SET done_by = EXCLUDED.done_by, done_at = now()`, [w, RequestCtx.actorId() ?? null]);
    return { ok: true, word: w, note: `「${w}」을(를) 다룸으로 표시했습니다. 다시 찾는 사람이 있으면 목록에 다시 나옵니다.` };
  }

  private clean(v: FaqInput, base: Required<Pick<FaqInput, 'channels'>> & FaqInput) {
    const t = (s: string | undefined, max: number) => (s ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
    const out = {
      category: v.category !== undefined ? t(v.category, 20) : base.category ?? '',
      question: v.question !== undefined ? t(v.question, 200) : base.question ?? '',
      answer: v.answer !== undefined ? t(v.answer, 3000) : base.answer ?? '',
      topic: v.topic ?? base.topic ?? 'ETC',
      channels: [...new Set(v.channels ?? base.channels)],
      keywords: [...new Set((v.keywords ?? base.keywords ?? []).map((k) => t(k, 20)).filter(Boolean))].slice(0, 10),
      linkHref: v.linkHref !== undefined ? (t(v.linkHref, 200) || null) : (base.linkHref ?? null),
      linkLabel: v.linkLabel !== undefined ? (t(v.linkLabel, 30) || null) : (base.linkLabel ?? null),
      handoff: v.handoff ?? base.handoff ?? false,
      gwanCode: v.gwanCode !== undefined ? (t(v.gwanCode, 10) || null) : (base.gwanCode ?? null),
      sortOrder: v.sortOrder ?? base.sortOrder ?? 0,
      isTop: v.isTop ?? base.isTop ?? false,
      isActive: v.isActive ?? base.isActive ?? true,
    };
    if (out.category.length < 1) throw new PolicyViolation('FAQ_CATEGORY', '분류(짧은 이름)를 적어 주십시오.');
    if (out.question.length < 2) throw new PolicyViolation('FAQ_QUESTION', '질문을 2자 이상 적어 주십시오.');
    if (out.answer.length < 2) throw new PolicyViolation('FAQ_ANSWER', '답을 2자 이상 적어 주십시오.');
    if (!(FAQ_TOPICS as readonly string[]).includes(out.topic)) throw new PolicyViolation('FAQ_TOPIC', '고객센터 분야가 올바르지 않습니다.');
    if (!out.channels.length || out.channels.some((c) => !(FAQ_CHANNELS as readonly string[]).includes(c))) {
      throw new PolicyViolation('FAQ_CHANNELS', '나오는 곳(고객센터 · 이용안내 · 챗봇)을 하나 이상 고르십시오.');
    }
    if (out.linkHref && (!out.linkHref.startsWith('/') || out.linkHref.startsWith('//'))) {
      throw new PolicyViolation('FAQ_LINK', '「…에서 보기」 주소는 사이트 안 주소(/ 로 시작)만 됩니다.');
    }
    if (out.linkHref && !out.linkLabel) throw new PolicyViolation('FAQ_LINK', '「…에서 보기」 단추 글자를 적어 주십시오.');
    if (!Number.isInteger(out.sortOrder) || out.sortOrder < 0 || out.sortOrder > 9999) throw new PolicyViolation('FAQ_SORT', '순서는 0 ~ 9999 입니다.');
    return out;
  }

  private async guard(o: ReturnType<FaqAdminService['clean']>, id: string | null) {
    if (o.gwanCode) {
      const [g] = await this.db.query(`SELECT 1 FROM gwans WHERE code = $1`, [o.gwanCode]);
      if (!g) throw new PolicyViolation('FAQ_GWAN', '그 관이 없습니다.');
    }
    if (o.isActive) {
      const [d] = await this.db.query(`SELECT 1 FROM faqs WHERE is_active AND question = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)`, [o.question, id]);
      if (d) throw new StateConflict('FAQ_DUPLICATE', '같은 질문이 이미 있습니다 — 그 질문을 고치십시오.');
    }
    if (o.isActive && o.isTop) {
      const [c] = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM faqs WHERE is_active AND is_top AND ($1::uuid IS NULL OR id <> $1::uuid)`, [id]);
      if ((c?.n ?? 0) >= FAQ_TOP_MAX) throw new PolicyViolation('FAQ_TOP_FULL', `「많이 찾는 질문」은 ${FAQ_TOP_MAX}개까지입니다 — 다른 질문을 먼저 내리십시오.`);
    }
  }

  async create(v: FaqInput) {
    const o = this.clean(v, { channels: ['FAQ', 'CS'] });
    await this.guard(o, null);
    const [r] = await this.db.query<{ id: string }>(
      `INSERT INTO faqs (category, question, answer, topic, channels, keywords, link_href, link_label, handoff, gwan_code, sort_order, is_top, is_active, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5::text[], $6::text[], $7, $8, $9, $10, $11, $12, $13, $14, now()) RETURNING id::text AS id`,
      [o.category, o.question, o.answer, o.topic, o.channels, o.keywords, o.linkHref, o.linkLabel, o.handoff, o.gwanCode, o.sortOrder, o.isTop, o.isActive, RequestCtx.actorId() ?? null]);
    return { ok: true, id: r!.id, note: `질문을 등록했습니다 — 사용자 웹 고객센터에 ${o.isActive ? '바로 나갑니다' : '숨긴 채 저장했습니다'}.` };
  }

  async update(id: string, v: FaqInput) {
    const [cur] = await this.db.query<Required<FaqInput>>(
      `SELECT category, question, answer, topic, channels, keywords, link_href AS "linkHref", link_label AS "linkLabel", handoff,
              gwan_code AS "gwanCode", sort_order AS "sortOrder", is_top AS "isTop", is_active AS "isActive" FROM faqs WHERE id = $1::uuid`, [id]);
    if (!cur) throw new NotFound('그 질문이 없습니다.');
    const o = this.clean(v, cur);
    await this.guard(o, id);
    await this.db.query(
      `UPDATE faqs SET category = $2, question = $3, answer = $4, topic = $5, channels = $6::text[], keywords = $7::text[], link_href = $8, link_label = $9,
              handoff = $10, gwan_code = $11, sort_order = $12, is_top = $13, is_active = $14, updated_by = $15, updated_at = now()
        WHERE id = $1::uuid`,
      [id, o.category, o.question, o.answer, o.topic, o.channels, o.keywords, o.linkHref, o.linkLabel, o.handoff, o.gwanCode, o.sortOrder, o.isTop, o.isActive, RequestCtx.actorId() ?? null]);
    const what = cur.isActive !== o.isActive ? (o.isActive ? '다시 보이게 했습니다' : '숨겼습니다(사용자 웹에서 빠짐)') : '고쳤습니다';
    return { ok: true, id, note: `질문을 ${what}.` };
  }
}
