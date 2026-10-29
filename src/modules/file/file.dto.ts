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

/** v10.149 — 파일 저장 위치(운영 화면 · 오픈 체크리스트). 버킷 이름만 · 키 · 경로 값은 보내지 않음 */
export class StorageStatusDto {
  @ApiProperty({ enum: ['S3', 'LOCAL'], description: '지금 새 파일이 가는 곳(.env S3_BUCKET 이 있으면 S3)' }) kind!: string;
  @ApiPropertyOptional({ nullable: true, description: 'S3 버킷 이름(S3 일 때만)' }) bucket!: string | null;
  @ApiProperty({ description: '저장 위치가 서버 디스크(LOCAL)로 적힌 파일 수(지운 것 빼고)' }) localFiles!: number;
  @ApiProperty({ description: 'S3 로 적힌 파일 수(지운 것 빼고)' }) s3Files!: number;
  @ApiProperty({ description: '쓰는 파일(READY) 합계 바이트' }) readyBytes!: number;
  @ApiProperty({ description: 'S3 인데 디스크 기록 파일이 남음 = 옮기기(files-to-s3.sh)가 덜 끝남' }) pendingMove!: boolean;
}

