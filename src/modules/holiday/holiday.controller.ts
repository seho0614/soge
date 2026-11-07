import { Body, Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { HolidayService } from './holiday.service';

/* ---------------------------------------------------------------------
 * v10.206 (D183 · docs/330) — 공휴일 (운영 화면 › 사이트 기본 정보 · 법정 고지 SB-ADM-SIT-070 안의 한 구역)
 *
 *   ADMIN·SUPER  GET    /admin/holidays          지난 한 달부터 공휴일 목록 · 올해 · 다음 해 수 · 다음 영업일 · 운영 값 확인 줄
 *   SUPER        PUT    /admin/holidays          넣기 · 이름 고치기(같은 날짜면 이름만) · 감사 HOLIDAY_SAVE
 *                DELETE /admin/holidays/:day     빼기 · 감사 HOLIDAY_DELETE
 * ------------------------------------------------------------------- */

export class HolidayDto {
  @ApiProperty({ example: '2027-02-07' }) day!: string;
  @ApiProperty({ example: '설날' }) name!: string;
}
export class HolidayListDto {
  @ApiProperty({ type: [HolidayDto] }) items!: HolidayDto[];
  @ApiProperty({ description: '올해 공휴일 수' }) thisYear!: number;
  @ApiProperty({ description: '다음 해 공휴일 수 — 0 이면 확인 줄' }) nextYear!: number;
  @ApiProperty({ example: '2026-11-09 14:30', description: '지금 문의하면 「답변 예정」(영업일 1일 뒤 · 한국 시간)' }) nextBusinessDay!: string;
  @ApiProperty({ type: [String], description: '운영 값 확인 — 다음 해 공휴일 없음 · 파트너 등급 기준 금액 빈칸' }) checks!: string[];
}
export class HolidaySaveDto {
  @ApiProperty({ example: '2027-02-07' }) @IsString() @Matches(/^20\d{2}-\d{2}-\d{2}$/) day!: string;
  @ApiProperty({ example: '설날', maxLength: 40 }) @IsString() @MinLength(1) @MaxLength(40) name!: string;
}
export class HolidaySaveResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() day!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: '새로 넣었으면 true · 이름만 고쳤으면 false' }) created!: boolean;
}
export class HolidayDeleteResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() day!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/holidays')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class HolidayController {
  constructor(private readonly holidays: HolidayService) {}

  @Get()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '공휴일 목록 · 운영 값 확인', description: '영업일 계산(문의 답변 예정 · 검수 마감)이 주말과 이 날들을 건너뜁니다.' })
  @ApiOkResponse({ type: HolidayListDto })
  list() { return this.holidays.list(); }

  @Put()
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('HOLIDAY_SAVE', 'SITE')
  @ApiOperation({ summary: '공휴일 넣기 · 이름 고치기(SUPER)' })
  @ApiOkResponse({ type: HolidaySaveResultDto })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HOLIDAY_DATE 날짜 형식 · HOLIDAY_NAME 이름 1 ~ 40자' })
  save(@Body() dto: HolidaySaveDto) { return this.holidays.save(dto.day, dto.name); }

  @Delete(':day')
  @Roles('SUPER')
  @Audit('HOLIDAY_DELETE', 'SITE')
  @ApiParam({ name: 'day', example: '2027-02-07' })
  @ApiOperation({ summary: '공휴일 빼기(SUPER)' })
  @ApiOkResponse({ type: HolidayDeleteResultDto })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 목록에 없는 날짜' })
  remove(@Param('day') day: string) { return this.holidays.remove(day); }
}
