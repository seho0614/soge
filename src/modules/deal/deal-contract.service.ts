import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { resolveESignProvider } from './esign.provider';
import { RequestCtx } from '../../core/request-context';

/** v10.31 — 계약서 제1조 당사자 칸(가입 정보 자동 기입). 연락처는 뒤 4자리만, 사업자등록번호는 끝 3자리를 가립니다. */
function PARTY_SQL(a: string, b: string) {
  return `jsonb_build_object(
    'company', coalesce(${b}.company_name, ${a}.name || ' (개인)'),
    'ceo', coalesce(${b}.ceo_name, ${a}.name),
    'bizRegNo', CASE WHEN ${b}.biz_reg_no ~ '^[0-9]{10}$'
                     THEN substr(${b}.biz_reg_no,1,3) || '-' || substr(${b}.biz_reg_no,4,2) || '-' || substr(${b}.biz_reg_no,6,2) || 'xxx' END,
    'phone', CASE WHEN length(regexp_replace(coalesce(${a}.phone,''), '[^0-9]', '', 'g')) >= 8
                  THEN left(regexp_replace(${a}.phone, '[^0-9]', '', 'g'), 3) || '-****-' || right(regexp_replace(${a}.phone, '[^0-9]', '', 'g'), 4) END,
    'business', ${b}.id IS NOT NULL,
    'identityVerified', ${a}.identity_verified_at IS NOT NULL)`;
}

/**
 * 거래 계약서 — 상태 · 초안 · 재촉 · 동의 · 수정 제안 · 서명 · 이행 · 취소 · 이력 · 양식 · 전자서명.
 *
 * v10.92 (리팩토링) — deal.service.ts 에서 함수 본문을 그대로 옮겼습니다(assertParty() 는 두 곳에 원본 그대로).
 */
@Injectable()
export class DealContractService {
  constructor(private readonly db: DatabaseService) {}
  /** v10.27 (G-213) — 거래 당사자(매수 · 매도)인지 확인합니다. 아니면 403.
   *  계약 상태 · 이력 · 전자서명 상태 · 계약서 발급이 거래 번호만 알면 누구나 열렸습니다(이력에는 당사자 실명이 들어 있음). */
  private async assertParty(dealId: string) {
    const me = RequestCtx.actorId();
    const [d] = await this.db.query<{ ok: boolean }>(
      `SELECT ($2::uuid IN (buyer_account_id, seller_account_id)) AS ok FROM deals WHERE id = $1`, [dealId, me ?? null]);
    if (!d?.ok) throw new Forbidden('NOT_PARTY', '이 거래의 당사자가 아닙니다.');
  }

  private async contractOf(dealId: string) {
    const [c] = await this.db.query<any>(
      `SELECT c.*, d.buyer_account_id, d.seller_account_id
         FROM deal_contracts c JOIN deals d ON d.id = c.deal_id
        WHERE c.deal_id = $1 ORDER BY c.issued_at DESC LIMIT 1`, [dealId]);
    if (!c) throw new NotFound('계약이 없습니다.');
    return c;
  }

  /** 내가 매수 쪽인가 — 어느 칸에 도장을 찍을지 정합니다. */
  private sideOf(c: any, me: string): 'buyer' | 'seller' {
    if (c.buyer_account_id === me) return 'buyer';
    if (c.seller_account_id === me) return 'seller';
    throw new Forbidden('NOT_PARTY', '이 계약의 당사자가 아닙니다.');
  }

