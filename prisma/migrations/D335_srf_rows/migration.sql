-- =====================================================================
-- D335 (v10.801 · docs/917 · 추가 개발 A2) 집합 함수 예상 줄 수 — D333(fn_trust_score) 과 같은 함정 막기
--   RETURNS TABLE · SETOF 함수는 예상 줄 수가 기본 1000 → 그 함수를 붙인 조회 비용이 부풀어 JIT 컴파일(조회마다 100ms 넘게)
--   11/26 전수 조사 74개(에이전트 · 표본 대조): ① 한 줄 · 목록 조회 1(D333 끝) ② 한 줄 · 트리거 · 검색 16 → ROWS 1
--   ③ 여러 줄 중 줄마다 · LATERAL 로 불리는 6 → 실제 줄 수 · 나머지(단독 호출 · 배치 · 쓰기)는 그대로
--   함수 몸 · 결과는 바꾸지 않음 · 다시 돌려도 같음 · 새 집합 함수는 test_v1801 이 ROWS 를 적었는지 봄
-- =====================================================================
ALTER FUNCTION public.fn_agent_watch_state() ROWS 1;
ALTER FUNCTION public.fn_attribution_resolve(uuid,timestamp with time zone,integer) ROWS 1;
ALTER FUNCTION public.fn_attribution_resolve_listing(uuid,uuid,timestamp with time zone,integer) ROWS 1;
ALTER FUNCTION public.fn_checklist_verdict(uuid) ROWS 1;
ALTER FUNCTION public.fn_classify_board_auto(text,text) ROWS 1;
ALTER FUNCTION public.fn_hlt_rate_notice(text,text,numeric) ROWS 1;
ALTER FUNCTION public.fn_hlt_return_judge(uuid,text,text) ROWS 1;
ALTER FUNCTION public.fn_lead_reject_cap(uuid) ROWS 1;
ALTER FUNCTION public.fn_login_gate(text,text) ROWS 1;
ALTER FUNCTION public.fn_mtr_trust(uuid) ROWS 1;
ALTER FUNCTION public.fn_proposal_quota(uuid) ROWS 1;
ALTER FUNCTION public.fn_refund_basis(uuid) ROWS 1;
ALTER FUNCTION public.fn_refund_eligible(uuid) ROWS 1;
ALTER FUNCTION public.fn_request_view_limit(uuid) ROWS 1;
ALTER FUNCTION public.fn_search_normalize(text) ROWS 1;
ALTER FUNCTION public.fn_smx_remote_fee(text) ROWS 1;
ALTER FUNCTION public.fn_withdraw_blockers(uuid) ROWS 3;
ALTER FUNCTION public.fn_deal_timeline(uuid) ROWS 5;
ALTER FUNCTION public.fn_match_scores(uuid,uuid) ROWS 5;
ALTER FUNCTION public.fn_match_candidates(uuid,integer) ROWS 20;
ALTER FUNCTION public.fn_perm_group_expand(text) ROWS 50;
ALTER FUNCTION public.fn_hlt_rate_sched_sellers(text,text) ROWS 200;
