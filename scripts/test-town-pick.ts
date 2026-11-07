/**
 * 동네픽 AI 큐레이션 시험 (v10.211 · D188 · src/modules/community/town-pick.service.ts).
 *
 * 진짜 DB(DATABASE_URL — 통합 검정은 sgb_check) 위에서 **거래 하나 안에서** 시험하고 되돌립니다(자료가 남지 않음).
 * AI 는 가짜(밖으로 나가지 않음) — 받은 자료 · 지시문을 보고 정해진 답을 돌려줍니다.
 *   ① AI 답 읽기 — 틀린 번호 · 빈 글 · 같은 번호 버림 · 3개까지 · 코드 울타리 허용 · JSON 아니면 오류
 *   ② 통로가 닫히면 아무것도 부르지 않음(skipped)
 *   ③ 고르기 — 동네 인증 회원 글(시 · 구) · 맛집 글(가게 주소) · 운영자 글 · 광고 표시 · 신고 글은 보내지 않음 · 연락처는 표시로 · 후보 대기
 *   ④ 같은 글은 다시 후보가 되지 않음 · 승인 → 공개 보기 · 거절 · 다시 처리 막힘 · 지우기 막힘
 *
 * 실행:  npx ts-node -P tsconfig.scripts.json scripts/test-town-pick.ts
 */
import { Client } from 'pg';
import { TownPickService, parseTownPicks } from '../src/modules/community/town-pick.service';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

