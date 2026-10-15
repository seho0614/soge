import { Injectable, Logger } from '@nestjs/common';
import { publicAuthor } from '../community/community.service';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { normSido } from '../../common/region';

const SIDO = ['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주'];

/**
 * 소개자 활동.
 *
 * ── 흐름 ───────────────────────────────────────────────────────────
 *   맞춤 요청 → "제가 알아요" → 초대 → **상대방 동의** → 연결
 *
 * ── 동의 전에는 아무것도 열리지 않습니다 ───────────────────────────
 * 소개자가 지인의 연락처를 허락 없이 넘기는 구조는 개인정보 문제이자
 * 분쟁의 씨앗입니다. 초대는 링크로 보내고, 상대가 동의해야 연결됩니다.
 *
 * 기본은 **소개자 직접 전달**입니다 — 플랫폼이 연락처를 받지 않습니다.
 * 대행 발송을 고르면 연락처를 받되 발송 직후 지웁니다.
 */
@Injectable()
export class IntroducerService {
  private readonly log = new Logger(IntroducerService.name);
  constructor(private readonly db: DatabaseService) {}
  private get me() {
    const id = RequestCtx.actorId();
    if (!id) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    return id;
  }

  /** 내 분야·지역에 맞는 요청. 이미 답한 것은 빠집니다.
   *  v10.31 (시안 introhome 요청 카드) — 요청의 업종 · 본문(앞 200자) · 올린 때 · 급구(마감 3일 안)를 함께,
   *  답한 요청(answered — 내 응답 · 그 요청으로 보낸 초대)은 따로 냅니다. 요청에는 지역 칸이 없어 region 은 null 입니다. */
  async matched() {
    const rows = await this.db.query(
      `SELECT m.request_id AS "requestId", m.title, m.gwan_code AS "gwan",
              m.category_id AS "categoryId", c.name AS category, m.closes_at AS "closesAt",
              left(coalesce(q.body, ''), 200) AS body, q.created_at AS "createdAt", NULL::text AS region,
              (m.closes_at IS NOT NULL AND m.closes_at < now() + interval '3 days') AS urgent
         FROM v_introducer_matched_requests m
         JOIN requests q ON q.id = m.request_id
         LEFT JOIN categories c ON c.id = m.category_id
        WHERE m.introducer_id = $1
        ORDER BY m.closes_at NULLS LAST, q.created_at DESC LIMIT 50`, [this.me]);
    const answered = await this.db.query(
      `SELECT r.request_id AS "requestId", q.title, q.gwan_code AS gwan, c.name AS category,
              left(coalesce(q.body, ''), 200) AS body, q.created_at AS "createdAt", NULL::text AS region,
              r.answer, r.responded_at AS "respondedAt", al.label AS "answerLabel",
              (SELECT count(*)::int FROM introduction_invites i WHERE i.request_id = r.request_id AND i.introducer_id = r.introducer_id) AS invites
         FROM introducer_responses r
         JOIN requests q ON q.id = r.request_id
         LEFT JOIN categories c ON c.id = q.category_id
         LEFT JOIN LATERAL (SELECT CASE r.answer WHEN 'KNOW' THEN '제가 알아요' WHEN 'CHECKING' THEN '확인해 보겠습니다'
                                                 WHEN 'DONT_KNOW' THEN '잘 모릅니다' ELSE '관심 없는 분야' END AS label) al ON true
        WHERE r.introducer_id = $1 AND r.answer IN ('KNOW','CHECKING')
        ORDER BY r.responded_at DESC LIMIT 20`, [this.me]);
    const [prof] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM introducer_profiles WHERE account_id = $1`, [this.me]);
    return { items: rows, answered, registered: !!prof?.n,
      note: rows.length ? null
        : prof?.n ? '지금은 맞는 요청이 없습니다. 분야와 지역을 넓히면 더 많이 보실 수 있습니다.'
        : '소개 분야를 등록하시면 맞는 요청을 보여 드립니다.' };
  }

  /** v10.31 (시안 「내 소개 분야 · 지역」 칩) — 소개자 프로필. 분야 = 업종 코드(categories.code), 지역 = 「시 · 도 짧은 이름 + 시 · 군 · 구」 글(예: 서울 금천구).
   *  지역을 글로 두는 것은 상담 · 업체 활동 지역(partner_regions)과 같은 방식입니다(normSido · D018) — 지역 코드 표(regions)는 아직 비어 있습니다. */
  async profile() {
    const [p] = await this.db.query<any>(
      `SELECT p.grade, gl.label AS "gradeLabel", p.headline, p.categories, p.regions, p.updated_at AS "updatedAt"
         FROM introducer_profiles p
         LEFT JOIN code_labels gl ON gl.domain = 'introducer.grade' AND gl.code = p.grade
        WHERE p.account_id = $1`, [this.me]);
    const cats = p?.categories?.length ? await this.db.query(
      `SELECT DISTINCT ON (code) code, name FROM categories WHERE code = ANY($1::text[]) ORDER BY code, status = 'APPROVED' DESC`, [p.categories]) : [];
    const by = (list: any[], codes: string[]) => (codes ?? []).map((c) => list.find((x) => x.code === c) ?? { code: c, name: c });
    return { registered: !!p, grade: p?.grade ?? null, gradeLabel: p?.gradeLabel ?? null, headline: p?.headline ?? null,
      categories: by(cats, p?.categories), regions: (p?.regions ?? []).map((r: string) => ({ code: r, name: r })), updatedAt: p?.updatedAt ?? null };
  }

  /** 분야 · 지역 바꾸기. 없는 코드는 받지 않습니다. 처음이면 프로필을 만듭니다(새싹 소개자). 분야 · 지역은 각각 10개까지 */
  async updateProfile(dto: { categories?: string[]; regions?: string[]; headline?: string }) {
    const clean = (a?: string[]) => (Array.isArray(a) ? [...new Set(a.map((x) => String(x).trim()).filter(Boolean))] : undefined);
    const cats = clean(dto.categories);
    /* 지역 — 「서울 금천구」처럼 시 · 도(17곳 짧은 이름) + 시 · 군 · 구. 시 · 도 이름은 짧게 맞춥니다(normSido) */
    const regs = clean(dto.regions)?.map((r) => {
      const [sido, ...rest] = r.split(/\s+/);
      const sg = rest.join(' ').trim();
      const sd = normSido(sido);
      if (!SIDO.includes(sd) || !/^[가-힣0-9 ]{1,20}(시|군|구)$/.test(sg)) {
        throw new PolicyViolation('BAD_REGION', `「${r}」 — 지역은 시 · 도와 시 · 군 · 구로 적어 주십시오(예: 서울 금천구).`);
      }
      return `${sd} ${sg}`;
    });
    if ((cats?.length ?? 0) > 10 || (regs?.length ?? 0) > 10) throw new PolicyViolation('TOO_MANY', '분야와 지역은 각각 10개까지 고를 수 있습니다.');
    if (cats?.length) {
      const [{ n }] = await this.db.query<{ n: number }>(
        `SELECT count(DISTINCT code)::int AS n FROM categories WHERE code = ANY($1::text[]) AND status = 'APPROVED'`, [cats]);
      if (n !== cats.length) throw new PolicyViolation('BAD_CATEGORY', '목록에 없는 분야가 있습니다. 목록에서 골라 주십시오.');
    }
    const headline = dto.headline == null ? null : String(dto.headline).trim().slice(0, 100);
    await this.db.query(
      `INSERT INTO introducer_profiles (account_id, categories, regions, headline)
       VALUES ($1, coalesce($2::text[], '{}'), coalesce($3::text[], '{}'), $4)
       ON CONFLICT (account_id) DO UPDATE
         SET categories = coalesce($2::text[], introducer_profiles.categories),
             regions = coalesce($3::text[], introducer_profiles.regions),
             headline = coalesce($4, introducer_profiles.headline), updated_at = now()`,
      [this.me, cats ?? null, regs ?? null, headline]);
    return { ...(await this.profile()), note: '저장했습니다. 맞춤 요청이 새 분야로 바뀝니다.' };
  }

  /** 분야 · 지역 고르기 목록(승인된 업종 · 시 · 군 · 구) */
  async profileOptions() {
    const categories = await this.db.query(
      `SELECT DISTINCT ON (c.code) c.code, c.name, c.gwan_code AS gwan
         FROM categories c WHERE c.status = 'APPROVED' AND c.gwan_code <> 'HLT'
        ORDER BY c.code, c.gwan_code`);
    return { categories, sido: SIDO };
  }

  /** v10.31 (시안 「활동 내역 › 등급」 표) — 등급 기준 · 혜택. 내 등급(now)을 표시합니다 */
  async grades() {
    return this.db.query(
      `SELECT g.code, g.name, g.criteria, g.benefit, g.next_hint AS "nextHint",
              (g.code = (SELECT grade FROM introducer_profiles WHERE account_id = $1)) AS now
         FROM introducer_grades g ORDER BY g.sort_order`, [this.me]);
  }

  /**
   * "제가 알아요" 등 응답.
   *
   * 모른다는 답도 남깁니다 — 그 데이터가 소개자별 분야를 좁혀 줍니다.
   */
  async respond(requestId: string, answer: string, memo?: string) {
    const OK = ['KNOW', 'CHECKING', 'DONT_KNOW', 'NOT_MY_FIELD'];
    if (!OK.includes(answer)) {
      throw new PolicyViolation('BAD_ANSWER', '알 수 없는 응답입니다.');
    }
    const [row] = await this.db.query<any>(
      `INSERT INTO introducer_responses(request_id, introducer_id, answer, memo)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (request_id, introducer_id) DO UPDATE
         SET answer = EXCLUDED.answer, memo = EXCLUDED.memo, responded_at = now()
       RETURNING id, answer`, [requestId, this.me, answer, memo ?? null]);

    return { ...row,
      next: answer === 'KNOW' ? '초대를 보내 상대방의 의사를 물어보십시오.' : null };
  }

  /**
   * 초대 발송.
   *
   * 토큰 원문은 이 응답에만 실립니다. DB 에는 해시만 둡니다 —
   * 덤프나 백업이 새도 링크는 쓸 수 없습니다.
   */
  async invite(requestId: string, inviteeLabel: string, channel = 'SELF') {
    /* v10.31 — 요청 번호 형식을 먼저 봅니다. 전에는 숫자 번호를 넣으면 「형식이 올바르지 않습니다 (uuid).」가 그대로 보였습니다 */
    if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new PolicyViolation('BAD_REQUEST_ID', '소개할 요청을 「맞춤 요청」에서 골라 주십시오.');
    }
    const [rq] = await this.db.query<{ ok: boolean }>(
      `SELECT (status = 'PUBLISHED' AND owner_account_id <> $2) AS ok FROM requests WHERE id = $1`, [requestId, this.me]);
    if (!rq) throw new PolicyViolation('NO_SUCH_REQUEST', '없는 요청입니다. 「맞춤 요청」에서 다시 골라 주십시오.');
    if (!rq.ok) throw new StateConflict('REQUEST_NOT_OPEN', '게시 중인 다른 회원의 요청에만 초대를 보낼 수 있습니다.');
    if (!inviteeLabel?.trim()) {
      throw new PolicyViolation('NO_LABEL', '상대방을 어떻게 부를지 적어 주십시오.');
    }
    const OKC = ['SELF', 'SMS', 'ALIMTALK', 'EMAIL'];
    if (!OKC.includes(channel)) throw new PolicyViolation('BAD_CHANNEL', '알 수 없는 전달 방법입니다.');

    // 대행 발송은 채널이 준비돼야 고를 수 있습니다.
    if (channel !== 'SELF') {
      const [c] = await this.db.query<{ ready: boolean }>(
        'SELECT ready FROM v_notify_channels WHERE channel = $1', [channel]);
      if (!c?.ready) {
        throw new PolicyViolation('CHANNEL_NOT_READY',
          `${channel} 발송이 아직 준비되지 않았습니다. 링크를 직접 전달해 주십시오.`);
      }
    }

    const token = randomBytes(18).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');

    const [row] = await this.db.query<any>(
      `INSERT INTO introduction_invites(request_id, introducer_id, invitee_label, token_hash)
       VALUES ($1,$2,$3,$4)
       RETURNING id, state, expires_at AS "expiresAt"`,
      [requestId, this.me, inviteeLabel.trim(), hash]);

    // SELF 는 연락처를 받지 않습니다. 기록에도 남기지 않습니다.
    await this.db.query(
      `INSERT INTO invite_deliveries(invite_id, channel, state)
       VALUES ($1,$2,$3)`,
      [row.id, channel, channel === 'SELF' ? 'SENT' : 'QUEUED']);

    return { ...row, channel, token,
      link: `/i/${token}`,
      note: channel === 'SELF'
        ? '이 링크를 복사해 카카오톡·문자로 보내시면 됩니다. 소개뱅크는 상대방의 번호를 알지 못합니다.'
        : '발송 후 연락처는 즉시 지워집니다. 재발송하시려면 한 번 더 입력하셔야 합니다.' };
  }

  /** 초대 전달 방법. 준비된 것만 고를 수 있습니다. */
  async channels() {
    return this.db.query(
      `SELECT channel, ready, note FROM v_notify_channels
        WHERE channel <> 'INAPP' ORDER BY (channel='SELF') DESC, channel`);
  }

  async invites() {
    return this.db.query(
      /* v10.31 — 전달(채널) 칸: 그 초대의 첫 전달 기록(SELF 직접 전달 · SMS · ALIMTALK · EMAIL) */
      `SELECT i.id, i.invitee_label AS "label", i.state, i.created_at AS "createdAt",
              i.expires_at AS "expiresAt", i.consented_at AS "consentedAt",
              r.title AS "request", dl.channel,
              CASE dl.channel WHEN 'SELF' THEN '직접 전달' WHEN 'SMS' THEN '문자' WHEN 'ALIMTALK' THEN '카카오 알림톡'
                              WHEN 'EMAIL' THEN '이메일' END AS "channelLabel"
         FROM introduction_invites i
         JOIN requests r ON r.id = i.request_id
         LEFT JOIN LATERAL (SELECT channel FROM invite_deliveries d WHERE d.invite_id = i.id ORDER BY d.queued_at LIMIT 1) dl ON true
        WHERE i.introducer_id = $1
        ORDER BY i.created_at DESC LIMIT 50`, [this.me]);
  }

  /** 활동·등급. 건수가 아니라 수락률과 만족도로 정해집니다. */
  async activity() {
    const [card] = await this.db.query<any>(
      `SELECT grade, is_founding AS "isFounding", responses, invites_sent AS "invitesSent",
              invites_consented AS "invitesConsented", valid_connections AS "validConnections",
              reported, consent_rate AS "consentRate", avg_rating AS "avgRating"
         FROM v_introducer_scorecard WHERE account_id = $1`, [this.me]);
    if (!card) return { registered: false, note: '소개자 프로필을 먼저 등록해 주십시오.' };
    /* v10.31 — 등급 이름 · 다음 등급 조건(시안 「유효 연결 3건이면 전문 소개자」) */
    const [g] = await this.db.query<{ name: string; next: string | null }>(
      `SELECT name, next_hint AS next FROM introducer_grades WHERE code = $1`, [card.grade]);
    return { registered: true, ...card, gradeLabel: g?.name ?? card.grade, nextGrade: g?.next ?? null };
  }

  /**
   * 포인트.
   *
   * 적립과 사용 가능을 나눠 냅니다. 섞으면 "왜 못 쓰냐"는 문의가 그대로 옵니다 —
   * 유효 연결이 확인돼야 열립니다.
   */
  async points() {
    const rows = await this.db.query<any>(
      `SELECT l.id, r.name, l.points, l.redeemable, l.earned_at AS "earnedAt"
         FROM point_ledger l JOIN point_rules r ON r.code = l.rule_code
        WHERE l.account_id = $1 ORDER BY l.earned_at DESC LIMIT 100`, [this.me]);
    const earned = rows.reduce((a, r) => a + Number(r.points), 0);
    const usable = rows.filter(r => r.redeemable).reduce((a, r) => a + Number(r.points), 0);
    /* v10.31 (시안 「8,500원」) — 포인트는 1포인트 = 1원으로 「원」 단위로 표기합니다 */
    return { earned, usable, rows, unit: '원',
      note: '프로필 작성이나 초대 발송만으로 받은 포인트는 유효한 연결이 확인된 뒤에 열립니다.' };
  }

  /* ── 초대받은 사람 (비회원) ────────────────────────────────────── */

  /**
   * 초대 확인.
   *
   * 아직 회원이 아닙니다. 가입을 먼저 요구하면 대부분 여기서 나갑니다 —
   * 동의가 먼저입니다.
   */
  async viewInvite(token: string) {
    const hash = createHash('sha256').update(token).digest('hex');
    const [inv] = await this.db.query<any>(
      /* v10.31 — 시안 scInviteConsent: 소개하는 분(등급 · 유효 연결) · 「어떤 요청입니까」(제목 · 지역 · 업종 · 내용) · 만료일.
       *   로그인 없이 열리는 화면이라 소개자 이름은 첫 글자만(김OO — 공개 작성자 규칙). 요청자 회사 · 연락처는 내보내지 않습니다. */
      `SELECT i.id, i.state, i.invitee_label AS "label", i.expires_at AS "expiresAt",
              r.title, r.body, r.gwan_code AS "gwan", g.name AS "gwanName",
              r.region, c.name AS "categoryName",
              a.name AS "_introducer",
              s.grade, (SELECT label FROM code_labels WHERE domain='introducer.grade' AND code=s.grade) AS "gradeLabel",
              s.valid_connections AS "introducerValid"
         FROM introduction_invites i
         JOIN requests r ON r.id = i.request_id
         LEFT JOIN gwans g ON g.code = r.gwan_code
         LEFT JOIN categories c ON c.id = r.category_id
         JOIN accounts a ON a.id = i.introducer_id
         LEFT JOIN v_introducer_scorecard s ON s.account_id = i.introducer_id
        WHERE i.token_hash = $1`, [hash]);

    if (!inv) throw new StateConflict('NO_SUCH_INVITE', '유효하지 않은 링크입니다.');
    inv.introducer = publicAuthor(inv._introducer);
    delete inv._introducer;
    if (new Date(inv.expiresAt) < new Date()) {
      return { ...inv, expired: true, note: '기간이 지나 만료된 초대입니다.' };
    }

    // 열어 본 사실만 남깁니다. 동의는 아직입니다.
    if (inv.state === 'SENT') {
      await this.db.query(
        "UPDATE introduction_invites SET state='VIEWED' WHERE id=$1 AND state='SENT'", [inv.id]);
    }

    return { ...inv, expired: false,
      effects: [
        '요청하신 분과 대화가 열립니다',
        '회원님이 직접 입력하신 정보만 전달됩니다',
        '동의 사실과 시각이 기록으로 남습니다',
        '언제든 대화를 그만두실 수 있습니다',
      ],
      note: '지금은 요청자가 회원님의 연락처를 알지 못합니다. 거절하셔도 불이익이 없습니다.' };
  }

  /**
   * 동의 또는 거절.
   *
   * 동의하면 연결이 생깁니다. 동의 기록은 되돌릴 수 없습니다 —
   * 나중에 "동의한 적 없다"는 분쟁의 근거입니다.
   */
  async consent(token: string, agree: boolean) {
    const hash = createHash('sha256').update(token).digest('hex');
    return this.db.transaction(async () => {
      const [inv] = await this.db.query<any>(
        `SELECT id, state, request_id, introducer_id, expires_at
           FROM introduction_invites WHERE token_hash = $1 FOR UPDATE`, [hash]);
      if (!inv) throw new StateConflict('NO_SUCH_INVITE', '유효하지 않은 링크입니다.');
      if (new Date(inv.expires_at) < new Date()) {
        throw new StateConflict('EXPIRED', '기간이 지나 만료된 초대입니다.');
      }
      if (inv.state === 'CONSENTED') {
        /* v10.31 — 로그인 전에 동의했던 분이 로그인 뒤 다시 누르면 대화를 엽니다 */
        const me = RequestCtx.actorId();
        if (agree && me) {
          const [rq] = await this.db.query<{ owner_account_id: string }>('SELECT owner_account_id FROM requests WHERE id = $1', [inv.request_id]);
          if (rq && rq.owner_account_id !== me) {
            const [c] = await this.db.query<{ id: string }>(
              `INSERT INTO conversations (target_type, target_id, initiator_id, counterpart_id)
               VALUES ('REQUEST', $1, $2, $3)
               ON CONFLICT (target_type, target_id, initiator_id) DO UPDATE SET status = 'OPEN'
               RETURNING id`, [inv.request_id, me, rq.owner_account_id]);
            return { alreadyConsented: true, chatId: c.id, note: '이미 동의하셨습니다. 대화를 엽니다.' };
          }
        }
        return { alreadyConsented: true, note: '이미 동의하셨습니다.' };
      }

      if (!agree) {
        await this.db.query(
          "UPDATE introduction_invites SET state='DECLINED' WHERE id=$1", [inv.id]);
        return { declined: true,
          note: '소개하신 분에게는 거절 사실만 전달되고 사유는 묻지 않습니다.' };
      }

      await this.db.query(
        `UPDATE introduction_invites
            SET state='CONSENTED', consented_by=$2 WHERE id=$1`,
        [inv.id, RequestCtx.actorId() ?? null]);

      // 요청자와 소개자를 잇습니다. 동의 전에는 트리거가 막습니다.
      const [req] = await this.db.query<{ owner_account_id: string }>(
        'SELECT owner_account_id FROM requests WHERE id = $1', [inv.request_id]);
      const [conn] = await this.db.query<any>(
        `INSERT INTO introduction_connections(invite_id, request_id, introducer_id, requester_id)
         VALUES ($1,$2,$3,$4) RETURNING id, connected_at AS "connectedAt"`,
        [inv.id, inv.request_id, inv.introducer_id, req.owner_account_id]);

      /* v10.31 — 시안 「동의하시면 이렇게 됩니다 — 요청하신 분과 대화가 열립니다」. 로그인한 분이면 요청자와의 1:1 대화를 엽니다
       *   (대상 = 이 요청 · 연락처 가림 규칙 그대로). 로그인 전이면 동의만 기록하고 로그인 뒤 같은 링크에서 대화를 엽니다. */
      const me = RequestCtx.actorId();
      let chatId: string | null = null;
      if (me && me !== req.owner_account_id) {
        const [c] = await this.db.query<{ id: string }>(
          `INSERT INTO conversations (target_type, target_id, initiator_id, counterpart_id)
           VALUES ('REQUEST', $1, $2, $3)
           ON CONFLICT (target_type, target_id, initiator_id) DO UPDATE SET status = 'OPEN'
           RETURNING id`, [inv.request_id, me, req.owner_account_id]);
        chatId = c.id;
      }
      return { consented: true, connectionId: conn.id, connectedAt: conn.connectedAt, chatId,
        note: chatId ? '연결되었습니다. 요청하신 분과 대화가 열렸습니다.'
          : '동의를 기록했습니다. 로그인하시면 요청하신 분과 대화가 열립니다.' };
    });
  }
}
