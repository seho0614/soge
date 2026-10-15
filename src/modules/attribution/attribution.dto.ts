import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** POST /attribution/touch — 소개코드 링크(?ref=)로 들어온 방문 */
export class TouchDto {
  @ApiProperty({ example: 'A3K9QZ', description: '소개코드 (영문·숫자 3~16자, 대소문자 무시)' })
  @IsString()
  @Matches(/^[A-Za-z0-9]{3,16}$/, { message: '소개코드는 영문·숫자 3~16자입니다.' })
  code!: string;

  @ApiPropertyOptional({ example: '/mall/b653f333-b5f7-4a25-8c7b-5e51b845fe4f', description: '들어온 화면 주소 (경로 또는 http/https 주소, 500자 이내)' })
  @IsOptional() @IsString() @MaxLength(500)
  @Matches(/^(\/|https?:\/\/)\S*$/, { message: '들어온 주소는 / 로 시작하는 경로나 http(s) 주소여야 합니다.' })
  landingUrl?: string;
}

export class TouchResultDto {
  @ApiProperty({ description: '이번 요청이 유입으로 기록됐는가' }) recorded!: boolean;
  @ApiPropertyOptional({
    enum: ['INVALID_CODE', 'SELF', 'DUPLICATE', 'BOT'],
    description: '기록하지 않은 까닭 — 없는·폐기·만료 코드 / 코드 주인 본인 / 24시간 안에 같은 방문자·같은 코드 / 미리보기 로봇',
  })
  reason?: string;
  @ApiPropertyOptional({ example: 90, description: '기록했으면 소개자로 남는 기간(일)' }) windowDays?: number;
}
