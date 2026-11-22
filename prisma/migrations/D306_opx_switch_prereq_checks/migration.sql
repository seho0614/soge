-- =====================================================================
-- D306 (v10.625 · docs/768) 켜기 도우미 — 스위치 선행 조건 확인 기록
--
--   opx_switch_prereq_checks : 처음 꺼진 스위치를 켜기 전에 SUPER 가 선행 조건(법무 · 처리방침 · 연동 키 · 계약 · 회원 · 직원 안내)을
--                              「확인함」으로 적은 줄 — 쌓기만(고치기 · 지우기 막음 · 다시 적으면 가장 최근 줄이 지금 상태)
--   선행 조건 종류는 서버가 켤 조건 글(opx_switch_docs.cond)에서 낱말로 고름(switches.ts prereqOf) — 이 표는 확인 기록만
--   켜기 자체는 그대로 정책 › 「전체 설정」(바뀐 기록 · 사유) — 이 표가 켜기를 막지 않음(알림만)
--   다시 돌려도 같음 · 지우는 문장 없음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.opx_switch_prereq_checks (
  id          bigserial PRIMARY KEY,
  key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*\.[a-z0-9_.]+$' AND length(key) <= 80),
  prereq      text NOT NULL CHECK (prereq IN ('LEGAL', 'PRIVACY', 'KEY', 'CONTRACT', 'NOTICE')),
  state       text NOT NULL DEFAULT 'DONE' CHECK (state IN ('DONE', 'UNDO')),
  note        text NOT NULL CHECK (length(btrim(note)) BETWEEN 2 AND 300),
  checked_by  uuid REFERENCES public.accounts(id),
  checked_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opx_switch_prereq_checks_key ON public.opx_switch_prereq_checks (key, prereq, id DESC);
COMMENT ON TABLE public.opx_switch_prereq_checks IS 'v10.625 (D306 · docs/768) 켜기 도우미 — 스위치 선행 조건 「확인함」 기록 · 쌓기만 · 가장 최근 줄(state DONE · UNDO)이 지금 상태 · 켜기는 막지 않음';

CREATE OR REPLACE FUNCTION public.fn_opx_switch_prereq_ro() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'OPX_PREREQ_RO: 선행 조건 확인 기록은 고치거나 지울 수 없습니다.' USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_opx_switch_prereq_ro ON public.opx_switch_prereq_checks;
CREATE TRIGGER trg_opx_switch_prereq_ro BEFORE UPDATE OR DELETE ON public.opx_switch_prereq_checks
  FOR EACH ROW EXECUTE FUNCTION public.fn_opx_switch_prereq_ro();

-- ---------------------------------------------------------------------
-- v10.625 (docs/768) 켤 조건 채우기 — 켤 조건(opx_switch_docs) 줄이 없던 스위치 118개
--   글은 판 문서 · 설정 설명 · docs/700 · docs/760 8절에서만 따옴 · 처음 값은 마이그레이션이 넣은 값 · 있으면 그대로 둠
--   켜기 도우미가 이 글에서 선행 조건(법무 · 처리방침 · 연동 키 · 계약 · 안내)을 고름 · 처음부터 켜진 것은 「선행 조건 없음」
-- ---------------------------------------------------------------------
INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref, who) VALUES
  ('account.login_alert', 'on', '처음부터 켜짐(선행 조건 없음) — 끄면 낯선 기기 로그인 알림이 만들어지지 않음', 'docs/356', 'SUPER'),
  ('acct.budget_alert', 'on', '처음부터 켜짐(선행 조건 없음) — 예산을 넣은 계정만 알림', 'docs/536', 'ADMIN'),
  ('acct.card_alert', 'on', '처음부터 켜짐(선행 조건 없음) — 카드 한도 · acct.card_alert_pct 를 정한 뒤 의미 있음', 'docs/590', 'ADMIN'),
  ('acct.cashplan_alert', 'on', '처음부터 켜짐(선행 조건 없음) — acct.cash_floor 를 정한 뒤 의미 있음', 'docs/614', 'ADMIN'),
  ('acct.commission_vat_included', 'off', '세무 확인 뒤에만 — 11/19 대표 「부가세 별도」로 off 유지(on 이면 수수료 ÷ 11 을 부가세로 나눔)', 'docs/517', 'SUPER'),
  ('acct.include_stub', 'off', '간주 결제가 켜진 동안은 off 권함 — 실제 돈이 아닌 결제를 전표로 만들 때만 SUPER 가 켬', 'docs/518', 'SUPER'),
  ('acct.reorder', 'on', '처음부터 켜짐(선행 조건 없음) — 안전 재고 규칙을 넣은 옵션만 알림 · 발주는 사람이 넣음', 'docs/616', 'ADMIN'),
  ('acct.sub_vat_included', 'on', '처음부터 켜짐(선행 조건 없음) — 11/19 대표 「부가세 별도」 결정대로 결제 금액 ÷ 11 을 부가세로 나눔', 'docs/517', 'SUPER'),
  ('agent.chat.drafts.enabled', 'off', 'AI 전체(agent.enabled) · 내 정보 조회(agent.chat.member_lookup.enabled)가 켜진 뒤 · 신청서 초안 문구 확인 뒤', NULL, 'SUPER'),
  ('agent.chat.member_lookup.enabled', 'off', 'AI 전체(agent.enabled) 켜짐 · 처리방침(국외 이전 · AI 고지) 게시 뒤 · 읽기만 동작 확인 뒤', NULL, 'SUPER'),
  ('agent.require_privacy', 'on', '처음부터 켜짐(선행 조건 없음) — 국외 이전 조항 게시 전 AI 를 막는 안전장치라 끄지 않음', 'docs/237', 'SUPER'),
  ('agent.review_shadow.enabled', 'off', 'AI 전체(agent.enabled) · 월 상한(agent.monthly_cap_usd) 확인 뒤 — 의견만 저장 · 검수 상태는 그대로', NULL, 'SUPER'),
  ('agent.town_pick.enabled', 'off', 'AI 전체 스위치 · 월 상한 확인 · 운영자 승인 담당을 정한 뒤', 'docs/336', 'SUPER'),
  ('alimtalk.require_test', 'on', '처음부터 켜짐(선행 조건 없음) — 알림톡 켜기 전 시험 발송을 요구하는 안전장치라 끄지 않음', NULL, 'SUPER'),
  ('bzx.ad_autopause', 'off', '광고주에게 「예산 소진 시 자동 정지」 동작 안내 뒤 · 예산 줄마다 자동 정지를 고른 소재만 멈춤', 'docs/752', 'SUPER'),
  ('bzx.card_notify', 'off', '카드 한도 화면에 쓰는 사람을 정하고 직원에게 알림이 감을 공지한 뒤', 'docs/755', 'SUPER'),
  ('bzx.inquiry_photos', 'off', '회원 안내(사진 더 붙이기 · 답변 사진) 게시 뒤 · 처리방침 1.2 게시 뒤(회원이 낸 사진 · 보관 기간)', 'docs/753', 'SUPER'),
  ('bzx.partner_esign', 'off', '전자계약 업체 계약 · 연동 키(ESIGN) 등록 뒤 — 그 전에는 off(간주 서명 · 법적 전자서명 아님)', 'docs/751', 'SUPER'),
  ('bzx.partner_notice', 'off', '파트너에게 계약 만기 · 서명 요청 알림 문구 확인 뒤 · 파트너 안내 뒤', 'docs/751', 'SUPER'),
  ('classify.learn.enabled', 'on', '처음부터 켜짐(선행 조건 없음) — 학습이 이상하게 가면 먼저 끄고 원인을 봄', NULL, 'SUPER'),
  ('csx.account_merge', 'off', '본인인증 연동(실제 NICE) 뒤 · 합치기는 되돌릴 수 없음 — 회원 안내 · 처리방침 확인 뒤 SUPER', 'docs/669', 'SUPER'),
  ('csx.ai_draft', 'off', 'AI 전체 스위치 · 월 상한 확인 뒤 — 초안은 회원에게 안 보임', 'docs/666', 'ADMIN'),
  ('csx.ai_draft_auto', 'off', 'csx.ai_draft 켜짐 · 한 주 이상 수동 초안 품질 확인 뒤', 'docs/666', 'ADMIN'),
  ('csx.churn', 'off', '처리방침 1.2 게시 뒤(활동 기록으로 회원 분류) · 운영 화면 안에서만 봄', 'docs/667', 'ADMIN'),
  ('csx.mail_templates', 'off', '운영 화면에서 고친 메일 문구를 검사 통과 · 미리보기로 확인한 뒤', 'docs/668', 'ADMIN'),
  ('etax.require_config', 'on', '처음부터 켜짐(선행 조건 없음) — 전자세금계산서 간주 끄기 전 업체 설정 · 시험 발행을 요구하는 안전장치라 끄지 않음', 'docs/235', 'SUPER'),
  ('feature.referral_fee', 'off', '본인인증 · 1원 계좌인증 연동 뒤 · 소개비 약관 법무 확인 뒤 운영자가 켬', NULL, 'SUPER'),
  ('feature.success_fee', 'off', '성사 수수료 도입 대표 결정 · 요금 변경 고지(약관) 법무 확인 뒤 — 지금은 매출이 월 구독료만', NULL, 'SUPER'),
  ('grw.digest', 'off', '회원 안내(하루 요약 받기) 게시 뒤 · 메일 준비 전에는 사이트 알림만', 'docs/741', 'SUPER'),
  ('grw.fill_helper', 'on', '처음부터 켜짐(선행 조건 없음) — 표시만 · 노출 순위 · 소개비에 쓰지 않음', 'docs/743', 'SUPER'),
  ('grw.first_steps', 'on', '처음부터 켜짐(선행 조건 없음) — 표시만 · 새로 모으는 정보 없음', 'docs/740', 'SUPER'),
  ('grw.signup_steps', 'off', '처리방침 1.2 게시 뒤(가입 단계 수 세기) · 하루 수만 셈', 'docs/739', 'SUPER'),
  ('grw.tier_legal_ok', 'off', '법무 확인(방문판매법 다단계판매 해당 여부) 끝 — 확인한 곳 · 날짜를 사유에 적고 SUPER 가 켬', 'docs/742', 'SUPER'),
  ('grw.tier_reward', 'off', '법무 확인(방문판매법 다단계판매 해당 여부) 뒤 grw.tier_legal_ok 를 먼저 켬 · 회원 안내(보상 규칙) 게시 뒤 SUPER', 'docs/742', 'SUPER'),
  ('hra.close_alert', 'off', '마감일(acct.close_by_day) · 마감 체크리스트 항목을 정한 뒤 — 선행 조건 없음', 'docs/726', 'SUPER'),
  ('hra.leave_promo', 'off', '취업규칙의 연차 사용 촉진 절차를 직원에게 공지한 뒤(노무 확인)', 'docs/723', 'SUPER'),
  ('hra.lib_unread_alert', 'off', '사내 자료실에 꼭 읽을 공지 · 기한을 정한 뒤 — 선행 조건 없음', 'docs/724', 'SUPER'),
  ('hra.payfile_export', 'off', '은행 대량 이체 양식 확인 · 계좌 원문이 든 파일이라 내려받을 사람을 정한 뒤 SUPER', 'docs/725', 'SUPER'),
  ('hr.leave_allow_negative', 'off', '취업규칙에 연차 당겨 쓰기를 둔 경우만 — 직원 공지 뒤', 'docs/583', 'ADMIN'),
  ('hrx.ot_over_block', 'on', '처음부터 켜짐(선행 조건 없음) — 주 연장 한도(OT 한도)를 넘는 승인을 막는 안전장치', 'docs/609', 'ADMIN'),
  ('hrx.sat_as_holiday', 'off', '취업규칙이 토요일을 휴일로 정한 경우만 — 노무 확인 뒤', 'docs/609', 'ADMIN'),
  ('i18n.auto_translate.enabled', 'off', 'AI 전체(agent.enabled) · 월 상한(agent.monthly_cap_usd) 확인 뒤 · 처리방침(국외 이전) 게시 뒤', 'docs/162', 'SUPER'),
  ('i18n.board_on_view', 'off', 'AI 전체 · 월 상한 확인 뒤 · 처리방침(국외 이전) 게시 뒤', 'docs/148', 'SUPER'),
  ('identity.require_check', 'on', '처음부터 켜짐(선행 조건 없음) — NICE 로 바꾸기 전 확인을 요구하는 안전장치라 끄지 않음', NULL, 'SUPER'),
  ('its.asset_alert', 'on', '처음부터 켜짐(선행 조건 없음) — IT 자산 · 구독에 갱신일을 넣은 것만 알림', 'docs/629', 'ADMIN'),
  ('its.key_alert', 'on', '처음부터 켜짐(선행 조건 없음) — 기한을 넣은 항목만 알림(값 없이 이름만)', 'docs/628', 'ADMIN'),
  ('its.suggest_alert', 'on', '처음부터 켜짐(선행 조건 없음) — 제안 수만 알림', 'docs/630', 'ADMIN'),
  ('legal.location_waived', 'on', '처음부터 켜짐(선행 조건 없음) — 위치정보를 수집하지 않는 한 그대로 — 좌표 칸이 생기면 검정 BR-05 가 잡음', NULL, 'SUPER'),
  ('lsq.track_mode', 'ASSUME', 'LIVE 는 택배사 조회 대행 계약 · 연동 키(CARRIER) · 주소 틀 CARRIER_TRACK_BASE 확인 뒤 — 그 전에는 ASSUME', 'docs/749', 'ADMIN'),
  ('lsx.ai_summary', 'off', 'AI 전체 스위치 · 월 상한 확인 뒤 — 운영자 승인 뒤에만 상세에 보임', 'docs/654', 'ADMIN'),
  ('lsx.expiry', 'off', '회원 안내(매물 만료 · 연장 규칙) 게시 뒤 — 대표 결정 11/20 기본 6개월', 'docs/652', 'ADMIN'),
  ('lsx.saved_search', 'off', '회원 안내(저장한 검색 · 새 매물 알림) 게시 뒤 · 알림 수신 설정을 따름', 'docs/651', 'ADMIN'),
  ('lsy.dup_detect', 'off', '기준 값을 운영 화면에서 미리 보고 정한 뒤 — 짝으로 남기기만(자동으로 내리지 않음)', 'docs/662', 'ADMIN'),
  ('lsy.dup_queue', 'on', '처음부터 켜짐(선행 조건 없음) — lsy.dup_detect 가 켜졌을 때만 동작', 'docs/662', 'ADMIN'),
  ('lsy.photo_ai', 'off', 'AI 전체 스위치 · 월 상한 확인 뒤 · 처리방침(국외 이전) 게시 뒤', 'docs/663', 'ADMIN'),
  ('lsy.photo_check', 'off', '선행 조건 없음 — 경고만(막지 않음) · 운영 화면에서 확인 뒤 켬', 'docs/663', 'ADMIN'),
  ('lsy.report_ai', 'off', 'AI 전체 스위치 · 월 상한 확인 뒤 · lsy.report_triage 켜짐', 'docs/665', 'ADMIN'),
  ('lsy.report_triage', 'off', '선행 조건 없음 — 제안만 · 사람이 확정 · 운영 화면에서 확인 뒤 켬', 'docs/665', 'ADMIN'),
  ('lsy.video', 'off', '회원 안내(동영상 1개 · 운영 승인) 게시 뒤 · 서버 디스크 여유 확인 뒤', 'docs/664', 'ADMIN'),
  ('mall.cash_receipt_self', 'off', '의무발행업종 해당 여부 세무사 확인 뒤 SUPER', 'docs/644', 'SUPER'),
  ('mall.review_points', 'off', '적립금(mall.points) 켜짐 · 회원 안내(리뷰 적립 · 회수 규칙) 게시 뒤', 'docs/671', 'ADMIN'),
  ('mall.statement_mail', 'off', '메일 준비(notify.email_verified) 뒤 · 판매자에게 월 정산서 메일 안내 뒤', 'docs/670', 'ADMIN'),
  ('mall.tenant_apply', 'off', '입점 약관(HLT_SELLER) 법무 확인 · 게시 뒤에만 SUPER', 'docs/358', 'SUPER'),
  ('mal.partner_only', 'off', '오픈 직전 축별 입점 업체 일괄 이관(fn_mal_partner_bulk_migrate) 뒤 · 파트너 안내 뒤', NULL, 'SUPER'),
  ('map.cluster_enabled', 'off', '카카오 지도 연동 키 등록(map.enabled) 뒤 — 없으면 시 · 구 목록만', 'docs/681', 'ADMIN'),
  ('map.cluster_grid', 'off', '법무 확인 뒤(정확 좌표를 격자로 묶어 보임) · map.cluster_enabled 켜짐', 'docs/681', 'ADMIN'),
  ('map.food_geolocation', 'off', '위치정보법 법무 확인 뒤(decisions/map-kakao #10) — 위치를 서버로 보내지 않음', 'docs/98', 'SUPER'),
  ('mkx.groupbuy', 'off', '주문 받기(mall.order_open) 켜짐 · 회원 안내(공동구매 확정 · 실패 · 환불) 게시 뒤', 'docs/678', 'ADMIN'),
  ('mkx.optout080_hook', 'off', '080 수신 거부 대행 업체 계약 · 연동 키(X-Optout-Token) 등록 뒤', 'docs/679', 'ADMIN'),
  ('mkx.rebuy', 'off', '마케팅 수신 동의자만 · 광고성 정보 표시 문구 확인 뒤(21 ~ 8시 안 보냄)', 'docs/677', 'ADMIN'),
  ('mtr.appeal', 'off', '회원 안내(이의 제기 · 재판단 절차) 게시 뒤 · 운영 담당을 정한 뒤', 'docs/715', 'ADMIN'),
  ('mtr.dormant', 'off', '법무 확인(휴면 · 분리 보관은 회사 선택) 뒤 · 회원 안내(미접속 기간 · 휴면 전 알림) 게시 뒤', 'docs/718', 'ADMIN'),
  ('mtr.dormant_mail', 'off', 'mtr.dormant 켜짐 · 메일 준비(notify.email_verified) 뒤', 'docs/718', 'ADMIN'),
  ('mtr.review_watch', 'off', '처리방침 1.2 게시 뒤(같은 기기 · 몰림 신호 사용) · 의심 목록만(자동 삭제 없음)', 'docs/716', 'ADMIN'),
  ('mtr.trust', 'off', '회원 안내(내 신뢰 점수 · 셈 방식) 게시 뒤 · 노출 순위 · 소개비에 쓰지 않음', 'docs/717', 'ADMIN'),
  ('notify.alimtalk_ready', 'off', '알림톡 업체 계약 · 연동 키 · 템플릿 사전 승인 · 최근 7일 시험 발송 성공 뒤', NULL, 'SUPER'),
  ('notify.email_verified', 'off', 'SPF · DKIM · DMARC 설정 · SMTP 연동 키 · 최근 7일 시험 메일 성공 뒤', NULL, 'SUPER'),
  ('notify.require_mail_test', 'on', '처음부터 켜짐(선행 조건 없음) — 메일 켜기 전 시험 메일을 요구하는 안전장치라 끄지 않음', NULL, 'SUPER'),
  ('notify.sms_ready', 'off', '문자 업체 계약 · 연동 키 · 발신번호 등록 뒤', NULL, 'SUPER'),
  ('ofc.browser_notify', 'on', '처음부터 켜짐(선행 조건 없음) — 계정마다 브라우저에서 따로 허락해야 보임', 'docs/603', 'ADMIN'),
  ('ofc.task_due_alert', 'on', '처음부터 켜짐(선행 조건 없음) — 기한 지난 업무 수만 알림', 'docs/601', 'ADMIN'),
  ('opb.alert_group_mail', 'off', 'opb.alert_routes 켜짐 · 메일 준비 뒤 · 받을 직원에게 알림 메일이 감을 공지한 뒤', 'docs/714', 'SUPER'),
  ('opb.alert_routes', 'off', '위험감지 › 알림 받을 사람 규칙을 미리 넣고 확인한 뒤 — 선행 조건 없음', 'docs/714', 'SUPER'),
  ('ops.owner_todo_weekly', 'on', '처음부터 켜짐(선행 조건 없음) — 텔레그램 · 슬랙 길이 켜져 있어야 보냄', 'docs/386', 'ADMIN'),
  ('ops.slack_digest', 'on', '처음부터 켜짐(선행 조건 없음) — 슬랙 웹훅 주소가 있어야 보냄', 'docs/377', 'ADMIN'),
  ('ops.staff_login_alert', 'on', '처음부터 켜짐(선행 조건 없음) — 운영자 낯선 로그인을 운영 알림으로 남기는 안전장치', 'docs/318', 'ADMIN'),
  ('ops.telegram_digest', 'on', '처음부터 켜짐(선행 조건 없음) — 대화방(ops.telegram_chat) · 봇 토큰이 있어야 보냄', 'docs/318', 'ADMIN'),
  ('papi.bill_enabled', 'off', 'papi.enabled 켜짐 · 파트너와 오픈 API 요금 계약 뒤', 'docs/683', 'SUPER'),
  ('papi.enabled', 'off', '보안 검토(docs/659 6절) 뒤 · 파트너 오픈 API 이용 계약 뒤 SUPER', 'docs/659', 'SUPER'),
  ('papi.hook_enabled', 'off', 'papi.enabled 켜짐 · 파트너 웹훅 주소 · 서명 확인 뒤', 'docs/659', 'ADMIN'),
  ('papi.hook_mode', 'ASSUME', 'LIVE 는 파트너 웹훅 주소 · 서명 연동 키 확인 뒤 — 그 전에는 ASSUME', 'docs/659', 'ADMIN'),
  ('pbulk.invite_mail', 'off', '법무 확인(docs/660 5절) 뒤 · 메일 준비 뒤 SUPER', 'docs/660', 'SUPER'),
  ('perm.auto_role_group', 'on', '처음부터 켜짐(선행 조건 없음) — 역할을 줄 때 같은 범위 권한그룹을 붙이는 기본 동작', 'docs/578', 'SUPER'),
  ('poll.guest_vote', 'on', '처음부터 켜짐(선행 조건 없음) — 끄면 로그인 회원만 투표', NULL, 'SUPER'),
  ('poll.home_autofill', 'on', '처음부터 켜짐(선행 조건 없음) — 끄면 메인 투표 자리가 「준비 중」', 'docs/285', 'ADMIN'),
  ('prx.ad_report_mail', 'off', '메일 준비(notify.email_verified) 뒤 — 법무 확인 끝(대표 11/20)', 'docs/657', 'SUPER'),
  ('prx.ref_event', 'off', '법무 확인 뒤 · 진행 중(ACTIVE) 이벤트를 만들고 회원 안내(이벤트 규칙) 게시 뒤 SUPER', 'docs/656', 'SUPER'),
  ('ptn.export_enabled', 'off', '파트너에게 내려받기 기록 · 승인 규칙 안내 뒤 — 연락처 없는 CSV 만', 'docs/682', 'ADMIN'),
  ('push.enabled', 'off', '앱처럼 설치(site.pwa) 켜짐 · 회원 안내(웹 푸시 켜기) 게시 뒤', 'docs/676', 'ADMIN'),
  ('push.quiet', 'on', '처음부터 켜짐(선행 조건 없음) — 21:00 ~ 08:00 급한 알림만 보내는 기본값', 'docs/676', 'ADMIN'),
  ('push.send', 'off', 'push.enabled 켜짐 · push.send_mode LIVE 면 WEBPUSH 연동 키 등록 뒤', 'docs/676', 'ADMIN'),
  ('push.send_mode', 'ASSUME', 'LIVE 는 외부 연동 WEBPUSH 연동 키(VAPID) · push.vapid_subject 등록 뒤 — 그 전에는 ASSUME', 'docs/676', 'ADMIN'),
  ('qlt.expiry_alert', 'on', '처음부터 켜짐(선행 조건 없음) — 남은 수량이 있는 로트만 알림', 'docs/633', 'ADMIN'),
  ('request.view.limit', 'off', '홍보 기간이 끝나면(최초 3개월) 정식 서비스 열람 한도로 켬 — 회원 공지 뒤 · request.view.limit_from 날짜가 되면 저절로 적용', NULL, 'SUPER'),
  ('risk.learn.enabled', 'on', '처음부터 켜짐(선행 조건 없음) — 끄면 예외가 늘지 않고 경보가 계속 뜸', NULL, 'SUPER'),
  ('sales.opp_remind', 'on', '처음부터 켜짐(선행 조건 없음) — 다음 할 날짜를 넣은 영업 기회만 알림', 'docs/604', 'ADMIN'),
  ('search.llm_parser.enabled', 'off', 'AI 전체 스위치 · 월 상한 확인 뒤 · 처리방침(국외 이전) 게시 뒤 — 문제면 끄면 규칙 엔진으로 돌아감', NULL, 'SUPER'),
  ('segment.learn.enabled', 'on', '처음부터 켜짐(선행 조건 없음) — 끄면 가입 때 답한 성향이 그대로 유지', NULL, 'SUPER'),
  ('smq.penalty', 'off', '입점 약관에 평가 · 패널티 기준을 적고 법무 확인 · 판매자 공지 뒤', 'docs/721', 'SUPER'),
  ('smq.penalty_exposure', 'off', 'smq.penalty 켜짐 · 입점 약관에 노출 제한 기준을 적은 뒤(법무 확인) SUPER', 'docs/721', 'SUPER'),
  ('smq.qna', 'off', '판매자센터 문의 답 화면을 판매자에게 안내 · 교육한 뒤', 'docs/719', 'ADMIN'),
  ('smx.bundle', 'off', '직판 묶음 상품 · 가격을 운영 화면에서 확인한 뒤 — 선행 조건 없음', 'docs/691', 'ADMIN'),
  ('smx.remote_ship', 'off', '도서산간 구역 표를 넣고 회원 안내(추가 배송비) 게시 뒤 · 입점 판매자 공지 뒤', 'docs/692', 'ADMIN'),
  ('smx.review_reply', 'off', '입점 판매자에게 리뷰 답글 규칙(금칙어 · 운영 확인) 안내 뒤', 'docs/693', 'ADMIN'),
  ('social.mode', 'ASSUME', 'LIVE 는 카카오 · 네이버 간편 로그인 연동 키(SOCIAL) 등록 · 처리방침 게시 뒤 — 운영 서버에서 ASSUME 은 쓸 수 없음', 'docs/636', 'ADMIN'),
  ('terms.notify_members', 'on', '처음부터 켜짐(선행 조건 없음) — 약관 시행 예정 게시 때 회원 알림을 만드는 기본값', 'docs/248', 'SUPER'),
  ('terms.reconsent_before_effective', 'off', '법무 판단 뒤에만 — 기본 off(시행일부터 새 판 동의 · 이용약관 제14조)', 'docs/246', 'SUPER'),
  ('vsx.enabled', 'off', '회원 안내(방문 예약 · 노쇼 표시) 게시 뒤 · 처리방침 1.2 게시 뒤(방문 일정 기록)', 'docs/680', 'ADMIN')
ON CONFLICT (key) DO NOTHING;
