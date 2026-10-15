import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

/* v10.31 — 매물 · 요청 이미지 · 문의 첨부(w1) · BROKER_DOC 중개사 제출 서류(w2 · D050) · PARTNER_MEDIA 파트너 사진 · 로고(w5 · D072)
 *   DB 의 ck_files_purpose(D090 합침) · file_policies 와 같은 목록입니다 */
export const FILE_PURPOSES = ['OWNERSHIP_DOC', 'MARKETING_MATERIAL', 'PARTNER_GUIDE', 'PRODUCT_IMAGE', 'LISTING_IMAGE', 'REQUEST_IMAGE', 'INQUIRY_ATTACHMENT', 'BROKER_DOC', 'PARTNER_MEDIA'] as const;   // + PARTNER_MEDIA(w5 · D072)

export class CreateFileDto {
  @ApiProperty({ enum: FILE_PURPOSES, description: '어디에 쓸 파일인가 — 용도마다 받는 형식 · 크기가 다릅니다' })
  @IsIn(FILE_PURPOSES as unknown as string[])
  purpose!: string;

  @ApiProperty({ example: '등기사항증명서_운양동.pdf', description: '보여 줄 이름. 경로 · 제어문자는 서버가 지웁니다' })
  @IsString() @Length(1, 255)
  name!: string;

  @ApiProperty({ example: 'application/pdf', description: 'PDF · JPG · PNG (마케팅자료는 MP4 도). 실제 바이트로 다시 판정합니다' })
  @IsString() @Length(3, 100)
  contentType!: string;

  @ApiProperty({ example: 182044, description: '바이트. 올린 크기가 다르면 complete 에서 거절합니다' })
  @IsInt() @Min(1) @Max(104857600)
  size!: number;

  @ApiPropertyOptional({ description: 'SHA-256 (16진 64자). 주면 complete 때 대조합니다' })
  @IsOptional() @IsString() @Matches(/^[0-9a-fA-F]{64}$/, { message: 'sha256 은 16진 64자입니다.' })
  sha256?: string;
}

export class FileOpenQueryDto {
  @ApiPropertyOptional({ enum: ['attachment', 'inline'], description: 'inline 이면 브라우저에서 바로 엽니다 (문서 열기)' })
  @IsOptional() @IsIn(['attachment', 'inline'])
  disposition?: string;
}
