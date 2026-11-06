import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { AppError, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { I18nService } from '../i18n/i18n.service';
import { publicAuthor } from './community.service';

/** v10.177 (D166) — 회원 투표를 운영이 다시 보이게 할 때 처리 전 신고를 닫는 문구 — 신고한 사람에게 그대로 보입니다 */
const POLL_UNHIDE_RESOLUTION = '운영 확인 결과 규칙에 어긋나지 않는 투표로 보고 다시 보이게 했습니다.';

/** 미리보기 로봇 · 스크립트는 사람이 아닙니다 — 표로 세지 않습니다 */
const BOT_UA = /bot|crawl|spider|slurp|preview|scrap|facebookexternalhit|embedly|headless|curl\/|wget|python-requests/i;
const VISITOR = /^[A-Za-z0-9-]{8,64}$/;

export interface Voter { visitorKey?: string; ua?: string; ip?: string }

interface PollRow {
  id: string; kind: string; title: string; description: string | null; image: string | null;
  state: string; open: boolean; endsAt: string | null; showOnHome?: boolean; sort?: number;
  hiddenReason?: string | null; createdAt?: string; source?: string; _name?: string | null;
}
interface OptRow { pollId: string; id: string; sort: number; label: string; sub: string | null; image: string | null; votes: number }

/**
 * 소개광장 「이건 어때?」 투표 (D021 · SB-HOM-CMU-040 · SB-ADM-CMU-020 · 메인 SB-HOM-MAIN-010/011).
 *
 * 사장님 결정(2026-10-02): 비로그인도 투표 가능 · 참여 수는 실제 표 수.
 *
 * ── 막는 것은 여기가 아니라 DB 입니다 (fn_poll_vote_guard 등) ──
 *   열린 투표 · 제 보기 · 한 사람 한 표 · 비로그인 허용 여부(설정 poll.guest_vote) · 같은 주소의 하루 한도.
 *   여기서는 **왜 안 되는지 알기 쉬운 응답**만 먼저 돌려줍니다(이미 투표 409 등).
 *
 * 누가 투표했는가
 *   회원      계정(account_id) — 1인 1표. 같은 기기에서 로그인 전에 넣은 비로그인 표와는 따로 셉니다
 *             (비로그인으로 넣고 로그인하면 계정 표를 한 번 더 넣을 수 있습니다 — 비로그인 투표를 허용하는 한 남는 틈입니다.
 *              정확해야 하면 설정 poll.guest_vote 를 off 로 두십시오).
 *   비로그인   방문자 키(사용자 웹의 sgb_visitor 쿠키 → X-Visitor-Key) — 기기 1표.
 *             쿠키를 지우면 다시 투표할 수 있어 표가 부풀 수 있습니다 — 같은 주소(날짜를 섞은 해시)의 하루 한도로 줄입니다.
 *   주소 원문은 저장하지 않습니다.
 */
@Injectable()
export class PollService {
  constructor(private readonly db: DatabaseService, private readonly i18n: I18nService) {}
  private get me() { return RequestCtx.actorId(); }

  private static readonly COLS =
    `p.id, p.kind, p.title, p.description, p.image, p.state,
     (p.state = 'OPEN' AND (p.ends_at IS NULL OR p.ends_at > now())) AS open,
     p.ends_at AS "endsAt", p.source,
     CASE WHEN p.source = 'MEMBER' THEN (SELECT a.name FROM accounts a WHERE a.id = p.created_by) END AS "_name"`;

  private async attach(rows: PollRow[], voter?: Voter) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const opts = await this.db.query<OptRow>(
      `SELECT r.poll_id AS "pollId", r.option_id AS id, r.sort, r.label, r.sub, r.image, r.votes
         FROM v_poll_result r WHERE r.poll_id = ANY($1::uuid[]) ORDER BY r.poll_id, r.sort`, [ids]);
    const vk = voter?.visitorKey && VISITOR.test(voter.visitorKey) ? voter.visitorKey : null;
    /* 「내가 고른 보기」 — 투표할 때 세는 방식과 같아야 합니다(vote · fn_poll_vote_guard).
       로그인했으면 **계정의 표만**, 비로그인이면 방문자 키의 표만 봅니다. 둘을 섞으면 화면은 「투표했습니다」인데
       서버는 받아 주는 어긋남이 생깁니다(2026-10-03 화면 점검에서 발견 — 비로그인으로 넣고 로그인한 경우). */
    const mine = this.me
      ? await this.db.query<{ pollId: string; optionId: string }>(
          `SELECT v.poll_id AS "pollId", v.option_id AS "optionId"
             FROM poll_votes v WHERE v.poll_id = ANY($1::uuid[]) AND v.account_id = $2::uuid`, [ids, this.me])
      : vk
        ? await this.db.query<{ pollId: string; optionId: string }>(
            `SELECT v.poll_id AS "pollId", v.option_id AS "optionId"
               FROM poll_votes v WHERE v.poll_id = ANY($1::uuid[]) AND v.account_id IS NULL AND v.visitor_key = $2`, [ids, vk])
        : [];
    return rows.map(({ _name, ...p }) => {
      const options = opts.filter((o) => o.pollId === p.id).map(({ pollId: _p, ...o }) => o);
      return {
        ...p,
        /* v10.177 (D166) — 회원 투표는 만든 사람을 첫 글자만(김OO · 소개광장 글과 같은 표기) · 운영 투표는 null */
        author: p.source === 'MEMBER' ? publicAuthor(_name) : null,
        total: options.reduce((s, o) => s + o.votes, 0),
        options,
        myOptionId: mine.find((m) => m.pollId === p.id)?.optionId ?? null,
      };
    });
  }

  /** 공개 목록 — home 이면 메인에 낼 것(종류마다 1건: 비교해요 · 궁금해요 · 써본 의견), 아니면 열린 것 + 마감된 것 */
  async list(scope: string | undefined, voter?: Voter) {
    const rows = scope === 'home'
      ? await this.db.query<PollRow>(
          `SELECT ${PollService.COLS}
             FROM polls p JOIN v_poll_home h ON h.id = p.id
            ORDER BY CASE p.kind WHEN 'VS' THEN 1 WHEN 'ASK' THEN 2 ELSE 3 END`)
      : await this.db.query<PollRow>(
          `SELECT ${PollService.COLS}
             FROM polls p
            WHERE p.state IN ('OPEN', 'CLOSED')
            ORDER BY (p.state = 'OPEN' AND (p.ends_at IS NULL OR p.ends_at > now())) DESC, p.sort, p.opened_at DESC NULLS LAST, p.created_at DESC
            LIMIT 60`);
    return this.translated(await this.attach(rows, voter));
  }

  /** v10.119 — 손님 화면의 투표 · 보기 번역(POLL · POLL_OPT · D125). 운영 목록(adminList)은 원문 그대로 */
  private async translated<T extends { title: string; options: Array<Record<string, any>> }>(polls: T[]) {
    await this.i18n.overlay(polls, 'POLL', (p: any) => p.id, { title: 'title', description: 'description' });
    await this.i18n.overlay(polls.flatMap((p) => p.options), 'POLL_OPT', (o) => o.id, { label: 'label', sub: 'sub' });
    return polls;
  }

  async one(id: string, voter?: Voter) {
    const rows = await this.db.query<PollRow>(
      `SELECT ${PollService.COLS} FROM polls p WHERE p.id = $1 AND p.state IN ('OPEN', 'CLOSED')`, [id]);
    if (!rows.length) throw new NotFound('없는 투표입니다.');
    return (await this.translated(await this.attach(rows, voter)))[0];
  }

  async vote(id: string, optionId: string, voter: Voter) {
    const me = this.me ?? null;
    const vk = voter.visitorKey && VISITOR.test(voter.visitorKey) ? voter.visitorKey : null;
    if (!voter.ua || BOT_UA.test(voter.ua)) {
      throw new PolicyViolation('POLL_BOT', '자동 프로그램의 투표는 받지 않습니다.');
    }
    const [p] = await this.db.query<{ state: string; open: boolean }>(
      `SELECT state, (state = 'OPEN' AND (ends_at IS NULL OR ends_at > now())) AS open FROM polls WHERE id = $1`, [id]);
    if (!p || p.state === 'DRAFT' || p.state === 'HIDDEN') throw new NotFound('없는 투표입니다.');
    if (!p.open) throw new PolicyViolation('POLL_CLOSED', '마감된 투표입니다.');

    if (!me) {
      const [g] = await this.db.query<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'poll.guest_vote'`);
      if ((g?.value ?? 'on') !== 'on') {
        throw new AppError(401, { code: 'POLL_LOGIN', message: '로그인한 회원만 투표할 수 있습니다.' });
      }
      if (!vk) {
        throw new AppError(400, {
          code: 'VALIDATION_ERROR', field: 'X-Visitor-Key',
          message: '방문자 키(X-Visitor-Key)가 없거나 형식이 맞지 않습니다. 사용자 웹에서 투표하십시오.',
        });
      }
    }
    const [dup] = await this.db.query(
      `SELECT 1 FROM poll_votes v WHERE v.poll_id = $1
          AND (($2::uuid IS NOT NULL AND v.account_id = $2::uuid)
            OR ($2::uuid IS NULL AND v.account_id IS NULL AND v.visitor_key = $3)) LIMIT 1`, [id, me, vk]);
    if (dup) throw new StateConflict('POLL_VOTED', '이미 투표하셨습니다.');

    /* 주소는 날짜를 섞은 해시로만 — 원문을 남기지 않습니다(attribution 과 같은 방식) */
    const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const secret = process.env.JWT_SECRET ?? process.env.ENC_KEY ?? 'sgb';
    const ipHash = voter.ip ? createHmac('sha256', secret).update(`poll|${day}|${voter.ip}`).digest('hex') : null;

    await this.db.query(
      `INSERT INTO poll_votes (poll_id, option_id, account_id, visitor_key, ip_hash) VALUES ($1, $2, $3, $4, $5)`,
      [id, optionId, me, vk, me ? null : ipHash]);
    return { ok: true, note: '투표했습니다.', poll: await this.one(id, voter) };
  }

  /* ── 운영 ─────────────────────────────────────────────────────── */

  async adminList() {
    const rows = await this.db.query<PollRow>(
      `SELECT ${PollService.COLS}, p.show_on_home AS "showOnHome", p.sort, p.hidden_reason AS "hiddenReason",
              p.created_at AS "createdAt", (h.id IS NOT NULL) AS "onHome", p.report_n AS "reportCount",
              CASE WHEN p.source = 'MEMBER' THEN (SELECT a.name FROM accounts a WHERE a.id = p.created_by) END AS "authorName"
         FROM polls p LEFT JOIN v_poll_home h ON h.id = p.id
        ORDER BY CASE p.state WHEN 'OPEN' THEN 1 WHEN 'DRAFT' THEN 2 WHEN 'CLOSED' THEN 3 ELSE 4 END, p.sort, p.created_at DESC
        LIMIT 200`);
    const items = await this.attach(rows);
    const settings = await this.db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM site_settings WHERE key IN ('poll.guest_vote', 'poll.guest_ip_daily_limit', 'poll.member_create', 'poll.home_autofill')`);
    /* v10.182 (D171 · docs/285) — 메인 3자리(비교해요 · 궁금해요 · 써본 의견): 고른 것 · 자동으로 채운 것 · 비어 있음 */
    const home = await this.db.query<{ kind: string; id: string | null; title: string | null; picked: boolean | null }>(
      `SELECT k.kind, h.id, h.title, p.show_on_home AS picked
         FROM (VALUES ('VS', 1), ('ASK', 2), ('USED', 3)) k(kind, o)
         LEFT JOIN v_poll_home h ON h.kind = k.kind LEFT JOIN polls p ON p.id = h.id
        ORDER BY k.o`);
    return {
      items,
      homeSlots: home.map((h) => ({ kind: h.kind, id: h.id, title: h.title, state: !h.id ? 'EMPTY' : h.picked ? 'PICKED' : 'AUTO' })),
      homeAutofill: (settings.find((s) => s.key === 'poll.home_autofill')?.value ?? 'on') === 'on',
      memberCreate: (settings.find((s) => s.key === 'poll.member_create')?.value ?? 'off') === 'on',   // v10.177 (D166)
      guestVote: (settings.find((s) => s.key === 'poll.guest_vote')?.value ?? 'on') === 'on',
      guestIpDailyLimit: Number(settings.find((s) => s.key === 'poll.guest_ip_daily_limit')?.value ?? 5),
    };
  }

  /* ── v10.200 (docs/316) 메인 빈 자리를 확정 질문으로 ───────────────────
   *  2026-10-03 확정 질문(scripts/seed-polls.sql · v10.15 — 카드 그림과 짝)으로 **비어 있는 종류만** 만들고 바로 엶(표 0 에서 시작).
   *  고른 것 · 자동으로 채운 것이 있는 종류는 건드리지 않음. 같은 제목의 투표가 이미 있으면(마감 · 감춤 포함) 만들지 않고 알려 줌. */
  static readonly HOME_SEED: Record<string, { title: string; description?: string; image?: string; options: { label: string; sub?: string; image?: string }[] }> = {
    VS: { title: '로봇청소기를 산다면, 어느 쪽을 고르시겠어요?', options: [
      { label: '흡입력 우선', sub: '값이 더 나가도 잘 빨아들이는 쪽', image: '/home/d/vs-a.png' },
      { label: '가성비 우선', sub: '기본 기능에 값이 싼 쪽', image: '/home/d/vs-b.png' }] },
    ASK: { title: '소개받아 살 때 가장 먼저 보는 것은?', image: '/home/d/poll-bags.png', options: [
      { label: '가격' }, { label: '써 본 사람의 후기' }, { label: '소개한 사람에 대한 믿음' }, { label: '사후관리(A/S)' }, { label: '브랜드' }] },
    USED: { title: '공기청정기를 써 보신 분들의 의견을 들려주세요!', description: '필터 값 · 소음 · 전기료 — 솔직한 의견을 기다려요.', image: '/home/d/poll-purifier.png', options: [
      { label: '사용 중이에요' }, { label: '사용해봤어요' }, { label: '아직 안 써봤어요' }] },
  };

  fillHome() {
    return this.db.transaction(async () => {
      const empty = await this.db.query<{ kind: string; o: number }>(
        `SELECT k.kind, k.o FROM (VALUES ('VS', 1), ('ASK', 2), ('USED', 3)) k(kind, o)
          WHERE NOT EXISTS (SELECT 1 FROM v_poll_home h WHERE h.kind = k.kind) ORDER BY k.o`);
      const made: string[] = []; const skipped: Array<{ kind: string; why: string }> = [];
      for (const e of empty) {
        const s = PollService.HOME_SEED[e.kind]!;
        const [dup] = await this.db.query<{ state: string }>(`SELECT state FROM polls WHERE title = $1 LIMIT 1`, [s.title]);
        if (dup) { skipped.push({ kind: e.kind, why: `같은 질문이 이미 있음(${dup.state}) — 투표 관리에서 열거나 메인에 고르십시오` }); continue; }
        const [r] = await this.db.query<{ id: string }>(
          `INSERT INTO polls (kind, title, description, image, show_on_home, sort, created_by)
           VALUES ($1, $2, $3, $4, true, $5, $6) RETURNING id`,
          [e.kind, s.title, s.description ?? null, s.image ?? null, e.o, this.me ?? null]);
        await this.putOptions(r!.id, s.options);
        await this.db.query(`UPDATE polls SET state = 'OPEN' WHERE id = $1`, [r!.id]);
        made.push(e.kind);
      }
      const note = !empty.length ? '메인 세 자리가 이미 다 차 있습니다 — 만든 것이 없습니다.'
        : made.length ? `확정 질문으로 ${made.length}건을 만들어 열었습니다(${made.join(' · ')})${skipped.length ? ` · 못 만든 것 ${skipped.length}건` : ''}.`
        : '만들지 못했습니다 — 같은 질문이 이미 있습니다.';
      return { ok: made.length > 0 || !empty.length, made, skipped, note };
    });
  }

  private async putOptions(pollId: string, options: { label: string; sub?: string; image?: string }[]) {
    await this.db.query(`DELETE FROM poll_options WHERE poll_id = $1`, [pollId]);
    for (let i = 0; i < options.length; i++) {
      const o = options[i]!;
      await this.db.query(
        `INSERT INTO poll_options (poll_id, sort, label, sub, image) VALUES ($1, $2, $3, $4, $5)`,
        [pollId, i + 1, o.label.trim(), o.sub?.trim() || null, o.image || null]);
    }
  }

  create(dto: {
    kind: string; title: string; description?: string; image?: string;
    options: { label: string; sub?: string; image?: string }[];
    showOnHome?: boolean; sort?: number; endsAt?: string;
  }) {
    return this.db.transaction(async () => {
      const [r] = await this.db.query<{ id: string; state: string }>(
        `INSERT INTO polls (kind, title, description, image, show_on_home, sort, ends_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, state`,
        [dto.kind, dto.title.trim(), dto.description?.trim() || null, dto.image || null,
         dto.showOnHome ?? false, dto.sort ?? 0, dto.endsAt || null, this.me ?? null]);
      await this.putOptions(r!.id, dto.options);
      return { ok: true, id: r!.id, state: r!.state, note: '만들었습니다. 아직 준비 중이라 보이지 않습니다 — 「열기」를 눌러야 투표를 받습니다.' };
    });
  }

  update(id: string, dto: {
    title?: string; description?: string; image?: string; state?: string; hiddenReason?: string;
    showOnHome?: boolean; sort?: number; endsAt?: string;
    options?: { label: string; sub?: string; image?: string }[];
  }) {
    if (dto.state === 'HIDDEN' && !(dto.hiddenReason && dto.hiddenReason.trim().length >= 5)) {
      throw new PolicyViolation('POLL_HIDE_REASON', '감추는 사유를 5자 이상 적어 주십시오.');
    }
    return this.db.transaction(async () => {
      const [cur] = await this.db.query<{ id: string; state: string; source: string }>(
        `SELECT id, state, source FROM polls WHERE id = $1 FOR UPDATE`, [id]);
      if (!cur) throw new NotFound('없는 투표입니다.');
      /* v10.177 (D166) — 신고로 가려진 회원 투표를 다시 보이게 하면 처리 전 신고를 기각으로 닫고 신고한 분께 알림(소개광장 글 되살리기와 같은 방식).
       *   신고 수 트리거는 OPEN · QUEUED · UPHELD 만 세므로, 다시 보인 뒤에는 **새 신고 3건**이 쌓여야 다시 가려집니다 */
      let dismissed = 0;
      if (cur.source === 'MEMBER' && cur.state === 'HIDDEN' && (dto.state === 'OPEN' || dto.state === 'CLOSED')) {
        await this.db.query(`UPDATE polls SET report_n = 0 WHERE id = $1`, [id]);
        const closed = await this.db.query<{ reporter_id: string | null }>(
          `UPDATE reports
              SET state = 'DISMISSED', resolution = $2, handled_by = $3, handled_at = now()
            WHERE target_type = 'POLL' AND target_id = $1 AND state IN ('OPEN','QUEUED')
            RETURNING reporter_id`, [id, POLL_UNHIDE_RESOLUTION, this.me ?? null]);
        const reporters = [...new Set(closed.map((c) => c.reporter_id).filter((x): x is string => !!x))];
        if (reporters.length) {
          await this.db.query(
            `INSERT INTO notifications (account_id, event_code, title, body, link_url)
             SELECT x, 'REPORT_RESOLVED', '신고 처리 결과를 알려 드립니다', $2, '/my/reports'
               FROM unnest($1::uuid[]) AS x
             ON CONFLICT DO NOTHING`, [reporters, POLL_UNHIDE_RESOLUTION]);
        }
        dismissed = closed.length;
      }
      if (dto.options) await this.putOptions(id, dto.options);
      const [r] = await this.db.query<{ id: string; state: string }>(
        `UPDATE polls SET
            title        = coalesce($2, title),
            description  = CASE WHEN $3::text IS NULL THEN description ELSE nullif(btrim($3), '') END,
            image        = CASE WHEN $4::text IS NULL THEN image ELSE nullif($4, '') END,
            state        = coalesce($5, state),
            hidden_reason = CASE WHEN $5 = 'HIDDEN' THEN $6 ELSE hidden_reason END,
            show_on_home = coalesce($7, show_on_home),
            sort         = coalesce($8, sort),
            ends_at      = CASE WHEN $9::text IS NULL THEN ends_at WHEN $9 = '' THEN NULL ELSE $9::timestamptz END
          WHERE id = $1 RETURNING id, state`,
        [id, dto.title?.trim() ?? null, dto.description ?? null, dto.image ?? null, dto.state ?? null,
         dto.hiddenReason?.trim() ?? null, dto.showOnHome ?? null, dto.sort ?? null, dto.endsAt ?? null]);
      return { ok: true, id: r!.id, state: r!.state, ...(dismissed ? { dismissed } : {}) };
    });
  }

  /* ── v10.177 (D166 · docs/275) 회원이 만드는 투표 ─────────────────────────
   *   막는 것은 DB(fn_poll_member_guard · fn_poll_option_member_guard)입니다 — 스위치 · 가입 뒤 시간 · 24시간 건수 · 종류 · 마감 · 링크 · 금칙어.
   *   여기서는 만들기 화면이 먼저 알 수 있게 「지금 만들 수 있는지」를 돌려주고, 만든 뒤 바로 엽니다(준비 중 단계 없음).
   *   메인에는 나가지 않습니다(운영만 정함). 신고 3건이면 DB 가 감춥니다(fn_report_escalate). */

  /** 지금 만들 수 있는지 — 로그인 전에도 부름(스위치가 꺼졌으면 단추를 감춤) */
  async memberReady() {
    const [r] = await this.db.query<{ open: boolean; lim: number; age: number; joined: string | null; made: number }>(
      `SELECT coalesce((SELECT value FROM site_settings WHERE key = 'poll.member_create'), 'off') = 'on' AS open,
              coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'poll.member_daily_limit'), 3) AS lim,
              coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'poll.member_min_age_hours'), 24) AS age,
              (SELECT a.created_at FROM accounts a WHERE a.id = $1::uuid) AS joined,
              (SELECT count(*)::int FROM polls p WHERE p.created_by = $1::uuid AND p.source = 'MEMBER' AND p.created_at > now() - interval '1 day') AS made`,
      [this.me ?? null]);
    const login = !!this.me;
    const newUntil = r!.joined ? new Date(new Date(r!.joined).getTime() + r!.age * 3600_000) : null;
    const tooNew = !!newUntil && newUntil.getTime() > Date.now();
    const left = Math.max(0, r!.lim - r!.made);
    const reason = !r!.open ? 'OFF' : !login ? 'LOGIN' : tooNew ? 'NEW' : left === 0 ? 'LIMIT' : null;
    return { open: r!.open, login, ready: reason === null, reason, dailyLimit: r!.lim, left: login ? left : null,
             minAgeHours: r!.age, newUntil: tooNew ? newUntil!.toISOString() : null, maxDays: 14 };
  }

  /** 내가 만든 투표 — 감춘 것까지(감춘 까닭은 운영 사유 대신 「신고 · 운영 확인」만) */
  async myPolls() {
    const rows = await this.db.query<PollRow & { reportHidden: boolean }>(
      `SELECT ${PollService.COLS}, p.created_at AS "createdAt",
              (p.state = 'HIDDEN' AND p.report_n >= 3) AS "reportHidden"
         FROM polls p
        WHERE p.created_by = $1 AND p.source = 'MEMBER'
        ORDER BY p.created_at DESC LIMIT 50`, [this.me]);
    return this.attach(rows);
  }

  memberCreate(dto: { kind: string; title: string; description?: string; options: { label: string }[]; days: number }) {
    return this.db.transaction(async () => {
      const [r] = await this.db.query<{ id: string }>(
        `INSERT INTO polls (kind, title, description, source, created_by, ends_at)
         VALUES ($1, $2, $3, 'MEMBER', $4, now() + make_interval(days => $5::int)) RETURNING id`,
        [dto.kind, dto.title.trim(), dto.description?.trim() || null, this.me, dto.days]);
      await this.putOptions(r!.id, dto.options.map((o) => ({ label: o.label })));
      await this.db.query(`UPDATE polls SET state = 'OPEN' WHERE id = $1`, [r!.id]);
      return { ok: true, id: r!.id, state: 'OPEN', note: '투표를 올렸습니다. 마감 전에 「마감하기」로 일찍 닫을 수 있습니다.' };
    });
  }

  async memberClose(id: string) {
    const [r] = await this.db.query<{ id: string }>(
      `UPDATE polls SET state = 'CLOSED' WHERE id = $1 AND created_by = $2 AND source = 'MEMBER' AND state = 'OPEN' RETURNING id`, [id, this.me]);
    if (!r) throw new StateConflict('POLL_NOT_OPEN', '열려 있는 내 투표가 아닙니다.');
    return { ok: true, id, state: 'CLOSED', note: '투표를 마감했습니다.' };
  }

  /** 표가 하나도 없을 때만 지움(표가 들어온 뒤에는 마감만 — 결과가 남아야 합니다) */
  async memberDelete(id: string) {
    const [p] = await this.db.query<{ votes: number }>(
      `SELECT (SELECT count(*)::int FROM poll_votes v WHERE v.poll_id = p.id) AS votes
         FROM polls p WHERE p.id = $1 AND p.created_by = $2 AND p.source = 'MEMBER'`, [id, this.me]);
    if (!p) throw new NotFound('없는 투표입니다.');
    if (p.votes > 0) throw new PolicyViolation('POLL_HAS_VOTES', '표가 들어온 투표는 지울 수 없습니다 — 마감하십시오.');
    await this.db.query(
      `DELETE FROM polls p WHERE p.id = $1 AND p.created_by = $2 AND p.source = 'MEMBER'
          AND NOT EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = p.id)`, [id, this.me]);
    return { ok: true, id, note: '투표를 지웠습니다.' };
  }
}
