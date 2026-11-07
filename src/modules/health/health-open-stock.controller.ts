import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { HealthOpenStockService } from './health-open-stock.service';

/* ---------------------------------------------------------------------
 * v10.208 (D185 · docs/333) — 소개몰 개봉 반품 재고 대장 (운영 화면 › 거래 › 「개봉 반품 재고」 SB-ADM-HOS-010)
 *
 *   ADMIN·SUPER  GET  /admin/health/open-stock              대장 · 처리별 수
 *                POST /admin/health/open-stock/:id/discard  보관 → 폐기(사유) · 감사 HLT_OPEN_DISCARD
 *   식품 · 화장품 개봉품은 재판매 금지(법무 11/7) — 판매로 옮기는 길은 없음
 * ------------------------------------------------------------------- */

export class OpenStockItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['HOLD', 'DISCARDED', 'TO_SELLER'] }) state!: string;
  @ApiProperty() qty!: number;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() orderNo!: string;
  @ApiProperty() productCode!: string;
  @ApiProperty() productName!: string;
  @ApiPropertyOptional({ nullable: true }) optionLabel!: string | null;
  @ApiPropertyOptional({ nullable: true }) optionPrice!: number | null;
  @ApiPropertyOptional({ nullable: true }) optionId!: string | null;
  @ApiProperty({ enum: ['DIRECT', 'BRAND', 'TENANT'] }) sellerType!: string;
}
export class OpenStockCountsDto {
  @ApiProperty() hold!: number;
  @ApiProperty() discarded!: number;
  @ApiProperty() toSeller!: number;
}
export class OpenStockListDto {
  @ApiProperty({ type: [OpenStockItemDto] }) items!: OpenStockItemDto[];
  @ApiProperty({ type: OpenStockCountsDto }) counts!: OpenStockCountsDto;
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
  @ApiOperation({ summary: '개봉 반품 재고 대장', description: '보관(폐기 대기) · 폐기 · 판매자 반송. 식품 · 화장품 개봉품은 재판매 금지.' })
  @ApiQuery({ name: 'state', required: false, enum: ['HOLD', 'DISCARDED', 'TO_SELLER'] })
  @ApiOkResponse({ type: OpenStockListDto })
  list(@Query('state') state?: string) { return this.svc.list(state); }

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
