-- ── C941_source_behavior · source 에 BEHAVIOR 추가 ──────────────────
--
-- ★ member_ad_profiles.source 는 MEMBER · GUEST_MERGED 만 받았습니다.
--   제약이 BEHAVIOR 를 막아 학습이 통째로 실패했습니다.
--
--   **정당한 방어입니다.** 아무 값이나 들어가면 나중에 "이 성향이
--   어디서 왔나" 를 알 수 없습니다. 값을 늘리는 것이 맞습니다.

ALTER TABLE member_ad_profiles DROP CONSTRAINT IF EXISTS member_ad_profiles_source_check;
ALTER TABLE member_ad_profiles ADD CONSTRAINT member_ad_profiles_source_check
  CHECK (source IN ('MEMBER','GUEST_MERGED','BEHAVIOR'));

COMMENT ON COLUMN member_ad_profiles.source IS
  'MEMBER(직접 답함) · GUEST_MERGED(비회원 답을 옮김) · '
  'BEHAVIOR(행동으로 바뀜). **BEHAVIOR 면 질문이 아니라 클릭으로 '
  '정해진 것**이라 회원이 "내가 이렇게 답했나?" 할 때 설명이 됩니다.';
