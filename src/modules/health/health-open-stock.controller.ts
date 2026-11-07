import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { HealthOpenStockService } from './health-open-stock.service';

/* ---------------------------------------------------------------------
 * v10.208 (D185 · docs/333) — 소개몰 개봉 반품 재고 (운영 화면 › 소개몰 반품 SB-ADM-HLT-… 안의 「개봉 반품 재고」 탭)
 *
 *   ADMIN·SUPER  GET  /admin/health/open-stock              대장 · 처리별 수 · 판매 스위치
 *                POST /admin/health/open-stock/sell         보관 → 할인 판매 상품(같은 옵션끼리) · 감사 HLT_OPEN_SELL
 *                POST /admin/health/open-stock/:id/discard  보관 → 폐기(사유) · 감사 HLT_OPEN_DISCARD
 *   판매 스위치 hlt.open_stock_sale 는 사이트 설정(켜기 SUPER)
 * ------------------------------------------------------------------- */

export class OpenStockItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['HOLD', 'FOR_SALE', 'DISCARDED', 'TO_SELLER'] }) state!: string;
  @ApiProperty() qty!: number;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2027-03-31' }) expiresOn!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() orderNo!: string;
  @ApiProperty() productCode!: string;
  @ApiProperty() productName!: string;
  @ApiPropertyOptional({ nullable: true }) optionLabel!: string | null;
  @ApiPropertyOptional({ nullable: true }) optionPrice!: number | null;
  @ApiPropertyOptional({ nullable: true }) optionId!: string | null;
  @ApiProperty({ enum: ['DIRECT', 'BRAND', 'TENANT'] }) sellerType!: string;
  @ApiPropertyOptional({ nullable: true, description: '할인 판매 상품 코드' }) saleCode!: string | null;
  @ApiPropertyOptional({ nullable: true }) saleStatus!: string | null;
  @ApiPropertyOptional({ nullable: true }) saleStock!: number | null;
  @ApiPropertyOptional({ nullable: true }) salePrice!: number | null;
}
export class OpenStockCountsDto {
  @ApiProperty() hold!: number;
  @ApiProperty() forSale!: number;
  @ApiProperty() discarded!: number;
  @ApiProperty() toSeller!: number;
}
export class OpenStockListDto {
  @ApiProperty({ type: [OpenStockItemDto] }) items!: OpenStockItemDto[];
  @ApiProperty({ type: OpenStockCountsDto }) counts!: OpenStockCountsDto;
  @ApiProperty({ description: '판매 스위치 hlt.open_stock_sale 켜짐' }) saleOn!: boolean;
}
export class OpenStockSellDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID('all', { each: true }) ids!: string[];
  @ApiProperty({ example: 39000, description: '할인 판매 값(원래 옵션 값보다 낮게)' }) @IsInt() @Min(1) price!: number;
  @ApiPropertyOptional({ example: '외부 상자만 개봉 · 내용물 밀봉', maxLength: 300 }) @IsOptional() @IsString() @MaxLength(300) note?: string;
  @ApiPropertyOptional({ example: '2027-03-31' }) @IsOptional() @Matches(/^20\d{2}-\d{2}-\d{2}$/) expiresOn?: string;
}
export class OpenStockSellResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ example: 'P12-OR3' }) code!: string;
  @ApiProperty({ example: 'STOPPED', description: '스위치가 꺼져 있으면 STOPPED(켜면 판매 중)' }) status!: string;
  @ApiProperty() stock!: number;
}
export class OpenStockDiscardDto {
  @ApiProperty({ minLength: 2, maxLength: 300 }) @IsString() @MinLength(2) @MaxLength(300) note!: string;
}
export class OpenStockDiscardResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() id!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/health/open-stock')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class HealthOpenStockController {
  constructor(private readonly svc: HealthOpenStockService) {}

  @Get()
  @ApiOperation({ summary: '개봉 반품 재고 대장', description: '보관 · 할인 판매 · 폐기 · 판매자 반송 · 판매 스위치(hlt.open_stock_sale).' })
  @ApiQuery({ name: 'state', required: false, enum: ['HOLD', 'FOR_SALE', 'DISCARDED', 'TO_SELLER'] })
  @ApiOkResponse({ type: OpenStockListDto })
  list(@Query('state') state?: string) { return this.svc.list(state); }

  @Post('sell')
  @HttpCode(200)
  @Audit('HLT_OPEN_SELL', 'HLT_PRODUCT')
  @ApiOperation({ summary: '보관 → 할인 판매 상품', description: '같은 상품 · 같은 옵션끼리. 값은 원래보다 낮게. 스위치가 꺼져 있으면 멈춘 채(켜면 판매).' })
  @ApiOkResponse({ type: OpenStockSellResultDto })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPEN_STOCK_RULE(보관 아님 · 옵션 섞임 · 값 · 유통기한) · OPEN_STOCK_IDS · OPEN_STOCK_PRICE' })
  sell(@Body() dto: OpenStockSellDto) { return this.svc.sell(dto.ids, dto.price, dto.note, dto.expiresOn); }

  @Post(':id/discard')
  @HttpCode(200)
  @Audit('HLT_OPEN_DISCARD', 'HLT_PRODUCT')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '보관 → 폐기(사유)' })
  @ApiOkResponse({ type: OpenStockDiscardResultDto })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPEN_STOCK_NOTE · OPEN_STOCK_RULE(보관 아님)' })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  discard(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OpenStockDiscardDto) { return this.svc.discard(id, dto.note); }
}