  async contractState(dealId: string) {
    await this.assertParty(dealId);
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    /* v10.31 (시안 표준계약서 제1조 · 제3조 · 제7조) — 당사자(가입 정보 자동 기입 · 연락처 뒤 4자리 · 사업자번호 끝 3자리 가림) ·
     *   소개비 · 소개코드(발급일 · 귀속 90일) · 서명 시각을 함께 냅니다. 당사자만 봅니다(assertParty). */
    const [x] = await this.db.query<any>(
      `SELECT d.agreed_fee AS fee, d.attributed_code AS code, d.attributed_at AS "attributedAt",
              rc.issued_at AS "codeIssuedAt", rc.expires_at AS "codeExpiresAt",
              coalesce(l.title, rq.title, '소개 건') AS title,
              ${PARTY_SQL('ab', 'bb')} AS buyer, ${PARTY_SQL('asl', 'sb')} AS seller
         FROM deals d
         LEFT JOIN listings l ON l.id = d.listing_id
         LEFT JOIN requests rq ON rq.id = d.request_id
         LEFT JOIN referral_codes rc ON rc.code = d.attributed_code
         JOIN accounts ab ON ab.id = d.buyer_account_id
         LEFT JOIN businesses bb ON bb.account_id = ab.id AND bb.verified_at IS NOT NULL
         JOIN accounts asl ON asl.id = d.seller_account_id
         LEFT JOIN businesses sb ON sb.account_id = asl.id AND sb.verified_at IS NOT NULL
        WHERE d.id = $1`, [dealId]);
    const mySide = c.buyer_account_id === me ? 'BUYER' : 'SELLER';
    return {
      id: c.id, state: c.state, terms: c.terms,
      templateCode: c.template_code,      // v10.27 (G-130) — 「양식 전문 보기」가 여는 양식
      buyerAgreed: !!c.agreed_by_buyer_at, sellerAgreed: !!c.agreed_by_seller_at,
      buyerSigned: !!c.signed_by_buyer_at, sellerSigned: !!c.signed_by_seller_at,
      buyerSignedAt: c.signed_by_buyer_at, sellerSignedAt: c.signed_by_seller_at,
      buyerFulfilled: !!c.fulfilled_by_buyer_at, sellerFulfilled: !!c.fulfilled_by_seller_at,
      stalled: Date.now() - new Date(c.updated_at).getTime() > 3 * 864e5,
      mySide, title: x?.title ?? null,
      parties: { buyer: x?.buyer ?? null, seller: x?.seller ?? null },
      fee: x?.fee != null ? Number(x.fee) : null,
      code: x?.code ? { code: x.code, issuedAt: x.codeIssuedAt ?? x.attributedAt, expiresAt: x.codeExpiresAt ?? null } : null,
      esign: { stub: !!c.esign_stub, docId: c.esign_doc_id ? true : false },
      /* 임시 저장은 저장한 사람에게만 보입니다 */
      draft: c.draft_by === me ? { terms: c.draft_terms, savedAt: c.draft_at } : null,
      nudgedAt: c.nudged_at,
    };
  }

  /** v10.31 (시안 「임시 저장」) — 조건을 보내지 않고 내 쪽에만 남깁니다(상대의 합의에 영향 없음). 서명 뒤에는 저장할 것이 없습니다. */
  async saveContractDraft(dealId: string, terms: any) {
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    this.sideOf(c, me);
    if (['SIGNED', 'FULFILLED', 'CANCELLED'].includes(c.state))
      throw new StateConflict('ALREADY_SIGNED', '서명했거나 끝난 계약은 조건을 저장할 수 없습니다.');
    const [row] = await this.db.query(
      `UPDATE deal_contracts SET draft_terms = $2, draft_by = $3, draft_at = now()
        WHERE id = $1 RETURNING draft_at AS "savedAt"`, [c.id, JSON.stringify(terms ?? {}), me]);
    return { ...row, note: '임시 저장했습니다. 상대에게는 보내지 않았습니다 — 「서명 요청 보내기」를 누르면 보냅니다.' };
  }

