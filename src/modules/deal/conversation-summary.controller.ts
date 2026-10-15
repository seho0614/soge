import { Body, Controller, Get, HttpCode, Injectable, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { Roles } from '../../core/auth';
import { ErrorDto } from '../../common/dto/common.dto';
import { publicAuthor } from '../community/community.service';
import { AttributionEngine } from '../../engines/attribution/attribution.engine';

export class MessageCheckDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 }) @IsString() @MinLength(1) @MaxLength(2000) body!: string;
}

/* 플랫폼 밖 거래를 꾀는 표현(시안 scAsk 경고 「플랫폼 밖 거래를 유도하는 표현」). 판정 근거라 화면에 그대로 보입니다 */
const OFF_PLATFORM = ['수수료 없이', '수수료없이', '직접 입금', '직접입금', '직거래', '따로 연락', '개인적으로 연락', '카톡', '카카오톡', '오픈채팅',
  '텔레그램', '라인 아이디', '문자 주세요', '전화 주세요', '현금으로', '계좌로 바로', '플랫폼 밖', '사이트 밖', '소개비 빼고', '소개비 없이'];

/**
 * v10.31 (w1) — 1:1 문의 화면(SB-HOM-MCH-010 · 시안 scAsk)
 *   GET  /conversations/{id}/summary — 위쪽 매물 줄 · 상대 정보 · 오른쪽 「거래 정보 · 소개 귀속 · 예상 소개비」. 대화 당사자만.
 *        상대 이름: 사업자 인증이면 회사명, 아니면 첫 글자(김OO). 소개자 이름도 김OO. 연락처는 싣지 않습니다.
 *        소개 귀속: 거래가 있으면 거래에 찍힌 코드, 없으면 「지금 거래를 열면 붙을 코드」(fn_attribution_resolve_listing — 거래 생성과 같은 규칙).
 *        예상 소개비: 합의 금액이 있으면 그것, 없으면 등록자가 적은 희망 금액(요율표 계산 아님 · A-12) — 둘 다 없으면 null(「협의」).
 *   POST /conversations/check — 보내기 전 확인(시안 경고 상자 「수정하겠습니다 · 그래도 보내기」). 저장하지 않습니다.
 *        계좌번호로 보이는 숫자 · 연락처(보내면 가려짐) · 플랫폼 밖 거래 표현 · 금지어(banned_words BLOCK · WARN).
 */
@Injectable()
export class ConversationSummaryService {
  constructor(private readonly db: DatabaseService, private readonly attribution: AttributionEngine) {}

  async summary(id: string) {
    const me = RequestCtx.actorId()!;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFound('대화를 찾을 수 없습니다.');
    const [c] = await this.db.query<any>(
      `SELECT c.id, c.target_type AS "targetType", c.target_id AS "targetId", c.initiator_id AS initiator, c.counterpart_id AS counterpart,
              c.status, c.created_at AS "createdAt"
         FROM conversations c WHERE c.id = $1`, [id]);
    if (!c) throw new NotFound('대화를 찾을 수 없습니다.');
    if (me !== c.initiator && me !== c.counterpart) throw new Forbidden('NOT_PARTICIPANT', '이 대화의 참여자가 아닙니다.');
    const other = me === c.initiator ? c.counterpart : c.initiator;

    const [t] = c.targetType === 'LISTING'
      ? await this.db.query<any>(
        `SELECT l.id, l.title, l.gwan_code AS "gwanCode", cat.name AS "categoryName", l.desired_fee AS "desiredFee",
                (SELECT label FROM code_labels WHERE domain='fee.bearer' AND code=l.fee_bearer) AS "feeBearerLabel", l.status
           FROM listings l LEFT JOIN categories cat ON cat.id = l.category_id WHERE l.id = $1`, [c.targetId])
      : await this.db.query<any>(
        `SELECT r.id, r.title, r.gwan_code AS "gwanCode", cat.name AS "categoryName", r.offered_fee AS "desiredFee",
                NULL AS "feeBearerLabel", r.status
           FROM requests r LEFT JOIN categories cat ON cat.id = r.category_id WHERE r.id = $1`, [c.targetId]);

    const [o] = await this.db.query<any>(
      `SELECT a.name, a.identity_verified_at IS NOT NULL AS "identityVerified",
              b.company_name AS company, b.sido, b.sigungu
         FROM accounts a
         LEFT JOIN businesses b ON b.account_id = a.id AND b.verified_at IS NOT NULL
        WHERE a.id = $1`, [other]);

    const [d] = await this.db.query<any>(
      `SELECT d.id, d.status, (SELECT label FROM code_labels WHERE domain='deal.status' AND code=d.status) AS "statusLabel",
              d.created_at AS "createdAt", d.attributed_code AS code, d.attributed_at AS "attributedAt", d.agreed_fee AS "agreedFee",
              coalesce(ia.name, (SELECT a2.name FROM referral_codes rc JOIN accounts a2 ON a2.id = rc.owner_account_id
                                  WHERE rc.code = d.attributed_code LIMIT 1)) AS "_intro"
         FROM deals d LEFT JOIN accounts ia ON ia.id = d.introducer_account_id
        WHERE d.conversation_id = $1 ORDER BY d.created_at DESC LIMIT 1`, [id]);

    const [pol] = await this.db.query<{ window_days: number; model: string }>(
      `SELECT window_days, model FROM attribution_policies WHERE effective_from <= now() ORDER BY effective_from DESC LIMIT 1`);
    let attribution: Record<string, unknown> | null = null;
    if (d?.code) {
      attribution = { code: d.code, introducer: d._intro ? publicAuthor(d._intro) : null, model: pol?.model ?? 'FIRST_TOUCH', fixed: true,
        since: d.attributedAt ?? d.createdAt, validUntil: null };
    } else if (c.targetType === 'LISTING') {
      /* 거래를 열면 붙을 후보 — 문의한 사람(initiator) 기준. 금지 업종 매물이면 거래 생성처럼 소개자를 두지 않습니다 */
      const [g] = await this.db.query<{ no_intro: boolean }>(
        `SELECT coalesce(fn_category_no_intro(l.category_id), false) AS no_intro FROM listings l WHERE l.id = $1`, [c.targetId]);
      const r = g?.no_intro ? null : await this.attribution.resolveForListing(c.initiator, c.targetId).catch(() => null);
      if (r) {
        const [ow] = await this.db.query<{ name: string }>(
          `SELECT a.name FROM referral_codes rc JOIN accounts a ON a.id = rc.owner_account_id WHERE rc.code = $1 LIMIT 1`, [r.code]);
        const until = new Date(new Date(r.occurredAt).getTime() + (pol?.window_days ?? 90) * 86400000);
        attribution = { code: r.code, introducer: publicAuthor(ow?.name), model: pol?.model ?? 'FIRST_TOUCH', fixed: false,
          since: r.occurredAt, validUntil: until.toISOString() };
      }
    }

    return {
      conversationId: c.id, status: c.status, createdAt: c.createdAt, role: me === c.initiator ? 'INITIATOR' : 'OWNER',
      target: t ? { type: c.targetType, id: t.id, title: t.title, gwanCode: t.gwanCode, categoryName: t.categoryName, status: t.status } : null,
      counterpart: o ? {
        name: o.company ?? publicAuthor(o.name), business: !!o.company, identityVerified: !!o.identityVerified,
        region: [o.sido, o.sigungu].filter(Boolean).join(' ') || null,
      } : null,
      deal: d ? { id: d.id, status: d.status, statusLabel: d.statusLabel, createdAt: d.createdAt } : null,
      attribution,
      fee: { amount: d?.agreedFee ?? t?.desiredFee ?? null, agreed: d?.agreedFee != null, bearerLabel: t?.feeBearerLabel ?? null },
    };
  }

