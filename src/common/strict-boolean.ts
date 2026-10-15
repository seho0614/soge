import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

/**
 * 참 · 거짓 입력을 **받은 값 그대로** 검사합니다 (v10.21 · G-134).
 *
 * 전역 설정(main.ts 의 enableImplicitConversion)은 요청 값을 선언한 형식으로 바꿔 줍니다.
 * 불리언은 `Boolean(값)` 으로 바뀌므로 "false" · "no" · "0" 같은 **비어 있지 않은 글자가 전부 true** 가 됩니다.
 * 그 상태로 @IsBoolean() 을 통과하면 — 초대 동의의 agree:"false" 가 「동의」로 기록됩니다(되돌릴 수 없는 기록입니다).
 *
 * 이 장식자는 바꾸기 전의 값을 다시 꺼내 검사합니다. JSON 의 true · false 만 통과하고 나머지는 400 입니다.
 * 불리언 입력에는 @IsBoolean() 대신 이것을 씁니다(qa/srv_detail.py S-2 가 소스를 훑어 확인합니다).
 */
export const StrictBoolean = () =>
  applyDecorators(
    Transform(({ obj, key }) => obj[key]),
    IsBoolean(),
  );
