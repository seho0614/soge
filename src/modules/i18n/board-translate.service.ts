import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { AgentService } from '../agent/agent.service';
import { AgentProvider } from '../agent/agent.provider';
import { I18nService } from './i18n.service';
import { parseTranslation, suspiciousTranslation, translateSystem } from './translate.service';

/** 한 번 누를 때 번역할 댓글 수 상한(아직 번역 안 된 것 중) — 나머지는 다음에 누를 때 */
const MAX_COMMENTS = 50;
/** 엔진 한 번에 보내는 원문 글자 수 — 답(번역문)이 출력 한도에 닿지 않게 나눠 부름 */
const CHUNK_CHARS = 6000;

type Item = { key: string; type: 'POST' | 'COMMENT'; id: string; field: string; src: string };

/**
 * 다국어 3-3 — 소개광장 글 · 댓글 볼 때 번역 (v10.105 · D119 · docs/163).
 *
 *   손님이 「번역 보기」를 누를 때만 부릅니다(열 때마다 부르지 않음 — 열람 수만큼 돈이 나가지 않게).
 *   ① 화면 언어(켜진 다른 언어) ② fn_agent_allowed('BOARD') — 스위치 i18n.board_on_view · AI 전체 · 월 상한 ③ 요금표에 있는 모델
 *   ④ 하루 횟수(fn_board_translate_take — 회원 · 방문자 · 비회원 전체) — 실패하면 되돌림
 *   ⑤ 아직 번역 안 된 칸(같은 원문으로 시도한 적 없는 칸)만 — 글 제목 · 본문 + 댓글 최대 50, 6천 자씩 나눠 부름
 *   ⑥ 칸마다 금칙어 · 원문에 없는 연락처 검사 — 걸린 칸은 승인 대기(DRAFT)로 남김(손님에게는 원문 · 다시 부르지 않음 · 운영 「번역 목록」)
 *      엔진이 거절 · 잘림 · 답 모양이 틀린 묶음은 반려(REJECTED · 원문 자리)로 남겨 다시 부르지 않음
 *   ⑦ 통과한 칸은 MACHINE 으로 저장 → 다음 사람은 비용 없이 봄 ⑧ 사용량 BOARD
 *   같은 글 · 언어를 동시에 누르면 하나만 처리합니다(이 서버 안). 글쓴이 · 댓글 쓴이 본인 화면에는 번역을 얹지 않습니다(CommunityService).
 */
@Injectable()
export class BoardTranslateService {
  private readonly busy = new Set<string>();

  constructor(private readonly db: DatabaseService, private readonly agent: AgentService, private readonly i18n: I18nService) {}

  /** 지금 이 화면에서 번역을 쓸 수 있는가(스위치 · 언어 · 엔진만 — 횟수 · 상한은 누를 때) */
  async available(): Promise<boolean> {
    if (!(await this.agent.provider()) || !(await this.i18n.activeLang())) return false;
    return (await this.agent.allowed('BOARD')).ok;
  }

