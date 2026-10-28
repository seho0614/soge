/* v10.96 (리팩토링) — 건강몰(소개몰) 컨트롤러의 입력 · 응답 형식(DTO). health-shop.controller.ts 에서 글자 그대로 옮김 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
/* ★ 불리언 입력은 받은 값 그대로 검사합니다(@StrictBoolean · common/strict-boolean.ts) — 개봉 판정이 문자열 하나로 뒤집히면 재고가 틀어집니다. */
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';

export class CartAddDto {
  @ApiProperty({ description: '상품 코드' }) @IsString() productCode!: string;
  /* v10.26 (D027) — 옵션(개월 수). 옵션이 여럿인 상품은 꼭 있어야 합니다(OPTION_REQUIRED). 단품(옵션 하나)은 없어도 됩니다 */
  @ApiPropertyOptional({ format: 'uuid', description: '옵션 id — 상품 상세의 options[].id. 옵션이 하나뿐인 상품은 생략 가능' })
  @IsOptional() @IsUUID() optionId?: string;
  @ApiProperty({ description: '수량. 99개까지입니다' }) @IsInt() @Min(1) qty!: number;
}

export class CartQtyDto {
  @ApiProperty({ description: '수량 — 0 이면 뺍니다(99까지)' }) @IsInt() @Min(0) @Max(99) qty!: number;
}

export class FeePayDto {
  @ApiProperty({ enum: ['CARD', 'TRANSFER'], description: '교환 배송비 결제 수단(가상계좌는 받지 않습니다)' })
  @IsIn(['CARD', 'TRANSFER']) method!: string;
}

export class ConvertDto {
  @ApiPropertyOptional({ description: '바꾸는 까닭 — 고객에게 보입니다(없으면 「교환할 상품이 14일 안에 입고되지 않음」)' })
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class OrderCreateDto {
  @ApiProperty({ format: 'uuid', description: '배송지' }) @IsString() addressId!: string;
  /* ★ 검증 데코레이터가 없으면 **whitelist 가 통째로 걸러냅니다** —
   *   "담으신 상품이 없습니다" 가 나오는데 실제로는 보냈습니다. */
  @ApiProperty({ type: [Object], description: '담을 것 — [{ productCode, optionId?, qty }] (v10.26 — 옵션이 여럿인 상품은 optionId 필수)' })
  @IsArray() @ArrayMinSize(1)
  items!: Array<{ productCode: string; qty: number }>;

  /* v10.26 (G-182) — 주문서(장바구니에서 온 주문)는 true 로 보냅니다. 그러면 서버가 **장바구니와 대조**하고 같은 거래에서 그 줄을 비웁니다 —
   * 예전 주문서(뒤로 가기 · 다른 탭 · 화면이 기억해 둔 것)를 다시 보내면 장바구니에 그 줄이 없어 409 CART_CHANGED 로 거절됩니다.
   * 없거나 false 면 전과 같습니다(품목을 그대로 받음). */
  @ApiPropertyOptional({ description: '장바구니에서 온 주문 — 장바구니의 그 품목 · 수량과 같아야 접수(다르면 409 CART_CHANGED)' })
  @IsOptional() @StrictBoolean() fromCart?: boolean;
  /* v10.26 (D027) — 담은 뒤 값이 바뀐 줄이 있으면 확인했다는 표시. 없으면 409 PRICE_CHANGED(장바구니의 「확인했습니다」로도 됨) */
  @ApiPropertyOptional({ description: '바뀐 값을 확인함 — fromCart 주문에서 담을 때 값과 지금 값이 다른 줄이 있을 때' })
  @IsOptional() @StrictBoolean() priceAck?: boolean;
  /* v10.31 (시안 주문서 「배송 요청사항」) — 50자. 연락처 · 계좌 같은 글은 서버가 거릅니다(배송사로 넘어가는 글) */
  @ApiPropertyOptional({ maxLength: 50, example: '부재 시 경비실에 맡겨 주세요' })
  @IsOptional() @IsString() @MaxLength(50) shipMemo?: string;
}

export class AddressDto {
  @ApiProperty() @IsString() receiver!: string;
  @ApiProperty() @IsString() phone!: string;
  @ApiProperty() @IsString() zipcode!: string;
  @ApiProperty() @IsString() addr1!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() addr2?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() label?: string;
}

/** 취소·반품 사유 코드 — 사이트 RETURN_REASONS 와 같습니다 */
export const RETURN_REASONS = ['CHANGE_MIND', 'WRONG_ORDER', 'DEFECT', 'WRONG_ITEM', 'MISMATCH', 'DELAY'];

export class ReturnCreateDto {
  @ApiProperty({ description: '주문번호' }) @IsString() orderNo!: string;
  @ApiProperty({ enum: ['CANCEL', 'RETURN', 'EXCHANGE'] })
  @IsIn(['CANCEL', 'RETURN', 'EXCHANGE']) kind!: string;
  /* 사유가 귀책을 정합니다 — 하자·오배송·표시와 다름(DEFECT·WRONG_ITEM·MISMATCH)은
   * 받은 날부터 3개월(17조 3항), 나머지는 withdrawal_rules.days(17조 1항). */
  @ApiProperty({ description: '사유 코드', enum: RETURN_REASONS })
  @IsIn(RETURN_REASONS) reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) detail?: string;
  /* D006 — 고객이 적는 개봉 여부. **참고용**이고 판정은 운영이 승인할 때 합니다. 취소에는 쓰지 않습니다 */
  @ApiPropertyOptional({ description: '포장을 여셨는지 (반품 · 교환만, 참고용 — 판정은 운영)' })
  @IsOptional() @StrictBoolean() opened?: boolean;
  /* v10.139 (D135) — AI 상담 초안으로 채운 화면에서 낸 신청이면 그 초안 번호(본인 초안이면 「제출됨」만 적음 · 판정은 그대로) */
  @ApiPropertyOptional({ format: 'uuid', description: 'AI 상담 신청서 초안 번호(v10.139)' }) @IsOptional() @IsUUID('all') agentDraftId?: string;
}

