-- v10.28 (G-219 후속) — 발행된 약관 본문의 깨진 시행일(「2026년 M월 4일」)을 바로잡습니다.
--   예전 통합 검정 픽스처(scripts/fixture.sql)가 날짜 형식을 'YYYY년 M월 D일' 로 써서(M 은 형식 글자가 아니고 D 는 요일 번호)
--   그 픽스처를 돌린 DB — 검정 DB 와, **처음 설치 때 local-setup.sh 가 픽스처를 돌린 PC 의 개발 DB(Docker 볼륨)** — 의 발행 약관에 남아 있었습니다.
--   v10.28 픽스처는 형식을 고치고 바로잡기도 하지만, 픽스처를 다시 돌리지 않는 쓰던 개발 DB 에는 그대로 남아 이 마이그레이션이 고칩니다
--   (10/9 Docker 검정에서 v10.27 볼륨의 판매 약관으로 찾음 — srv_mall K-5).
--   운영 서버는 약관이 초안이라(픽스처를 돌리지 않음) 해당 줄이 없어 아무것도 바꾸지 않습니다. 시행일 줄의 날짜만 고치고 나머지 글은 그대로입니다.
UPDATE public.terms
   SET body = regexp_replace(body, '시행일 [0-9]{4}년 M월 [0-9]일',
                             '시행일 ' || to_char(effective_from AT TIME ZONE 'Asia/Seoul', 'YYYY"년" FMMM"월" FMDD"일"'), 'g')
 WHERE status = 'PUBLISHED'
   AND effective_from <> 'infinity'
   AND body ~ '시행일 [0-9]{4}년 M월 [0-9]일';