async function main() {
  const p1 = parseTownPicks('```json\n{"picks":[{"n":1,"headline":"골목 빵집","summary":"아침 빵이 좋다는 후기"},{"n":9,"headline":"x9","summary":"번호 틀림"},{"n":1,"headline":"같은 번호","summary":"버림"},{"n":2,"headline":"","summary":"빈 제목"},{"n":3,"headline":"셋째","summary":"좋음"},{"n":4,"headline":"넷째","summary":"좋음"},{"n":5,"headline":"다섯째","summary":"넘침"}]}\n```', 5);
  let bad = '';
  try { parseTownPicks('그냥 글', 3); } catch (e: any) { bad = String(e?.message ?? e); }
  ok('① AI 답 읽기 — 틀린 번호 · 같은 번호 · 빈 제목 버림 · 3개까지 · 울타리 허용 · JSON 아니면 오류',
    p1.length === 3 && p1.map((x) => x.n).join(',') === '1,3,4' && /JSON/.test(bad), JSON.stringify(p1.map((x) => x.n)));

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const db = { query: async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows, transaction: async (f: () => Promise<unknown>) => f() };
  const sent: string[] = [];
  let open = false;
  const agent = {
    allowed: async () => (open ? { ok: true, reason: null } : { ok: false, reason: 'CHANNEL_OFF' }),
    provider: async () => ({ name: 'CLAUDE', complete: async (inp: any) => {
      const content = String(inp.messages[0].content); sent.push(content);
      const d = JSON.parse(content);
      return { text: JSON.stringify({ picks: d.posts.slice(0, 1).map((p: any) => ({ n: p.n, headline: `[픽] ${p.title}`.slice(0, 30), summary: '이웃에게 도움이 되는 글입니다.' })) }),
        inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, stopReason: 'end_turn' };
    } }),
    record: async () => 0,
  };
  const svc = new TownPickService(db as any, agent as any);
  await c.query('BEGIN');
  try {
    const r0 = await svc.runBatch();
    ok('② 통로 닫힘 → 아무것도 부르지 않음', r0.affected === 0 && (r0.detail as any).skipped === 'CHANNEL_OFF' && sent.length === 0, JSON.stringify(r0.detail));

    await db.query(`INSERT INTO agent_model_prices (model, input_per_m, output_per_m, cache_read_per_m, as_of) SELECT 'claude-sonnet-5-5', 3, 15, 0.3, current_date WHERE NOT EXISTS (SELECT 1 FROM agent_model_prices WHERE model = 'claude-sonnet-5-5')`).catch(() => undefined);
    await db.query(`UPDATE site_settings SET value = NULL WHERE key = 'agent.review_model'`).catch(() => undefined);
    await db.query(`UPDATE site_settings SET value = '50' WHERE key = 'agent.town_pick.regions_daily'`);
    // 다른 공개 글이 섞이지 않게 — 이 거래 안에서만 최근 글을 이미 후보였던 것처럼 막음(되돌림)
    const mk = async (email: string, staff = false) => {
      const [a] = await db.query(`INSERT INTO accounts (email, password_hash, name, account_type, status) VALUES ($1, 'x', '동네픽시험', 'PERSONAL', 'ACTIVE') RETURNING id`, [email]);
      if (staff) await db.query(`INSERT INTO account_roles (account_id, role) VALUES ($1, 'ADMIN')`, [a.id]);
      return a.id as string;
    };
    const sid = Math.random().toString(36).slice(2, 8);
    const m1 = await mk(`tp1-${sid}@t.local`), st = await mk(`tp2-${sid}@t.local`, true);
    await db.query(`INSERT INTO member_towns (account_id, adm_code, adm_name, expires_at) VALUES ($1, '9999900000', '시험특별시 픽구 픽1동', now() + interval '30 days')`, [m1]);
    await db.query(`INSERT INTO member_towns (account_id, adm_code, adm_name, expires_at) VALUES ($1, '9999900000', '시험특별시 픽구 픽1동', now() + interval '30 days')`, [st]);
    const post = async (author: string, board: string, title: string, body: string, report = 0) => {
      const [p] = await db.query(`INSERT INTO posts (board, author_id, title, body, state, report_count) VALUES ($1, $2, $3, $4, 'PUBLISHED', $5) RETURNING id`, [board, author, title, body, report]);
      await db.query(`UPDATE posts SET state = 'PUBLISHED' WHERE id = $1`, [p.id]);   // 첫 글 검수(대기)를 거친 것으로
      return p.id as string;
    };
    const pA = await post(m1, 'TRADE', '픽구 골목 빵집 이야기', '아침마다 가요. 문의 010-1234-5678');
    const pS = await post(st, 'TRADE', '운영자 글', '운영자가 쓴 글입니다 시험');
    const pR = await post(m1, 'QNA', '신고된 질문', '신고된 글입니다 시험용', 2);
    const [pl] = await db.query(`INSERT INTO town_places (kakao_place_id, name, category, road, sido, sigungu, dong, lat, lng)
      VALUES ($1, '픽국수', '음식점', '시험로 1', '시험특별시', '맛구', '맛1동', 37.5, 127.0) RETURNING id`, [String(9000000000 + Math.floor(Math.random() * 999999999))]);
    const pF = await post(m1, 'FOOD', '맛구 국수집', '국물이 맑고 면이 좋아요');
    await db.query(`INSERT INTO town_food_posts (post_id, place_id) VALUES ($1, $2)`, [pF, pl.id]);
    const pAd = await post(m1, 'FOOD', '광고 국수집', '협찬을 받은 글입니다');
    await db.query(`INSERT INTO town_food_posts (post_id, place_id, sponsored) VALUES ($1, $2, true)`, [pAd, pl.id]);
    const mine = [pA, pF];
    await db.query(`INSERT INTO town_pick_candidates (post_id, source, region, headline, summary, engine)
      SELECT p.id, 'PLAZA', '시험 막음', '막음 막음', '다른 글이 섞이지 않게', 'MOCK' FROM posts p
       WHERE p.state = 'PUBLISHED' AND p.created_at > now() - interval '15 days' AND p.id <> ALL($1::uuid[])
         AND NOT EXISTS (SELECT 1 FROM town_pick_candidates c WHERE c.post_id = p.id)`, [mine.concat([pS, pR, pAd])]);

    open = true;
    const r1 = await svc.runBatch();
    const rows = await db.query(`SELECT post_id::text AS p, region, source, state, headline FROM town_pick_candidates WHERE post_id = ANY($1::uuid[]) ORDER BY region`, [[pA, pF, pS, pR, pAd]]);
    const all = sent.join('\n');
    ok('③ 고르기 — 회원 글은 시 · 구(시험특별시 픽구) · 맛집은 가게 주소(시험특별시 맛구) · 후보 대기 2개',
      r1.affected === 2 && rows.length === 2 && rows.some((x: any) => x.p === pA && x.region === '시험특별시 픽구' && x.source === 'PLAZA')
      && rows.some((x: any) => x.p === pF && x.region === '시험특별시 맛구' && x.source === 'FOOD') && rows.every((x: any) => x.state === 'PENDING'),
      `${r1.affected} · ${JSON.stringify(r1.detail)} · ${JSON.stringify(rows.map((x: any) => [x.region, x.source, x.state]))}`);
    ok('③ 운영자 글 · 신고 글 · 광고 표시 글은 보내지 않음 · 연락처는 [연락처]', !all.includes('운영자 글') && !all.includes('신고된') && !all.includes('광고 국수집')
      && all.includes('[연락처]') && !all.includes('010-1234-5678'), `${sent.length}번 부름`);

    const r2 = await svc.runBatch();
    const ida = rows.find((x: any) => x.p === pA) as any; const idf = rows.find((x: any) => x.p === pF) as any;
    const [ca] = await db.query(`SELECT id::text AS id FROM town_pick_candidates WHERE post_id = $1`, [pA]);
    const [cf] = await db.query(`SELECT id::text AS id FROM town_pick_candidates WHERE post_id = $1`, [pF]);
    await svc.approve(ca.id, '고친 제목 빵집', undefined);
    await svc.reject(cf.id, '시험 거절 사유');
    let again = '';
    try { await svc.approve(ca.id); } catch (e: any) { again = e?.getResponse?.()?.code ?? String(e); }
    const pub = await svc.publicPicks('시험특별시 픽구');
    const pubAll = await svc.publicPicks('없는시 없는구');
    await c.query('SAVEPOINT sp');
    let del = '';
    try { await db.query(`DELETE FROM town_pick_candidates WHERE id = $1`, [ca.id]); } catch (e: any) { del = String(e?.message ?? e); }
    await c.query('ROLLBACK TO SAVEPOINT sp');
    ok('④ 같은 글 다시 안 고름 · 승인(고친 제목) → 내 시 · 구 공개 · 다른 지역은 전국 최근 · 거절은 안 보임 · 다시 처리 422 · 지우기 막힘',
      r2.affected === 0 && pub.region === '시험특별시 픽구' && pub.items.length === 1 && (pub.items[0] as any).headline === '고친 제목 빵집'
      && pubAll.region === null && pubAll.items.some((x: any) => x.postId === pA) && !pubAll.items.some((x: any) => x.postId === pF)
      && again === 'TOWN_PICK_DECIDED' && /TOWNPICK:/.test(del) && !!ida && !!idf,
      `${r2.affected} · ${pub.region} ${pub.items.length} · ${pubAll.region} · ${again} · ${del.slice(0, 30)}`);
  } finally {
    await c.query('ROLLBACK'); await c.end();
  }
  console.log(fail === 0 ? `동네픽 AI 시험 — 전체 통과 (${pass})` : `동네픽 AI 시험 — 실패 ${fail} / ${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.log('동네픽 AI 시험 — 오류 ' + String(e?.message ?? e).slice(0, 200)); process.exit(1); });