  async check(body: string) {
    const text = String(body ?? '');
    const reasons: Array<{ code: string; label: string; hits: string[] }> = [];
    const acct = text.match(/\b\d{2,6}-\d{2,6}-\d{2,8}\b|\b\d{11,14}\b/g)?.filter((x) => !/^01[016-9]/.test(x.replace(/-/g, ''))) ?? [];
    if (acct.length) reasons.push({ code: 'ACCOUNT_NO', label: '계좌번호로 보이는 숫자', hits: acct.slice(0, 3) });
    const contact = [...(text.match(/01[016-9][-. ]?\d{3,4}[-. ]?\d{4}/g) ?? []), ...(text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [])];
    if (contact.length) reasons.push({ code: 'CONTACT', label: '연락처(보내면 가려집니다)', hits: contact.slice(0, 3) });
    const off = OFF_PLATFORM.filter((w) => text.includes(w));
    if (off.length) reasons.push({ code: 'OFF_PLATFORM', label: '플랫폼 밖 거래를 유도하는 표현', hits: off.slice(0, 5) });
    const banned = await this.db.query<{ word: string; severity: string; match_type: string }>(
      `SELECT word, severity, match_type FROM banned_words
        WHERE is_active AND ((match_type = 'CONTAINS' AND position(lower(word) IN lower($1)) > 0)
                          OR (match_type = 'EXACT' AND lower(btrim($1)) = lower(btrim(word)))
                          OR (match_type = 'REGEX' AND $1 ~* word))`, [text]).catch(() => []);
    if (banned.length) reasons.push({ code: 'BANNED_WORD', label: '금지 표현', hits: [...new Set(banned.map((b) => (b.match_type === 'REGEX' ? '형식 규칙' : b.word)))].slice(0, 5) });
    return { warn: reasons.length > 0, reasons };
  }
}

@ApiTags('HOM')
@ApiBearerAuth()
@Controller('api/v1')
export class ConversationSummaryController {
  constructor(private readonly svc: ConversationSummaryService) {}

  @Get('conversations/:id/summary')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '1:1 문의 요약 (시안 scAsk 머리 · 오른쪽 칸)', description: '대화 당사자만. 매물 · 상대(회사명 또는 김OO) · 거래 · 소개 귀속 · 예상 소개비.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'NOT_PARTICIPANT', type: ErrorDto })
  summary(@Param('id') id: string) { return this.svc.summary(id); }

  @Post('conversations/check')
  @HttpCode(200)
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '보내기 전 확인', description: '계좌번호 · 연락처 · 플랫폼 밖 거래 표현 · 금지어. 저장하지 않음 — 보내는 것은 POST /conversations/{id}/messages.' })
  @ApiOkResponse({ type: Object })   /* v10.31 합침 — 응답 모양을 문서에(검정 「구현된 API 에 응답 스키마」) */
  check(@Body() dto: MessageCheckDto) { return this.svc.check(dto.body); }
}