  /** 아직 번역 안 된 칸 수(글 제목 · 본문 · 보이는 댓글) — 0 이면 「번역 보기」를 보이지 않음 */
  async pending(postId: string, lang: string): Promise<number> {
    const [r] = await this.db.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM unnest(ARRAY['title','body']) f
                 WHERE NOT EXISTS (SELECT 1 FROM v_translation_state v WHERE v.target_type = 'POST' AND v.target_id = $1 AND v.field = f AND v.lang = $2 AND NOT v.is_stale))
             + (SELECT count(*) FROM post_comments c WHERE c.post_id = $1::uuid AND c.state = 'PUBLISHED' AND btrim(c.body) <> ''
                 AND NOT EXISTS (SELECT 1 FROM v_translation_state v WHERE v.target_type = 'COMMENT' AND v.target_id = c.id::text AND v.field = 'body' AND v.lang = $2 AND NOT v.is_stale)))::int AS n`,
      [postId, lang]);
    return r?.n ?? 0;
  }

  async translatePost(postId: string, visitorKey?: string) {
    if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new NotFound('없는 글입니다.');
    const lang = await this.i18n.activeLang();
    if (!lang) throw new PolicyViolation('LANG_NOT_ACTIVE', '지금은 번역할 수 없는 언어입니다.');
    const g = await this.agent.allowed('BOARD');
    const prov = await this.agent.provider();   // v10.111 — 운영 화면 키 먼저, 없으면 .env
    if (!g.ok || !prov) throw new StateConflict('BOARD_TRANSLATE_OFF', '지금은 번역을 쓸 수 없습니다.');
    const model = (await this.setting('i18n.translate_model')) ?? 'claude-haiku-5-5';
    const [priced] = await this.db.query(`SELECT 1 FROM agent_model_prices WHERE model = $1`, [model]);
    if (!priced) throw new StateConflict('MODEL_UNPRICED', '번역 모델 설정을 확인해야 합니다 — 운영자에게 알려 주십시오.');
    const me = RequestCtx.actorId();
    const who = me ? `A:${me}` : (visitorKey && /^[A-Za-z0-9-]{8,64}$/.test(visitorKey) ? `V:${visitorKey}` : null);
    if (!who) throw new PolicyViolation('VISITOR_REQUIRED', '방문자 확인이 안 되어 번역할 수 없습니다 — 새로고침 뒤 다시 눌러 주십시오.');

    const lock = `${postId}:${lang}`;
    if (this.busy.has(lock)) throw new StateConflict('BOARD_TRANSLATE_BUSY', '지금 번역하는 중입니다 — 잠시 뒤 새로고침해 주십시오.');
    this.busy.add(lock);
    try {
      const [p] = await this.db.query<{ title: string; body: string }>(`SELECT title, body FROM posts WHERE id = $1 AND state = 'PUBLISHED'`, [postId]);
      if (!p) throw new NotFound('없는 글입니다.');
      // 아직 시도 안 한 칸만(같은 원문으로 만든 줄이 있으면 상태와 상관없이 뺌) — 댓글은 거른 뒤 50개
      const comments = await this.db.query<{ id: string; body: string }>(
        `SELECT c.id::text, c.body FROM post_comments c
          WHERE c.post_id = $1 AND c.state = 'PUBLISHED' AND btrim(c.body) <> ''
            AND NOT EXISTS (SELECT 1 FROM v_translation_state v WHERE v.target_type = 'COMMENT' AND v.target_id = c.id::text AND v.field = 'body' AND v.lang = $2 AND NOT v.is_stale)
          ORDER BY coalesce(c.parent_id, c.id), c.created_at LIMIT ${MAX_COMMENTS}`, [postId, lang]);
      const have = new Set((await this.db.query<{ field: string }>(
        `SELECT field FROM v_translation_state WHERE target_type = 'POST' AND target_id = $1 AND lang = $2 AND NOT is_stale`, [postId, lang])).map((x) => x.field));
      const todo: Item[] = [];
      if (p.title?.trim() && !have.has('title')) todo.push({ key: 't', type: 'POST', id: postId, field: 'title', src: p.title });
      if (p.body?.trim() && !have.has('body')) todo.push({ key: 'b', type: 'POST', id: postId, field: 'body', src: p.body });
      comments.forEach((c, i) => todo.push({ key: `c${i}`, type: 'COMMENT', id: c.id, field: 'body', src: c.body }));
      if (!todo.length) return { ok: true, translated: 0, held: 0, skipped: 0, note: '이미 번역되어 있습니다.' };

      // 하루 횟수 — 사람 · 비회원 전체. 하나라도 넘으면 앞에서 올린 것을 되돌림
      const takes: string[] = [];
      const take = async (w: string, lim: number) => {
        const [t] = await this.db.query<{ ok: boolean }>(`SELECT fn_board_translate_take($1, $2) AS ok`, [w, lim]);
        if (t?.ok) takes.push(w);
        return !!t?.ok;
      };
      const giveBack = async () => { for (const w of takes) await this.db.query(`SELECT fn_board_translate_give($1)`, [w]); };
      const limit = Number((await this.setting(me ? 'i18n.board_daily_member' : 'i18n.board_daily_guest')) ?? 0);
      if (!(await take(who, limit))) throw new PolicyViolation('BOARD_TRANSLATE_LIMIT', `오늘 번역 횟수(${limit}회)를 다 쓰셨습니다. 내일 다시 쓰실 수 있습니다.`);
      if (!me && !(await take('G:ALL', Number((await this.setting('i18n.board_daily_guest_total')) ?? 0)))) {
        await giveBack();
        throw new PolicyViolation('BOARD_TRANSLATE_LIMIT', '오늘은 비회원 번역이 모두 찼습니다. 로그인하시면 쓰실 수 있습니다.');
      }

      let saved = 0, held = 0, failed = 0;
      try {
        for (const chunk of this.chunks(todo)) {
          if (!(await this.agent.allowed('BOARD')).ok) break;   // 도중에 상한에 닿으면 멈춤(남은 칸은 다음에)
          const r = await this.translateChunk(chunk, lang, model, prov);
          saved += r.saved; held += r.held; failed += r.failed;
        }
      } catch (e) {
        if (!saved && !held && !failed) await giveBack();   // 아무것도 못 했으면 횟수를 돌려줌
        throw e;
      }
      if (!saved && !held && !failed) await giveBack();
      return { ok: true, translated: saved, held: held + failed, skipped: 0 };
    } finally {
      this.busy.delete(lock);
    }
  }

  /** 원문 글자 수로 나눔(한 칸이 예산보다 길면 그 칸 혼자) */
  private chunks(items: Item[]): Item[][] {
    const out: Item[][] = [];
    let cur: Item[] = [], n = 0;
    for (const x of items) {
      if (cur.length && n + x.src.length > CHUNK_CHARS) { out.push(cur); cur = []; n = 0; }
      cur.push(x); n += x.src.length;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  private async translateChunk(chunk: Item[], lang: string, model: string, prov: AgentProvider): Promise<{ saved: number; held: number; failed: number }> {
    const engine = prov.name === 'MOCK' ? 'MOCK' : 'CLAUDE';
    const reply = await prov.complete({ model, system: translateSystem(lang, 'posts and comments from a community board of a referral marketplace'),
      messages: [{ role: 'user', content: JSON.stringify(Object.fromEntries(chunk.map((x) => [x.key, x.src]))) }], maxTokens: 16000, effort: 'low' });
    await this.agent.record('BOARD', model, reply.inputTokens, reply.outputTokens, reply.cacheReadTokens);
    let tr: Record<string, string> | null = null;
    let why = '';
    if (reply.stopReason === 'refusal') why = 'MT_REFUSAL';
    else if (reply.stopReason === 'max_tokens') why = 'MT_TOO_LONG';
    else {
      try { tr = prov.name === 'MOCK' ? Object.fromEntries(chunk.map((x) => [x.key, `[MOCK ${lang}] ${x.src}`])) : parseTranslation(reply.text, chunk.map((x) => x.key)); }
      catch { why = 'MT_BAD_REPLY'; }
    }
    if (!tr) {   // 묶음 전체를 반려로 남겨 같은 원문으로 다시 부르지 않음(원문이 고쳐지면 낡음 → 다시 번역 가능)
      for (const x of chunk) await this.save(x, lang, x.src, 'REJECTED', engine, why);
      return { saved: 0, held: 0, failed: chunk.length };
    }
    let saved = 0, held = 0;
    for (const x of chunk) {
      const text = tr[x.key];
      const b = await this.db.query(`SELECT 1 FROM fn_check_banned_words($1, NULL) WHERE severity = 'BLOCK' LIMIT 1`, [text]);
      if (b.length || suspiciousTranslation(x.src, text)) { await this.save(x, lang, text, 'DRAFT', engine, null); held++; continue; }
      await this.save(x, lang, text, 'MACHINE', engine, null); saved++;
    }
    return { saved, held, failed: 0 };
  }

  /** 저장 — 사람이 넣은 칸 · 반려한 칸은 같은 원문이면 덮지 않음 */
  private async save(x: Item, lang: string, text: string, status: 'MACHINE' | 'DRAFT' | 'REJECTED', engine: string, reason: string | null) {
    await this.db.query(
      `INSERT INTO content_translations (target_type, target_id, field, lang, text, source_hash, status, engine, approved_at, reject_reason)
       VALUES ($1, $2, $3, $4, $5, md5($6), $7, $8, CASE WHEN $7 = 'DRAFT' THEN NULL ELSE now() END, $9)
       ON CONFLICT (target_type, target_id, field, lang) DO UPDATE
         SET text = EXCLUDED.text, source_hash = EXCLUDED.source_hash, status = EXCLUDED.status, engine = EXCLUDED.engine,
             translated_by = NULL, translated_at = now(), approved_by = NULL, approved_at = EXCLUDED.approved_at, reject_reason = EXCLUDED.reject_reason
         WHERE content_translations.source_hash <> EXCLUDED.source_hash
            OR (content_translations.engine <> 'MANUAL' AND content_translations.status <> 'REJECTED')`,
      [x.type, x.id, x.field, lang, text, x.src, status, engine, reason]);
  }

  private async setting(key: string): Promise<string | null> {
    const [r] = await this.db.query<{ value: string }>(`SELECT value FROM site_settings WHERE key = $1`, [key]);
    return r?.value ?? null;
  }
}