  /** v10.31 (시안 계약 진행 카드 「확인 요청」) — 상대 차례인 계약에 상대에게 알림을 한 번 더 보냅니다. 하루 한 번. */
  async nudgeContract(dealId: string) {
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    const side = this.sideOf(c, me);
    if (['FULFILLED', 'CANCELLED'].includes(c.state))
      throw new StateConflict('CONTRACT_CLOSED', '끝났거나 파기된 계약입니다.');
    const b = side === 'buyer';
    const my = { agreed: b ? c.agreed_by_buyer_at : c.agreed_by_seller_at, signed: b ? c.signed_by_buyer_at : c.signed_by_seller_at, done: b ? c.fulfilled_by_buyer_at : c.fulfilled_by_seller_at };
    const th = { agreed: b ? c.agreed_by_seller_at : c.agreed_by_buyer_at, signed: b ? c.signed_by_seller_at : c.signed_by_buyer_at, done: b ? c.fulfilled_by_seller_at : c.fulfilled_by_buyer_at };
    const theirTurn = (c.state === 'SENT' && my.agreed && !th.agreed) || (c.state === 'AGREED' && my.signed && !th.signed)
      || (c.state === 'SIGNED' && my.done && !th.done) || (c.state === 'COUNTER' && c.last_actor_id === me);
    if (!theirTurn) throw new StateConflict('NOT_THEIR_TURN', '지금은 회원님 차례입니다 — 확인 요청은 상대 차례일 때 보냅니다.');
    if (c.nudged_at && Date.now() - new Date(c.nudged_at).getTime() < 864e5)
      throw new StateConflict('NUDGED_TODAY', '확인 요청은 하루 한 번 보낼 수 있습니다. 내일 다시 보내 주십시오.');
    const other = b ? c.seller_account_id : c.buyer_account_id;
    const [info] = await this.db.query<{ title: string; me_name: string }>(
      `SELECT coalesce(l.title, rq.title, '소개 건') AS title,
              coalesce((SELECT company_name FROM businesses WHERE account_id = $2 AND verified_at IS NOT NULL),
                       left(btrim((SELECT name FROM accounts WHERE id = $2)), 1) || '○○') AS me_name
         FROM deals d LEFT JOIN listings l ON l.id = d.listing_id LEFT JOIN requests rq ON rq.id = d.request_id
        WHERE d.id = $1`, [dealId, me]);
    await this.db.query(`UPDATE deal_contracts SET nudged_at = now(), nudged_by = $2 WHERE id = $1`, [c.id, me]);
    await this.db.query(`SELECT fn_notify($1, 'CONTRACT_NUDGE', $2::jsonb, $3)`,
      [other, JSON.stringify({ counterpart: info?.me_name ?? '상대방', title: info?.title ?? '소개 건' }), `/my/contracts/${dealId}`]);
    await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, memo)
       VALUES ($1,$2,$3,$3,'확인 요청 보냄')`, [c.id, me, c.state]);
    return { nudgedAt: new Date().toISOString(), note: '상대방에게 확인 요청을 보냈습니다.' };
  }

  /** 조건 합의. 양측이 각각 눌러야 AGREED 로 넘어갑니다. */
  async agreeContract(dealId: string, terms: any) {
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    if (c.state === 'SIGNED' || c.state === 'FULFILLED')
      throw new StateConflict('ALREADY_SIGNED', '서명한 계약은 조건을 바꿀 수 없습니다.');

    const side = this.sideOf(c, me);
    const col = side === 'buyer' ? 'agreed_by_buyer_at' : 'agreed_by_seller_at';
    const other = side === 'buyer' ? c.agreed_by_seller_at : c.agreed_by_buyer_at;

    /* v10.31 (시안 제2조 경고 · A-09) — 용역이면서 판매 쪽(용역을 하는 쪽)이 인증된 사업자가 아니면 막습니다 — 유료직업소개사업 등록 의무에 걸릴 수 있습니다 */
    if (terms?.kind === 'SERVICE') {
      const [sb] = await this.db.query<{ ok: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM businesses WHERE account_id = $1 AND verified_at IS NOT NULL) AS ok`, [c.seller_account_id]);
      if (!sb?.ok) throw new PolicyViolation('SERVICE_NEEDS_BUSINESS',
        '용역 계약은 용역을 하는 쪽이 사업자 인증을 마쳐야 합니다(유료직업소개사업 등록 의무 · A-09). 물품이면 「물품」을 고르십시오.');
    }

    /* ★ 조건이 바뀌면 상대의 합의는 무효입니다.
     *   안 그러면 한쪽이 몰래 금액을 바꿔도 상대 동의가 남아 있게 됩니다. */
    /* DB 에서 온 것은 객체, 들어온 것도 객체 — 키 순서가 달라도
     * 같은 조건이면 같다고 봐야 합니다. 정렬해서 비교합니다. */
    const norm = (o: any) => o == null ? 'null'
      : JSON.stringify(Object.keys(o).sort().reduce((a: any, k) => (a[k] = o[k], a), {}));
    const changed = norm(c.terms) !== norm(terms);
    const bothNow = changed ? false : !!other;

    await this.db.query(
      `UPDATE deal_contracts
          SET terms = $2, ${col} = now(), last_actor_id = $3,
              draft_terms = CASE WHEN draft_by = $3 THEN NULL ELSE draft_terms END,
              draft_by = CASE WHEN draft_by = $3 THEN NULL ELSE draft_by END,
              ${changed ? (side === 'buyer' ? 'agreed_by_seller_at = NULL,' : 'agreed_by_buyer_at = NULL,') : ''}
              state = $4
        WHERE id = $1`,
      /* ★ 객체를 그대로 넘기면 pg 가 [object Object] 로 보내고
       *   jsonb 컬럼에 NULL 이 들어갑니다 — 그러면 "합의 조건이 비어
       *   있습니다" 로 막혀 **두 번째 합의가 영영 안 됩니다.**
       *   문자열로 직렬화해서 넘깁니다. */
      [c.id, JSON.stringify(terms ?? null), me, bothNow ? 'AGREED' : 'SENT']);

    await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, terms, memo)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [c.id, me, c.state, bothNow ? 'AGREED' : 'SENT', JSON.stringify(terms ?? null),
       changed ? '조건 변경 — 상대 합의를 다시 받습니다' : '조건 합의']);

    return { state: bothNow ? 'AGREED' : 'SENT', waitingOther: !bothNow };
  }

  /** 수정 요청. 무엇을 고쳐야 하는지 남아야 상대가 움직일 수 있습니다. */
  async counterContract(dealId: string, memo: string, terms?: any) {
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    this.sideOf(c, me);
    if (c.state === 'SIGNED' || c.state === 'FULFILLED')
      throw new StateConflict('ALREADY_SIGNED', '서명한 계약은 고칠 수 없습니다.');

    await this.db.query(
      `UPDATE deal_contracts
          SET state='COUNTER', agreed_by_buyer_at=NULL, agreed_by_seller_at=NULL,
              terms = coalesce($2, terms), last_actor_id=$3
        WHERE id=$1`, [c.id, terms ? JSON.stringify(terms) : null, me]);
    await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, terms, memo)
       VALUES ($1,$2,$3,'COUNTER',$4,$5)`,
      [c.id, me, c.state, terms ? JSON.stringify(terms) : null, memo]);
    return { state: 'COUNTER' };
  }

  /** 서명. 합의(AGREED) 뒤에만, 양측이 각각. */
  async signContract2(dealId: string) {
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    if (c.state !== 'AGREED' && c.state !== 'SIGNED')
      throw new StateConflict('NOT_AGREED', '양측이 조건에 합의해야 서명할 수 있습니다.');

    const side = this.sideOf(c, me);
    const col = side === 'buyer' ? 'signed_by_buyer_at' : 'signed_by_seller_at';
    const other = side === 'buyer' ? c.signed_by_seller_at : c.signed_by_buyer_at;
    const both = !!other;

    await this.db.query(
      `UPDATE deal_contracts SET ${col}=now(), last_actor_id=$2, state=$3 WHERE id=$1`,
      [c.id, me, both ? 'SIGNED' : 'AGREED']);
    await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, memo)
       VALUES ($1,$2,$3,$4,$5)`,
      [c.id, me, c.state, both ? 'SIGNED' : 'AGREED', both ? '양측 서명 완료' : '한쪽 서명']);
    return { state: both ? 'SIGNED' : 'AGREED', waitingOther: !both };
  }

  /** 이행 확인. 양측이 확인하면 거래가 성사로 올라갑니다(트리거). */
  async fulfilContract(dealId: string) {
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    if (c.state !== 'SIGNED')
      throw new StateConflict('NOT_SIGNED', '서명이 끝나야 이행을 확인할 수 있습니다.');

    const side = this.sideOf(c, me);
    const col = side === 'buyer' ? 'fulfilled_by_buyer_at' : 'fulfilled_by_seller_at';
    const other = side === 'buyer' ? c.fulfilled_by_seller_at : c.fulfilled_by_buyer_at;
    const both = !!other;

    await this.db.query(
      `UPDATE deal_contracts SET ${col}=now(), last_actor_id=$2, state=$3 WHERE id=$1`,
      [c.id, me, both ? 'FULFILLED' : 'SIGNED']);
    await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, memo)
       VALUES ($1,$2,$3,$4,$5)`,
      [c.id, me, c.state, both ? 'FULFILLED' : 'SIGNED',
       both ? '양측 이행 확인 — 성사 확정' : '한쪽 이행 확인']);

    /* ★ 소개비는 여기서 공제하지 않습니다(INV-9R).
     *   성사가 확정되면 지급 대상이 될 뿐이고, 대금은 당사자끼리 직접 주고받습니다. */
    return { state: both ? 'FULFILLED' : 'SIGNED', waitingOther: !both };
  }

  async cancelContract(dealId: string, reason: string) {
    const me = RequestCtx.actorId()!;
    const c = await this.contractOf(dealId);
    this.sideOf(c, me);
    await this.db.query(
      `UPDATE deal_contracts SET state='CANCELLED', cancel_reason=$2,
              cancelled_at=now(), last_actor_id=$3 WHERE id=$1`, [c.id, reason, me]);
    await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, memo)
       VALUES ($1,$2,$3,'CANCELLED',$4)`, [c.id, me, c.state, reason]);
    return { state: 'CANCELLED' };
  }

  /** 계약 이력. 분쟁에서 "누가 언제 무엇을 했는가"의 근거입니다. */
  async contractHistory(dealId: string) {
    await this.assertParty(dealId);
    const c = await this.contractOf(dealId);
    return this.db.query(
      `SELECT r.from_state AS "fromState", r.to_state AS "toState", r.memo,
              r.terms, r.created_at AS "createdAt", a.name AS actor
         FROM contract_revisions r JOIN accounts a ON a.id = r.actor_id
        WHERE r.contract_id = $1 ORDER BY r.created_at`, [c.id]);
  }
  /* ── 전자계약 ─────────────────────────────────────────────────── */

  contractTemplates() {
    return this.db.query(
      `SELECT code, name, version, scope, effective_from AS "effectiveFrom",
              invariants, note
         FROM contract_templates WHERE is_active
        ORDER BY scope, code`);
  }

  async contractTemplate(code: string) {
    const [t] = await this.db.query<any>(
      `SELECT code, name, version, scope, body, invariants,
              effective_from AS "effectiveFrom"
         FROM contract_templates WHERE code = $1 AND is_active`, [code]);
    if (!t) throw new StateConflict('NOT_FOUND', '없는 양식입니다.');
    return t;
  }

  /**
   * 전자계약 서명 요청.
   *
   * **서명 시각과 서명자를 제공자가 증명합니다.** 우리가 직접
   * 타임스탬프를 찍으면 우리가 만든 기록이라 분쟁에서 약합니다.
   */
  async requestESign(dealId: string) {
    const me = RequestCtx.actorId()!;
    const [c] = await this.db.query<any>(
      `SELECT c.id, c.template_code, c.state, c.esign_doc_id,
              d.buyer_account_id, d.seller_account_id
         FROM deal_contracts c JOIN deals d ON d.id = c.deal_id
        WHERE c.deal_id = $1`, [dealId]);
    if (!c) throw new StateConflict('NOT_FOUND', '발급된 계약서가 없습니다.');
    if (c.buyer_account_id !== me && c.seller_account_id !== me) {
      throw new PolicyViolation('NOT_PARTY', '이 계약의 당사자가 아닙니다.');
    }
    if (c.esign_doc_id) {
      return { docId: c.esign_doc_id, note: '이미 서명 요청이 나갔습니다.' };
    }

    const [tpl] = await this.db.query<any>(
      `SELECT body FROM contract_templates WHERE code = $1`, [c.template_code]);
    if (!tpl) throw new StateConflict('NO_TEMPLATE', '표준 양식이 아닙니다.');

    const provider = resolveESignProvider();
    const res = await provider.request({
      templateCode: c.template_code, body: tpl.body,
      signers: [{ name: '매수자' }, { name: '매도자' }] });
    if (!res.sent) {
      throw new PolicyViolation('ESIGN_FAILED',
        res.detail ?? '서명 요청을 보내지 못했습니다.');
    }

    await this.db.query(
      `UPDATE deal_contracts SET esign_doc_id = $2, esign_stub = $3
        WHERE id = $1`, [c.id, res.docId ?? null, res.stub]);

    return { docId: res.docId, signUrl: res.signUrl, stub: res.stub,
      note: res.stub
        ? '연동 전이라 실제 서명 요청이 나가지 않았습니다 — 법적 효력이 없습니다.'
        : '서명 요청을 보냈습니다. 양측이 서명하시면 체결됩니다.' };
  }

  async esignStatus(dealId: string) {
    await this.assertParty(dealId);
    const [c] = await this.db.query<any>(
      `SELECT esign_doc_id, esign_stub, state FROM deal_contracts
        WHERE deal_id = $1`, [dealId]);
    if (!c) throw new StateConflict('NOT_FOUND', '발급된 계약서가 없습니다.');
    if (!c.esign_doc_id) {
      return { state: 'NOT_REQUESTED', note: '아직 서명 요청이 나가지 않았습니다.' };
    }

    const provider = resolveESignProvider();
    const res = await provider.status(c.esign_doc_id);
    return { ...res, contractState: c.state,
      note: res.stub
        ? '연동 전이라 실제로 서명되지 않았습니다 — 법적 효력이 없습니다.'
        : undefined };
  }
}