export class ReturnDecideDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED']) state!: string;
  @ApiPropertyOptional({ description: '반려면 필수 — 고객에게 보입니다' })
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  /* D006 — 반품 승인이면 필수(OPENED_REQUIRED). true 면 재고로 되돌리지 않습니다. 취소에는 true 불가 */
  @ApiPropertyOptional({ description: '운영 판정 개봉 여부 — 반품 승인이면 필수. true 면 재판매 불가로 재고로 되돌리지 않습니다' })
  @IsOptional() @StrictBoolean() opened?: boolean;
  /* v10.26 — 교환 승인에서 「회사 사정으로 판정」: 교환 배송비를 0 으로 하고 낸 돈을 돌려드립니다 */
  @ApiPropertyOptional({ description: '(교환) 회사 사정으로 판정 — 교환 배송비를 받지 않고 낸 돈을 돌려드립니다' })
  @IsOptional() @StrictBoolean() sellerFault?: boolean;
}

export class PayConfirmDto {
  /* 토스 paymentKey — 영문·숫자·_-  (결제창 성공 주소로 옵니다) */
  @ApiProperty({ description: '결제창이 성공 주소로 넘겨준 paymentKey' })
  @IsString() @MaxLength(200) @Matches(/^[A-Za-z0-9_-]+$/) paymentKey!: string;
  @ApiProperty({ description: '성공 주소의 amount — 서버가 주문 금액과 대조합니다(다르면 422 AMOUNT_MISMATCH)' })
  @IsInt() @Min(1) amount!: number;
}

export class RefundReceiveAccountDto {
  @ApiProperty({ description: '은행 코드(토스 은행 코드)' }) @IsString() @MaxLength(20) bank!: string;
  @ApiProperty() @IsString() @Matches(/^[0-9-]{6,30}$/) accountNumber!: string;
  @ApiProperty() @IsString() @MaxLength(60) holderName!: string;
}

export class RefundDto {
  /* 가상계좌로 입금된 결제만 필요합니다(PG 규칙). 저장하지 않고 PG 로만 넘깁니다 */
  @ApiPropertyOptional({ type: RefundReceiveAccountDto, description: '가상계좌 결제 환불 계좌 — 저장하지 않습니다' })
  @IsOptional() @ValidateNested() @Type(() => RefundReceiveAccountDto)
  refundReceiveAccount?: RefundReceiveAccountDto;
}

export class HltProductDto {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() price!: number;
  @ApiProperty({ description: '남은 수량' }) stock!: number;
  @ApiPropertyOptional({ description: '심의필 번호. 의료기기는 필수' }) reviewNo?: string;
  @ApiProperty({ description: '청약철회 규칙' }) withdrawal!: string;
}

export class HltSaleCategoryDto {
  @ApiProperty({ description: '갈래 코드 — HLT_FOOD 등' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'OPEN 지금 팝니다 · LOCKED 준비 중(자물쇠) · NOT_SOLD 팔지 않습니다', enum: ['OPEN', 'LOCKED', 'NOT_SOLD'] }) state!: string;
  @ApiPropertyOptional({ description: '잠금 · 미판매의 까닭 — 손님에게 보이는 안내. OPEN 이면 null', nullable: true }) note?: string | null;
  @ApiProperty({ description: '판매 중(품절 포함) 상품 수. 잠금 · 미판매 갈래는 늘 0' }) productCount!: number;
}

export class HltOrderDto {
  @ApiProperty() orderNo!: string;
  @ApiProperty() total!: number;
  @ApiProperty({ description: 'PENDING · PAID · SHIPPED · DELIVERED …' }) status!: string;
  @ApiPropertyOptional({ description: '(목록) 금액이 가장 큰 품목의 이름 — v10.25', nullable: true }) firstItemName?: string | null;
  @ApiPropertyOptional({ description: '(목록) 품목 수 — v10.25' }) itemCount?: number;
  @ApiPropertyOptional({ description: '취소 신청이 접수돼 처리를 기다리는 중 — 이 동안은 결제할 수 없습니다(v10.26 · G-183)' }) cancelRequested?: boolean;
}
