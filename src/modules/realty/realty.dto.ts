import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';

export class SubmitOwnershipDto {
  /* ★ D007 — 실제 파일을 올립니다. POST /files(purpose=OWNERSHIP_DOC) → PUT → complete 로 받은 id.
   *   신청자 본인이 올린 READY 파일이어야 합니다(DB 트리거 fn_file_ref_owner_verif). */
  @ApiPropertyOptional({ format: 'uuid', description: '올린 등기사항증명서 (POST /files · purpose=OWNERSHIP_DOC)' })
  @IsOptional() @IsUUID()
  fileId?: string;

  @ApiPropertyOptional({ example: 'reg-20260918-001.pdf',
    description: '(호환) 문서 이름만. fileId 가 있으면 무시하고 파일 이름을 씁니다. 둘 중 하나는 있어야 합니다' })
  @ValidateIf((o) => !o.fileId)
  @IsString() @Length(1, 200)
  docKey?: string;

  /* ★ 발급일을 받는 이유 — 30일이 넘으면 그 사이 소유권이
   *   이전됐을 수 있습니다. 오래된 등기는 확인이 아닙니다. */
  @ApiProperty({ example: '2026-09-18', description: '등기부 발급일' })
  @IsDateString()
  issuedOn!: string;

  @ApiPropertyOptional({ description: '근저당 등 권리제한이 있습니까' })
  @IsOptional() @StrictBoolean()
  hasEncumbrance?: boolean;
}

export class DecideOwnershipDto {
  @ApiProperty({ enum: ['VERIFIED', 'REJECTED'] })
  @IsIn(['VERIFIED', 'REJECTED'])
  state!: string;

  @ApiPropertyOptional({ description: '거절이면 사유를 적으십시오' })
  @IsOptional() @IsString() @Length(2, 300)
  reason?: string;
}
