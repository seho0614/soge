-- =====================================================================
-- B110_comments
--
-- 주석. 스키마를 읽는 사람에게 남기는 설명입니다.
--
-- 검증된 상태(불변식 135 · 공격 37 · 문서 22 통과)에서 생성된 기준선입니다.
-- 손으로 고치지 마십시오.
-- 스키마를 바꾸려면 prisma/migrations/ 에 새 파일을 추가하십시오.
-- =====================================================================

COMMENT ON SCHEMA public IS '';

COMMENT ON FUNCTION public.fn_ad_anonymize(p_account uuid) IS '계정 삭제 시 노출 로그 익명화. 유출 점검을 먼저 기록하고 그다음 익명화합니다 — 순서가 바뀌면 위반 여부를 확인할 방법이 사라집니다.';

COMMENT ON FUNCTION public.fn_attribution_resolve(p_account_id uuid, p_at timestamp with time zone, p_policy integer) IS '순수 함수. 같은 입력이면 항상 같은 결과 — 분쟁 시 재현 가능해야 한다.
   동시각 tie-break 로 id ASC 를 둔 이유도 재현성이다.';

COMMENT ON FUNCTION public.fn_auto_confirm_on_contract() IS 'A-15 자동 처리 원칙. 소개자의 신고 행위 없이 성사가 기록되므로,
   성사 신고 유인 설계(인센티브)가 불필요해진다. 단 계약이 시스템 밖에서
   이루어지면 여전히 포착되지 않는다 — 계약서 발급을 주 동선으로 둘 것.';

COMMENT ON FUNCTION public.fn_auto_review_reasons(p_review_item_id uuid) IS '빈 배열 = 사람이 볼 이유 없음 = 자동 승인 대상.
   금칙어·제한업종 BLOCK 은 등록 단계에서 이미 차단되므로 여기서 다시 보지 않습니다.';

COMMENT ON FUNCTION public.fn_block_audit_write() IS '감사 로그는 append-only 이나, 보유기간 경과 IP 마스킹만 예외로 둡니다.
   우회(session_replication_role)하면 무결성이 통째로 열리므로 규칙을 좁혔습니다.';

COMMENT ON FUNCTION public.fn_category_restrict_cascade() IS '업종이 제한으로 지정되면 기존 매물도 내리고 등록자에게 알립니다. 새 등록만 막으면 지정 전에 올라온 것이 계속 노출됩니다.';

COMMENT ON FUNCTION public.fn_check_banned_words(p_text text, p_gwan text) IS '검사 대상 텍스트와 관 코드를 받아 걸린 금칙어를 돌려줍니다.';

COMMENT ON FUNCTION public.fn_checklist_verdict(p_listing_id uuid) IS '자동 노출 여부. **법적 게이트를 먼저 봅니다** — 체크리스트를 먼저 보면 "통과했으니 자동"으로 잘못 읽힙니다.';

COMMENT ON FUNCTION public.fn_classify_blocked(p_text text) IS '제한업종·금칙어 판정. **이름이 아니라 실제로 쓰는 말로 찾습니다** — 올리는 사람은 "의료 서비스" 가 아니라 "성형외과" 라고 씁니다.';

COMMENT ON FUNCTION public.fn_derive_segment(p_account uuid) IS '행동으로 세그먼트를 정합니다. **클라이언트가 보내지 않습니다** — 전에는 아무 값이나 넣을 수 있었습니다.';

COMMENT ON FUNCTION public.fn_end_promo(p_subscription_id uuid, p_next_plan text) IS '슬롯 초과분은 최신순으로 남기고 나머지를 SUSPENDED. 삭제하지 않으므로 재구독 시 즉시 복구.';

COMMENT ON FUNCTION public.fn_hlt_one_seller() IS '한 주문에 한 판매자만(INV-H9). 섞이면 부분 취소·반품이 지옥이 됩니다. 수수료는 **주문 시점 요율로 박습니다** — 나중에 요율을 바꿔도 이 주문은 그대로.';

COMMENT ON FUNCTION public.fn_hlt_rate_for(p_seller uuid, p_category_code text) IS '이 판매자·이 카테고리에 적용할 수수료율. **한 곳에서만 정합니다** — 앱이 따로 계산하면 화면과 정산이 갈립니다.';

COMMENT ON FUNCTION public.fn_is_intro_blocked(p_code text, p_gwan text) IS '소개·알선이 막히는가. AD_ONLY 도 BLOCK 과 같이 막습니다 — "광고만 가능"은 광고를 허용한다는 뜻이지 소개를 허용한다는 뜻이 아닙니다.';

COMMENT ON FUNCTION public.fn_is_verified_broker(p_account uuid) IS '중개사 인증 여부. 재확인 기한이 지나면 false 입니다 — 폐업했는데 인증이 남아 있으면 안 됩니다.';

COMMENT ON FUNCTION public.fn_jobs_due(p_now timestamp with time zone) IS '지금 돌아야 할 작업. 주기 경계가 아니라 마지막 실행 이후 경과로 판단합니다 — tick 을 놓쳐도 다음 번에 따라잡습니다. 중복은 job_runs 의 UNIQUE 가 막습니다.';

COMMENT ON FUNCTION public.fn_lead_rate(p_gwan text, p_grade text) IS '관별 리드 단가. 관 전용이 있으면 그것을, 없으면 공통을 씁니다 — 전부 복제하면 공통을 고칠 때 다섯 군데를 다 고쳐야 합니다.';

COMMENT ON FUNCTION public.fn_listing_requires_business() IS '상품·서비스·창업 판매는 인증 사업자만. 사람·기업은 개인도 가능. 요청은 제한 없음.';

COMMENT ON FUNCTION public.fn_listing_seller_gate() IS '판매 등록 게이트. **사람 소개(item_type=PERSON)는 개인도 가능**합니다 — 물건 판매와 달리 세금계산서·하자담보 책임이 따라오지 않습니다.';

COMMENT ON FUNCTION public.fn_match_candidates(p_lead uuid, p_limit integer) IS '리드에 맞는 파트너 후보와 총점. 자격 없는 파트너는 후보에 들지 않습니다 — 미납 한도 초과·승인 전은 리드를 받을 수 없습니다.';

COMMENT ON FUNCTION public.fn_match_scores(p_partner uuid, p_lead uuid) IS '파트너의 항목별 점수(0~100). **클라이언트가 보내지 않습니다** — 리드 배정이 이 점수로 정해지므로 조작되면 돈이 걸립니다.';

COMMENT ON FUNCTION public.fn_may_hold_funds(p_gwan text) IS '대금을 받아도 되는 관인가. **직판 관만 true** — 중개 관에서 대금이 들어오면 자금 수탁이고 전자금융거래법 위반입니다.';

COMMENT ON FUNCTION public.fn_next_ad_invoice_no() IS '청구번호. 앱이 만들면 동시에 발행할 때 겹칩니다.';

COMMENT ON FUNCTION public.fn_payout_add(p_account uuid, p_bank_code text, p_bank_name text, p_account_no text, p_holder text, p_code text, p_stub boolean) IS '정산 계좌 등록. **평문은 인자로만 지나가고 어디에도 남지 않습니다** — 컬럼을 두면 비워 두어도 백업에 남습니다.';

COMMENT ON FUNCTION public.fn_payout_reveal(p_id uuid, p_reason text) IS '지급할 때 계좌를 꺼냅니다. **사유가 없으면 막고, 꺼낸 기록이 남습니다** — 인증되지 않은 계좌는 꺼낼 수 없습니다.';

COMMENT ON FUNCTION public.fn_redact_audit() IS '감사 로그는 "누가 무엇을 했는가"를 남기는 것이지 그 값을 보관하는 것이 아닙니다.';

COMMENT ON FUNCTION public.fn_refund_eligible(p_sub uuid) IS '구독 환불 가능 판정. **당일 + 미열람**만 가능합니다 — 판정을 한 곳에 두어 화면·API·배치가 갈리지 않게 합니다.';

COMMENT ON FUNCTION public.fn_search_head(p_kw text) IS '검색어의 첫 낱말. **인덱스가 후보를 좁히는 데** 씁니다 — 나머지 낱말은 fn_search_match 가 봅니다.';

COMMENT ON FUNCTION public.fn_search_match(p_title text, p_body text, p_kw text) IS '한글 부분 일치 검색. **pg_trgm 은 로케일이 C 이면 한글을 쪼개지 못해 0건이 나옵니다** — 실제로 785건이 있는데 0건이 나왔습니다.';

COMMENT ON FUNCTION public.fn_trust_score(p_account uuid) IS '소개 신뢰도 0~99. 자금 보증이 아니라 **행동 기록**입니다 — INV-11 로 자금 배지를 달 수 없는 자리를 이것으로 채웁니다.';

COMMENT ON TABLE audit.pii_access_logs IS '개인정보 조회 이력. 리드(4관)와 회원(3관) 모두 여기 남깁니다.
   조회한 사실 자체가 기록돼야 오남용을 확인할 수 있습니다.';

COMMENT ON COLUMN public.account_roles.role IS '역할 7종. **PAYOUT 은 지급 전담**이라 ADMIN 과 함께 가질 수 없습니다 — 승인하는 사람과 돈을 보내는 사람을 나눕니다.';

COMMENT ON COLUMN public.accounts.account_type IS 'PERSONAL 개인회원 · SOLE 개인사업자 · CORP 법인사업자. (INDIVIDUAL·BUSINESS 는 이전 값 — 마이그레이션 후 남은 것)';

COMMENT ON COLUMN public.accounts.retention_until IS '탈퇴 후 보관 만료일. 거래·정산 기록이 있으면 상법·전자상거래법상 5년 보관이
   필요하므로 즉시 파기하지 않습니다. 만료 후 pii_purge 잡이 비웁니다.';

COMMENT ON COLUMN public.ad_bookings.is_precontract IS '선계약 광고주. 3주 대기 없이 즉시 적용합니다 — 이미 계약이 있는 곳을 기다리게 하면 계약 위반입니다.';

COMMENT ON TABLE public.ad_invoices IS '광고 청구. **광고비는 우리가 받는 돈**입니다 — 소개비(당사자끼리 주고받음)와 섞지 않습니다.';

COMMENT ON COLUMN public.ad_invoices.pay_method IS 'TRANSFER = 계좌이체(수금 계좌로) · CARD = 카드 · OFFSET = 상계';

COMMENT ON TABLE public.ad_payments IS '광고비 입금 기록. **고치거나 지울 수 없습니다** — 돈이 들어온 기록이라 나중에 따질 때 근거가 됩니다.';

COMMENT ON COLUMN public.ad_placements.impressions IS '화면 표시용 누적치. 과금 근거는 ad_events 입니다 — 이 값을 청구에 쓰지 마십시오.';

COMMENT ON COLUMN public.ad_placements.attribution_enabled IS '이 광고를 눌러 생긴 소개를 광고주에게 귀속할지. **기본은 끔** — 켜는 것이 예외여야 합니다. 켜도 이 광고 건에만 적용됩니다.';

COMMENT ON TABLE public.ad_products IS '광고 정가표. **첫 3주는 도입가**로 팔고 노출 실적을 공개한 뒤 재산정합니다. 지금 숫자는 예상 노출이지 실측이 아닙니다.';

COMMENT ON COLUMN public.ad_products.is_intro_price IS 'true 면 도입가입니다. 3주 실적 공개 후 실측으로 재산정하고 false 로 바꾸십시오.';

COMMENT ON COLUMN public.ad_slots.in_ranking IS 'CHECK 로 false 에 고정합니다. 광고가 추천 순위에 섞이면 표시광고법 문제가 됩니다.';

COMMENT ON TABLE public.advertisers IS '광고주. **회원 계정과 별개입니다** — 대행사가 여러 광고주를 대신 집행하는 경우가 있어, 계정 하나에 광고주 여럿이 붙을 수 있습니다.';

COMMENT ON COLUMN public.advertisers.account_id IS '연결된 회원 계정. 비어 있어도 됩니다 — 운영이 대신 등록한 광고주입니다.';

COMMENT ON TABLE public.ai_decisions IS 'AI 판정 이력. **성향을 해지해도 이 기록은 지우지 않습니다** — "그때 왜 그렇게 나왔나" 를 답할 수 있어야 합니다. 계정을 지우면 account_id 만 비웁니다(기록 자체는 남습니다).';

COMMENT ON COLUMN public.ai_decisions.input_hash IS '입력 원문이 아니라 해시입니다 — 원문을 남기면 개인정보가 쌓입니다.';

COMMENT ON COLUMN public.ai_decisions.rule_version IS '판정에 쓰인 규칙 판본. 어휘집이 바뀌면 같은 글도 다르게 분류됩니다.';

COMMENT ON TABLE public.attribution_events IS 'INV-2. 분쟁 시 유일한 증거. 운영자도 수정 불가여야 증거력이 있다.';

COMMENT ON COLUMN public.attribution_events.source IS 'INTRO = 사람이 소개한 것. AD = 광고 클릭으로 들어온 것. 둘을 섞으면 누구 소개인지 답할 수 없습니다.';

COMMENT ON COLUMN public.attribution_events.ad_creative_code IS '광고 유입일 때 어느 소재였는가. **이 소재의 광고주에게만** 귀속됩니다.';

COMMENT ON TABLE public.audit_thresholds IS '이상 판정 기준. **코드를 고치지 않고 운영이 조절합니다** — 오픈 직후엔 낮게 잡고, 익숙해지면 올리십시오.';

COMMENT ON COLUMN public.billing_keys.billing_key IS '토스 발급 토큰. 카드번호가 아닙니다. 로그·응답에 실어 보내지 마십시오.';

COMMENT ON COLUMN public.businesses.address IS '옛 자유 입력 주소. 신규 등록은 구조화 컬럼을 씁니다.';

COMMENT ON COLUMN public.businesses.nts_detail IS '국세청 조회 사유 문구. UNKNOWN 의 원인(미등록·장애·연동오류)을 구분하는 근거.';

COMMENT ON COLUMN public.businesses.address_detail IS '동·호수 등. 그 자체로 특정 개인을 가리킬 수 있어 매칭·통계에 쓰지 않습니다.';

COMMENT ON COLUMN public.businesses.corp_reg_no IS '법인등록번호. 법인(CORP)만 갖습니다 — 개인사업자는 NULL 입니다.';

COMMENT ON COLUMN public.categories.lead_fee IS '리드 열람 시 내는 정보 이용료. 소개비가 아닙니다(성사와 무관).
★ 3,000원은 도입가입니다 — 손익분기 2,209원을 넘되 시장가보다 낮게 잡았습니다.
  3주 실측(열람률·결제율) 후 재산정하십시오. 실측 확인비용은 800원대였습니다.';

COMMENT ON COLUMN public.categories.lead_fee_provisional IS 'true 면 단가가 아직 가정치입니다. C3 회신 후 실측으로 확정하면 false 로 바꾸십시오.';

COMMENT ON COLUMN public.categories.lead_grade IS '리드 등급. 파트너 입력이 아니라 **도달결과 코드로 사후 재판정**합니다 — 파트너가 정하면 등급 조작 유인이 생깁니다.';

COMMENT ON COLUMN public.classify_categories.category_id IS '분류 결과가 가리키는 실제 업종. **비어 있으면 분류해도 어느 업종을 고르라는 것인지 화면이 알 수 없습니다.**';

COMMENT ON TABLE public.code_labels IS 'ui_tone 은 색을 직접 지정하지 않습니다. 디자인 토큰 이름만 두어
   팔레트가 바뀌어도 데이터를 고치지 않습니다.';

COMMENT ON TABLE public.collect_fetches IS '수집 실행 기록. **이 id 가 없으면 데이터가 못 들어옵니다**(INV-C6) — 어느 실행에서 온 값인지 모르면 나중에 되돌릴 수 없습니다.';

COMMENT ON TABLE public.collect_items IS '수집한 품목. **사진 · 리뷰 본문 · HTML 원문은 담지 않습니다**(INV-C3) — 담을 컬럼 자체를 두지 않았습니다. 담으면 저작권 문제가 되고 지우기도 어렵습니다.';

COMMENT ON COLUMN public.collect_items.raw_material IS '원재료명 원문(RAWMTRL_NM). 성분을 뽑기 위한 것이며, **제품 설명이나 광고 문구는 담지 않습니다.**';

COMMENT ON TABLE public.collect_sources IS '수집 대상. **게이트를 모두 통과해야 READY 가 됩니다** — robots 확인 · 법무 회신 둘 다 필요합니다.';

COMMENT ON COLUMN public.collect_sources.kind IS 'PUBLIC_API = 공공 API · OPEN_DATA = 공공데이터 · PARTNER_FEED = 제휴 피드. **일반 웹사이트 크롤링은 넣지 않습니다** — 그건 다른 판단이 필요합니다.';

COMMENT ON COLUMN public.collect_sources.interval_ms IS '요청 간격. **1초 미만으로 둘 수 없습니다**(INV-C4) — 빠르게 두드리면 상대 서버에 부담을 주고 업무방해가 됩니다.';

COMMENT ON TABLE public.company_account_changes IS '수금 계좌 변경 이력. **돈이 어디로 가는지가 바뀌는 일**이라 누가 언제 바꿨는지 남깁니다. 고치거나 지울 수 없습니다.';

COMMENT ON TABLE public.contract_templates IS '표준계약서 양식. **자유 양식을 쓰면 분쟁 때 판단 근거가 없습니다** — 소개비 귀속 · 성사 시점 · 해지 조건이 계약마다 달라집니다.';

COMMENT ON COLUMN public.contract_templates.invariants IS '이 양식이 지키는 불변식. 본문을 고치실 때 **여기 적힌 것이 여전히 맞는지** 보십시오 — 약관과 코드가 갈리면 어느 쪽이 맞는지 모릅니다.';

COMMENT ON COLUMN public.deal_contracts.esign_stub IS '연동 전 스텁으로 서명된 계약. **오픈 전에 0이어야 합니다** — 실제로 서명되지 않은 계약입니다.';

COMMENT ON TABLE public.deal_payment_records IS 'INV-11. 결제 금액·계좌 컬럼 없음. 플랫폼은 당사자 결제를 기록만 한다.';

COMMENT ON TABLE public.event_joins IS '이벤트 참여 기록. **한 사람이 한 번만** 참여합니다. 지급은 운영이 확인 후 처리하며, 그 사실을 granted_at 에 남깁니다.';

COMMENT ON COLUMN public.event_joins.granted_at IS '혜택을 실제로 준 시각. 비어 있으면 아직 안 준 것입니다 — **참여와 지급은 별개입니다.**';

COMMENT ON TABLE public.events IS '이벤트. 공지와 달리 **기간이 끝나면 저절로 내려갑니다** — 끝난 이벤트가 걸려 있으면 서비스가 관리되지 않는 것으로 보입니다.';

COMMENT ON COLUMN public.events.benefit IS '무엇을 주는지. **말로 적습니다** — 자동 지급하지 않습니다. 코드가 자동으로 주면 잘못 준 것을 되돌릴 수 없습니다.';

COMMENT ON COLUMN public.events.join_type IS 'NONE = 볼 것만 · CLICK = 누르면 참여 · APPLY = 신청서 제출';

COMMENT ON COLUMN public.events.max_joins IS '선착순 인원. 넘으면 더 받지 않습니다 — **줄 수 있는 만큼만 받아야** 나중에 못 준다는 말을 안 하게 됩니다.';

COMMENT ON TABLE public.fee_guarantees IS 'INV-11. 플랫폼은 예치금을 받지 않습니다. 제3자 예치·지급보증의 확인 기록만 둡니다. 잔액 컬럼이 없는 것이 설계입니다.';

COMMENT ON TABLE public.fee_guidelines IS 'A-12: 플랫폼은 소개비를 계산하지 않는다. 등록 폼의 참고값 표시 전용.';

COMMENT ON TABLE public.gwan_form_copy IS '관마다 등록 폼이 다릅니다. 새 관을 만들면 여기 문구도 넣어야 합니다.';

COMMENT ON COLUMN public.gwans.name IS '화면에 보이는 관 이름. **코드(code)와 다릅니다** — 이름은 바꿔도 코드는 그대로여야 링크가 살아 있습니다.';

COMMENT ON COLUMN public.gwans.sort_order IS '메뉴·목록 노출 순서. 작을수록 앞입니다. 운영 화면에서 바꿉니다 — 배포가 필요 없습니다.';

COMMENT ON COLUMN public.gwans.is_hub IS '상위(허브) 관. 자체 등록을 받지 않고 하위 관으로 보냅니다 — 업종이 없어도 정상입니다.';

COMMENT ON COLUMN public.gwans.sale_mode IS 'BROKER = 통신판매중개업자(거래 당사자 아님) · DIRECT = 통신판매업자(우리가 파는 당사자).';

COMMENT ON TABLE public.hlt_cart_items IS '장바구니. **재고를 잡지 않습니다** — 담아 놓고 안 사는 사람 때문에 실제 살 사람이 못 사면 안 되기 때문입니다. 주문할 때 다시 확인합니다.';

COMMENT ON COLUMN public.hlt_cart_items.qty IS '수량. **99개까지**입니다 — 그 이상은 도매라 따로 문의받는 편이 낫습니다.';

COMMENT ON TABLE public.hlt_commission_changes IS '수수료율 변경 이력. **돈이 얼마나 빠지는지가 바뀌는 일**이라 누가 언제 왜 바꿨는지 남습니다. 고치거나 지울 수 없습니다.';

COMMENT ON TABLE public.hlt_commission_rates IS '카테고리별 기본 판매수수료율. **소개뱅크가 정합니다** — 판매자별 예외는 hlt_sellers.commission_rate 에 둡니다.';

COMMENT ON COLUMN public.hlt_commission_rates.referral_pct IS '수수료 중 소개자 몫. **수수료를 넘을 수 없습니다** — 넘으면 우리가 밑지고 소개자에게 줍니다. 소개 연동 전에는 0.';

COMMENT ON COLUMN public.hlt_order_items.withdrawal_code IS '주문 시점의 청약철회 규칙. **상품 규칙이 바뀌어도 이미 산 사람에게는 살 때 규칙**이 적용됩니다.';

COMMENT ON COLUMN public.hlt_order_items.commission_rate IS '주문 당시 수수료율. **요율이 나중에 바뀌어도 이 주문은 그대로**입니다.';

COMMENT ON COLUMN public.hlt_order_items.commission_amount IS '계산된 수수료. 요율만 두고 매번 계산하면 지난 정산이 달라집니다.';

COMMENT ON TABLE public.hlt_orders IS '건강몰 주문. **우리가 파는 당사자**입니다 — 하자·배송·반품 책임이 우리에게 있습니다.';

COMMENT ON TABLE public.hlt_payments IS '결제 기록. **카드번호는 남지 않습니다** — PG 가 처리하고 우리는 거래번호(pg_tid)만 받습니다.';

COMMENT ON TABLE public.hlt_products IS '건강몰 판매 상품. **소개 등록(listings)과 다릅니다** — 우리가 직접 파는 물건입니다.';

COMMENT ON COLUMN public.hlt_products.withdrawal_code IS '청약철회 규칙. 식품은 개봉하면 반품 불가라 **상품마다 정해 둡니다** — 주문 화면에서 미리 알려야 나중에 다투지 않습니다.';

COMMENT ON TABLE public.hlt_returns IS '취소 · 반품. **7일 안이면 이유를 묻지 않습니다**(전자상거래법 17조) — 다만 식품은 개봉하면 반품 불가이고, 그 판정을 우리가 합니다.';

COMMENT ON TABLE public.hlt_seller_licenses IS '판매자 자격. **만료되면 노출이 즉시 멈춥니다**(INV-H10) — 다만 이미 받은 주문은 이행합니다. 진행 중인 거래를 끊으면 이용자가 피해를 봅니다.';

COMMENT ON TABLE public.hlt_sellers IS '건강몰 판매자. DIRECT = 우리가 직접 팜 · BRAND/TENANT = 입점. **입점 판매자는 대금을 직접 받습니다**(하위가맹점) — 우리를 거치면 자금 수탁이 되어 전자금융거래법 등록 대상입니다.';

COMMENT ON COLUMN public.hlt_sellers.submerchant_id IS 'PG 하위가맹점 ID. **계약 전에는 비어 있습니다** — 비면 정산이 집계만 되고 지급되지 않습니다(v_hlt_settle_blocked 가 잡습니다).';

COMMENT ON COLUMN public.hlt_sellers.commission_rate IS '이 판매자만 적용할 요율. 비우면 카테고리 기본값. **50% 를 넘길 수 없습니다** — 넘으면 판매자가 밑지는 장사가 됩니다.';

COMMENT ON TABLE public.hlt_settlement_items IS '정산 내역 — 주문별. **한 주문이 매출과 환불로 두 줄**이 될 수 있습니다.';

COMMENT ON TABLE public.hlt_settlements IS '주별 정산. **확정분(배송완료 + 7일)만 집계합니다** — 배송 완료로 집계하면 반품될 때마다 되돌려야 합니다.';

COMMENT ON COLUMN public.hlt_settlements.carried_in IS '지난 주에서 넘어온 이월액. 음수면 판매자가 우리에게 빚진 것입니다.';

COMMENT ON COLUMN public.hlt_settlements.carried_out IS '다음 주로 넘길 이월액. **제한이 없습니다**(사장님 결정) — 다만 v_hlt_carryover_large 가 큰 이월을 보여 줍니다.';

COMMENT ON COLUMN public.hlt_settlements.status IS '정산 상태. **DRAFT → CONFIRMED → PAID** 순서입니다 — 확인을 건너뛰고 지급하면 틀린 금액을 보낸 뒤에 알게 됩니다. 음수는 CARRIED 로 다음 주에 넘깁니다.';

COMMENT ON TABLE public.hlt_shipments IS '배송 기록. 한 주문에 여러 줄이 쌓입니다 — **언제 무엇이 있었는지**를 남겨야 "안 왔다" 는 문의에 답할 수 있습니다.';

COMMENT ON TABLE public.idempotency_records IS '48시간 보존 권장. PG 웹훅 재전송 창보다 길어야 한다.';

COMMENT ON TABLE public.ingredients IS '우리 성분 마스터. 수집한 원재료명을 여기에 맞춰 봅니다.';

COMMENT ON COLUMN public.ingredients.is_excipient IS '부형제(제조에 쓰이나 효능과 무관). **정제수 · 스테아린산마그네슘 같은 것** — 목록에서 빼야 이용자가 헷갈리지 않습니다.';

COMMENT ON TABLE public.integrations IS '시크릿 값은 저장하지 않습니다. Secrets Manager 키 이름과 등록 여부만 기록합니다.';

COMMENT ON COLUMN public.integrations.egress_ip IS 'NAT Gateway EIP. 6종 중 5종이 화이트리스트를 요구하고 심사에 2~4주 걸립니다.';

COMMENT ON COLUMN public.introducer_profiles.is_founding IS '창립 소개자 100명. 인증배지·우선노출의 근거입니다.';

COMMENT ON TABLE public.introducer_referrals IS '초대 관계. invitee 가 UNIQUE 이므로 한 사람은 한 번만 초대받습니다. 하위의 하위를 표현할 열이 없습니다 — 다단계가 구조적으로 불가능합니다.';

COMMENT ON TABLE public.introduction_invites IS '소개 초대. 연락처가 아니라 링크를 보냅니다. 상대가 동의해야 연결이 열립니다.';

COMMENT ON COLUMN public.invite_deliveries.contact_enc IS '발송용 연락처 암호문. 발송 직후 NULL 로 지웁니다 — 동의하지 않은 사람의 연락처를 보관하지 않습니다.';

COMMENT ON COLUMN public.lead_deliveries.viewed_at IS '열람 시점 = 과금 시점. 성사 여부와 무관합니다 — 정보 이용료이기 때문입니다.';

COMMENT ON TABLE public.lead_fees IS '정보 이용료 원장. 열람 시점에 발생하고 성사와 무관합니다. 선불 잔액이 아니라 후불 청구 대상입니다 — 플랫폼이 자금을 보관하지 않습니다(INV-11).';

COMMENT ON COLUMN public.lead_grade_rates.gwan_code IS 'NULL 이면 전 관 공통, 관 코드면 그 관 전용입니다. 관 전용이 있으면 공통보다 우선합니다.';

COMMENT ON COLUMN public.lead_grade_rates.rank IS '등급 서열. S=1 이 가장 높습니다. **알파벳 순으로 정렬하면 S 가 맨 뒤로 가서** 단조감소 판정이 뒤집힙니다.';

COMMENT ON TABLE public.listing_checklist IS '자동 노출 조건. 여기를 통과하면 사람 심사 없이 바로 보입니다. 항목을 늘리면 자동 통과가 줄고, 줄이면 사후에 잡을 일이 늘어납니다.';

COMMENT ON COLUMN public.listing_checklist.gwan_code IS 'NULL 이면 전 관 공통. 소개창업은 권리금·인허가를, 건강상품은 인증번호를 봐야 해서 관 전용 항목이 필요합니다.';

COMMENT ON COLUMN public.listings.review_no IS '광고 사전심의 번호. **의료기기는 이것이 없으면 등록되지 않습니다** (의료기기법 24조). 예) 심의필 제2026-0451호';

COMMENT ON TABLE public.member_ad_profiles IS '광고 소재 선택과 추천 정렬에만 씁니다. 광고주에게 제공하지 않습니다.';

COMMENT ON COLUMN public.member_ad_profiles.registered_at IS '최초 등록 시각. **재진단해도 바뀌지 않습니다** — 언제부터 이 사람의 성향을 쓰기 시작했는지가 동의 시점의 근거입니다.';

COMMENT ON COLUMN public.member_ad_profiles.source IS 'MEMBER = 로그인 상태에서 직접 / GUEST_MERGED = 비회원 답변이 로그인 시 이어붙은 것. 나중에 "동의한 적 없다" 는 말이 나오면 이 값이 답이 됩니다.';

COMMENT ON TABLE public.payout_accounts IS '정산 계좌. **평문 계좌번호 컬럼이 없습니다** — 넣을 때는 fn_payout_add() 로, 꺼낼 때는 fn_payout_reveal() 로만 다룹니다.';

COMMENT ON COLUMN public.payout_accounts.verify_tries IS '코드 시도 횟수. 5회를 넘으면 막습니다 — 찍어서 맞히는 것을 막습니다.';

COMMENT ON COLUMN public.payout_accounts.is_stub IS '연동 전 스텁으로 통과한 계좌. **오픈 전에 0이어야 합니다** — 실제로 확인되지 않은 계좌입니다.';

COMMENT ON COLUMN public.payout_accounts.account_enc IS '계좌번호(암호화). **평문으로 두면 DB 가 새는 순간 그대로 털립니다.**';

COMMENT ON COLUMN public.payout_accounts.account_last4 IS '계좌번호 뒤 4자리. 화면 표시용 — 이것만으로는 계좌를 특정할 수 없습니다.';

COMMENT ON TABLE public.recommend_weights IS '협업 필터링이 아닙니다. 성사 데이터 전까지는 이 표를 정하는 사람이 곧 알고리즘입니다.';

COMMENT ON COLUMN public.report_reasons.auto_queue_at IS '이 건수를 넘으면 검수 큐에 올립니다. **자동으로 내리지 않습니다** — 경쟁사 여럿이 짜고 내릴 수 있기 때문입니다.';

COMMENT ON COLUMN public.report_reasons.gwan_code IS 'NULL 이면 전 관 공통. 관마다 문제되는 것이 다릅니다 — 건강상품은 효능 과장이, 소개몰은 허위 매물이 더 중합니다.';

COMMENT ON TABLE public.restrict_vocab IS '제한업종을 실제로 부르는 말. 올리는 사람은 "의료 서비스" 가 아니라 "성형외과" 라고 씁니다 — 이름만으로는 대부분 통과합니다.';

COMMENT ON TABLE public.restricted_industries IS '관별 제한업종. BLOCK = 등록 불가 · AD_ONLY = 광고만 · GATED = 자격을 확인하면 가능 · ALLOW = 제한 없음. **건강몰 의료기기는 GATED** — 심의필 번호가 있으면 판매·광고 모두 됩니다.';

COMMENT ON COLUMN public.restricted_industries.mode IS 'BLOCK 전면 차단 · GATED 자격 확인 후 · ALLOW 허용 · AD_ONLY 광고만 가능(소개·알선 불가)';

COMMENT ON TABLE public.review_reason_codes IS '반려 사유를 자유서술로 두면 재제출률·사유 분포를 볼 수 없다. 검수가 병목이므로 코드값 필수.';

COMMENT ON COLUMN public.risk_rules.source IS '규칙 원문. 화면에 그대로 노출합니다 — 규칙에 없는 수법은 못 잡으므로 숨기지 않습니다.';

COMMENT ON COLUMN public.risk_rules.false_positive IS '오탐 가능성. 경보와 함께 보여 줍니다. 운영이 기계를 맹신하지 않게 하는 장치입니다.';

COMMENT ON COLUMN public.risk_rules.detect_sql IS '탐지 질의. subject · detail 두 열을 내야 합니다. 읽기 전용이며 배치가 그대로 실행합니다.';

COMMENT ON TABLE public.settlements IS 'INV-9: 공제·수수료 컬럼 없음. amount 는 deals.agreed_fee 와 항상 일치해야 한다.';

COMMENT ON COLUMN public.subscription_plans.extra_code_price IS '정액. 거래금액 연동 금지 — 연동하는 순간 소개비 공제 구조가 되어 INV-9 위반';

COMMENT ON COLUMN public.subscription_plans.exposure_weight IS '검색 정렬 가중치. 기본 정렬에는 적용하지 않고 별도 우선노출 영역에만 사용.
   INV-11(특정 매물 추천 없음) 및 전자상거래법 노출순위 대가 표시 의무 때문.';

COMMENT ON COLUMN public.subscription_plans.success_fee IS '거래 성사 1건당 플랫폼이 회원에게 청구하는 정액 수수료. 요율이 아님(거래 금액 미보유).';

COMMENT ON COLUMN public.subscriptions.refunded_at IS '환불 시각. **결제 당일에만** 환불할 수 있습니다 — 하루만 써도 남의 연락처를 다 보고 환불받는 일을 막습니다.';

COMMENT ON TABLE public.success_fees IS '회원 → 플랫폼 성사 수수료. 소개비(settlements)와 별개이며 공제 관계가 아니다.';

COMMENT ON TABLE public.terms IS '약관. **MARKETING 은 선택 동의**지만, 없으면 광고성 정보를 보낼 수 없습니다 — 동의 없이 보내면 정보통신망법 50조 위반입니다.';

COMMENT ON COLUMN public.terms.gwan_code IS 'NULL 이면 전 관 공통. 관별 특약이 필요할 때만 관 코드를 넣습니다 — 지금 발행된 4종은 전부 공통입니다.';

COMMENT ON TABLE public.trust_weights IS '신뢰도 가중치. 운영이 화면에서 바꿉니다 — 배포가 필요 없습니다. BASE 를 낮추면 신규가 불리해져 첫 거래가 줄어듭니다.';

COMMENT ON TABLE public.ui_messages IS '법적 근거가 있는 화면 문구. 임의로 지우면 표시 의무 위반이 될 수 있어 basis 를 함께 둡니다.';

COMMENT ON VIEW public.v_ad_attr_orphan IS '광고주가 안 적힌 광고 귀속. 0이어야 정상 — 누구에게 귀속되는지 모르는 건은 결국 분쟁이 됩니다.';

COMMENT ON VIEW public.v_ad_attribution_on IS '귀속이 켜진 광고. 켜면 그 광고로 들어온 소개가 광고주에게 갑니다 — 무엇이 켜져 있는지 모르면 소개자들이 이유 없이 손해를 봅니다.';

COMMENT ON VIEW public.v_ad_auction_ready IS 'T1 전환 조건. 각 달이 모두 3곳 이상이어야 하며, 서로 다른 광고주로 셉니다 — 행 수로 세면 한 광고주의 반복 신청으로 조작됩니다.';

COMMENT ON VIEW public.v_ad_capacity IS '슬롯별 노출 여력의 성격. **노출 수만으로 값을 매기면 상세 하단이 싸게 팔립니다** — 거기는 노출이 적은 대신 클릭률이 배로 높습니다.';

COMMENT ON VIEW public.v_ad_demo IS '데모 소재. 실계약이 들어오면 지우십시오 — 섞이면 실적을 잘못 읽습니다.';

COMMENT ON VIEW public.v_ad_expiring IS '7일 안에 만료되는 소재. 당일에 알면 이미 빈 자리가 된 뒤입니다 — 미리 갈아 끼우거나 연장하십시오.';

COMMENT ON VIEW public.v_ad_inventory IS '슬롯별 재고와 현재 예약. 선계약을 받기 전에 **팔 수 있는 양**을 먼저 보십시오 — 예상 노출로 팔았다가 못 채우면 환불 문제가 됩니다.';

COMMENT ON VIEW public.v_ad_no_product IS '열려 있는데 팔 상품이 없는 슬롯. 자사 소재만 도는 자리입니다 — 재고가 있어도 팔 수 없습니다.';

COMMENT ON VIEW public.v_ad_no_slot IS '슬롯 없이 켜진 소재. 노출 기록에 자리를 적을 수 없어 **과금 근거가 비어 버립니다.**';

COMMENT ON VIEW public.v_ad_overdue_running IS '연체인데 아직 나가고 있는 광고. **0이어야 합니다** — 받지 못한 채 노출만 계속하면 손해가 커집니다.';

COMMENT ON VIEW public.v_ad_platform IS '광고 플랫폼 한 줄 보기. 자리·상품·소재·예약·실적을 함께 봅니다 — 여섯 표를 따로 보게 두면 실제로는 아무도 안 봅니다. demo_creatives 가 0 이 아니면 실적에 데모가 섞여 있습니다.';

COMMENT ON VIEW public.v_ad_receivables IS '광고 미수금. **연체가 쌓이면 광고를 멈추십시오** — 받지 못한 채 노출만 계속하면 손해가 커집니다.';

COMMENT ON VIEW public.v_ad_sellable_gap IS '팔았거나 팔 수 있는데 나갈 소재가 없는 자리. 0이어야 정상 — 예상 노출로 팔았다가 못 채우면 환불 문제가 됩니다.';

COMMENT ON VIEW public.v_ad_settlement_hold IS '이행 비율 50% 미만 — 정산 보류 대상. 정액 계약이라 청구액은 고정이고, 비율은 서비스 이행 여부 확인에만 씁니다.';

COMMENT ON VIEW public.v_ad_slot_conflict IS '전면과 띄움이 같은 기간에 잡힌 건. 0이어야 정상 — 둘 다 뜨면 이용자가 화면을 보지 못합니다.';

COMMENT ON VIEW public.v_ad_slot_empty IS '열려 있는데 소재가 없는 슬롯. 기간이 비어 있으면 상시 노출로 봅니다 — NULL 을 만료로 읽으면 나가는 광고를 없다고 보고합니다.';

COMMENT ON VIEW public.v_ad_stats_for_advertiser IS '광고주 제공용. 회원 식별자·세그먼트가 없습니다 — 누가 봤는지 알리지 않습니다.';

COMMENT ON VIEW public.v_ai_client_scored IS '서버 점수로는 후보에 들지 않는데 배정된 건. 0이어야 정상 — 점수가 조작됐거나 자격이 사라진 뒤 배정된 것입니다.';

COMMENT ON VIEW public.v_assumed_on IS '켜져 있는 간주 모드. **오픈 전 반드시 0** — 결제 · 중개사 · 계좌가 모두 실제로 연결돼야 합니다.';

COMMENT ON VIEW public.v_audit_admin_night IS '밤중 운영 행위. **계정이 털렸을 수 있습니다** — 본인에게 직접 확인하십시오.';

COMMENT ON VIEW public.v_audit_night_access IS '밤에 개인정보를 본 사람(22시~7시). 급한 일일 수 있지만 **이유가 남아야** 합니다 — reason 이 비어 있으면 특히 확인하십시오.';

COMMENT ON VIEW public.v_audit_pii_burst IS '하루에 개인정보를 많이 본 사람. **업무일 수도 있습니다** — 숫자만 보고 판단하지 말고 무엇을 봤는지 확인하십시오.';

COMMENT ON VIEW public.v_audit_same_target IS '한 사람을 반복해서 본 경우. **가장 흔한 유출 형태입니다** — 업무라면 한 번 보고 끝납니다. 검정이 남긴 기록은 뺍니다.';

COMMENT ON VIEW public.v_audit_anomalies IS '감사 이상 징후 모음. **0이 정상이지만, 0이 아니라고 곧바로 유출은 아닙니다** — 무엇을 봤는지 확인한 뒤 판단하십시오.';

COMMENT ON VIEW public.v_audit_no_reason IS '이유 없이 개인정보를 본 기록. **나중에 따질 때 이유가 없으면 설명할 수 없습니다.**';

COMMENT ON VIEW public.v_auto_approved_reported IS '자동 통과 후 신고된 건. 여기 쌓이면 **체크리스트에 항목을 추가**하십시오 — 사람 심사를 늘리는 것이 아니라 조건을 정교하게 만드는 것이 맞습니다.';

COMMENT ON VIEW public.v_b12_rollback_scope IS 'B-12 회신이 부정일 때 파기해야 할 범위. 미리 세어 두면 그때 판단이 빠릅니다.';

COMMENT ON VIEW public.v_bank_assumed IS '간주 계좌로 돌고 있는 상태. **오픈 전에 0이어야 합니다** — 가상 계좌로 열면 입금이 아무 데도 들어오지 않습니다.';

COMMENT ON VIEW public.v_billing_due IS '자동 청구 대상. 해지·무료·프로모션·중복·일일 재시도 한도가 여기서 걸러집니다.';

COMMENT ON VIEW public.v_billing_key_exposure IS '뷰가 빌링키 값을 그대로 내보내는지 봅니다. billing_key_id(참조)는 대상이 아닙니다.';

COMMENT ON VIEW public.v_billing_notice_missing IS '청구 실패했는데 안내가 나가지 않은 구독. 비어 있지 않으면 이용자가 모른 채 만료로 갑니다.';

COMMENT ON VIEW public.v_billing_policy IS '저장된 값과 실제 동작에 쓰이는 값을 나란히 봅니다. 둘이 다르면 설정이 먹지 않은 것입니다.';

COMMENT ON VIEW public.v_broker_commission_leak IS '소개형 4관에 스며든 수수료 컬럼. **0이어야 합니다** — 건강몰은 직판이라 예외이고, 나머지 관은 우리 몫이 0원입니다.';

COMMENT ON VIEW public.v_broker_gate_leak IS '중개사 인증도 등기부 확인도 없이 올라간 부동산. **관을 열기 전에 반드시 0** 이어야 합니다 — 무등록 중개가 됩니다.';

COMMENT ON VIEW public.v_partner_eligible IS '리드를 받을 수 있는 파트너. 승인된 서비스와 활동 지역이 있어야 하고, 미납이 한도 안이어야 합니다.';

COMMENT ON VIEW public.v_card_columns IS '카드 정보 컬럼. **0이어야 합니다** — 직판이어도 카드번호는 PG 가 가지고 우리는 거래번호만 받습니다.';

COMMENT ON VIEW public.v_classify_corrections IS '제안과 선택이 갈린 조합. 같은 조합이 반복되면 그 어휘의 가중치를 손봐야 합니다.';

COMMENT ON VIEW public.v_classify_unlinked IS '실제 업종에 연결되지 않은 분류. **0이어야 정상** — 연결이 없으면 분류 결과를 화면이 쓸 수 없습니다.';

COMMENT ON VIEW public.v_classify_vocab_conflicts IS '여러 분류에 같은 가중치로 들어간 어휘. 동점이면 정렬 순서가 결과를 정합니다 — 가중치를 갈라 주십시오.';

COMMENT ON VIEW public.v_collect_match_rate IS '수집 성과. **안 맞은 성분이 많으면 마스터를 늘리십시오** — 수집을 더 돌려도 그 성분은 계속 안 맞습니다.';

COMMENT ON VIEW public.v_collect_stuck IS '2시간 넘게 안 끝난 수집. **멈춘 것일 수 있습니다** — 그대로 두면 다음 실행이 막힙니다.';

COMMENT ON VIEW public.v_company_account IS '회사 수금 계좌. **missing 이 0이어야 오픈할 수 있습니다** — 비어 있으면 무통장 입금을 받을 수 없습니다.';

COMMENT ON VIEW public.v_contract_conversion IS '계약 발급률이 낮으면 거래가 플랫폼 밖에서 이루어지고 있다는 신호.
   중개 이탈을 관측하는 지표.';

COMMENT ON VIEW public.v_contract_no_template IS '표준 양식이 아닌 계약. **0이어야 합니다** — 자유 양식은 분쟁 때 판단 근거가 없습니다.';

COMMENT ON VIEW public.v_contract_progress IS '진행 중인 계약. stalled 는 3일 넘게 멈춘 건 — 한쪽이 잊은 것인지 이견이 있는 것인지 알림으로 확인해야 합니다.';

COMMENT ON VIEW public.v_contract_stub IS '스텁으로 서명된 계약. **오픈 전 0이어야 합니다** — 법적 효력이 없습니다.';

COMMENT ON VIEW public.v_daily_metrics IS '최근 30일 일자별 지표. 숫자가 0으로 떨어진 날이 있으면 그날 무언가 멈춘 것입니다.';

COMMENT ON VIEW public.v_direct_gwans IS '직판 관. **반품·환불 책임을 집니다** — 늘리실 때는 약관과 법정 고지를 함께.';

COMMENT ON VIEW public.v_direct_notice_missing IS '직판 관인데 고지가 없는 것. **0이어야 합니다** — 직접 파는데 중개라고 적혀 있으면 표시광고법 위반입니다.';

COMMENT ON VIEW public.v_domain_mismatch IS '도메인과 기본 주소가 어긋남. 비어 있어야 정상 — 어긋나면 메일 링크가 다른 곳으로 갑니다.';

COMMENT ON VIEW public.v_duty_conflict IS '승인과 지급을 겸한 사람. **0이어야 합니다** — 부정 판정을 만드는 사람과 돈을 내보내는 사람이 같으면 사고를 되돌릴 근거가 없습니다.';

COMMENT ON VIEW public.v_event_ungranted IS '참여했는데 아직 혜택을 못 받은 사람. **오래 방치되면 다음 이벤트에 아무도 참여하지 않습니다.**';

COMMENT ON VIEW public.v_gated_no_review IS '심의필 번호 없이 올라온 심의 대상. **0이어야 정상** — 심의 없는 의료기기 광고는 의료기기법 24조 위반입니다.';

COMMENT ON VIEW public.v_gated_unchecked IS '심의 번호가 확인되지 않은 채 노출 중인 건. **형식만 맞고 실재하지 않는 번호일 수 있습니다** — 식약처 조회로 확인하십시오.';

COMMENT ON VIEW public.v_gwan_admin IS '관 관리. 순서를 바꾸면 메뉴와 목록이 함께 바뀝니다. is_landing 은 로그인 후 도착할 관입니다.';

COMMENT ON VIEW public.v_gwan_cards IS '메인 카드로 보여 줄 관. on_main 이 false 면 "전체 관" 페이지에서만 보입니다 — 카드가 많으면 오히려 안 읽힙니다.';

COMMENT ON VIEW public.v_gwan_system IS '관별 체계. own_* 는 그 관 전용이고, 0 이면 공통을 씁니다 — 전 관 공통을 복제하지 않는 것이 설계입니다.';

COMMENT ON VIEW public.v_gwan_without_category IS '열려 있는데 승인된 업종이 없는 관. 등록도 안 되고 목록도 비어 이용자에게는 고장 난 서비스로 보입니다.';

COMMENT ON VIEW public.v_high_fee_eligible IS '"높은 소개비" 노출 대상. 운영이 보증을 확인한 건만 들어옵니다.';

COMMENT ON VIEW public.v_hlt_carryover_large IS '이월이 10만원 넘게 쌓인 판매자. **막지는 않습니다**(제한 없음) — 다만 회수 불가능한 금액이 소리 없이 늘어나는 것이 가장 나쁩니다.';

COMMENT ON VIEW public.v_hlt_cart IS '장바구니 합계. **has_problem 이 true 면 주문할 수 없습니다** — 담아 둔 사이 품절됐거나 판매가 멈춘 것입니다.';

COMMENT ON VIEW public.v_hlt_license_expired IS '자격 만료인데 판매 중. **0이어야 합니다** — 만료된 자격으로 팔면 판매자도 우리도 책임을 집니다.';

COMMENT ON VIEW public.v_hlt_paid_no_actor IS '누가 지급했는지 없는 정산. **0이어야 합니다** — 사고가 났을 때 누가 눌렀는지 알 수 없습니다.';

COMMENT ON VIEW public.v_hlt_returns_pending IS '처리 대기 반품. **3영업일 안에 처리해야 합니다** — 늦으면 지연이자를 물 수 있습니다.';

COMMENT ON VIEW public.v_hlt_sale_violation IS '건강몰에 올라온 판매 불가 품목. **건강몰은 파는 곳이라 AD_ONLY 도 안 됩니다**(INV-H3b).';

COMMENT ON VIEW public.v_hlt_seller_no_submerchant IS '하위가맹점 ID 가 없는 입점 판매자. **PG 계약 뒤 채워야 지급됩니다** — 팔 수는 있으나 돈이 안 나갑니다.';

COMMENT ON VIEW public.v_hlt_settle_blocked IS '지급이 막힌 판매자. 집계는 되지만 **돈을 보낼 곳이 없습니다** — PG 계약 뒤 submerchant_id 를 채우면 풀립니다.';

COMMENT ON VIEW public.v_hlt_settle_ready IS '정산 대상. **배송 완료 + 청약철회 7일**이 지나고 반품이 없는 주문입니다.';

COMMENT ON VIEW public.v_hlt_settle_missed IS '확정된 지 2주가 넘도록 정산에 안 들어간 주문. **0이어야 합니다** — 주 단위 정산이면 늦어도 2주 안에는 들어가야 합니다.';

COMMENT ON VIEW public.v_hlt_settlement_ready IS '정산할 주문. **배송 완료 + 청약철회 7일** 이 지난 것만 — 그 전에 집계하면 반품될 때마다 되돌려야 합니다.';

COMMENT ON VIEW public.v_hlt_ship_overdue IS '결제 후 3일 넘게 안 보낸 주문. **약속이 영업일 1~3일**이라 넘으면 알려 드려야 합니다.';

COMMENT ON VIEW public.v_hlt_wrong_gwan IS '건강몰이 아닌 업종의 판매 상품. **0이어야 합니다** — 직판은 건강몰만입니다.';

COMMENT ON VIEW public.v_internal_key_missing IS '내부 API 키가 비어 있는 상태. **오픈 전 0이어야 합니다** — 키가 없으면 내부 API 는 닫히지만, 광고 플랫폼도 함께 멈춥니다.';

COMMENT ON VIEW public.v_intro_money_ledger IS '소개머니 = 확정 소개비 정산원장. 충전·송금 잔액이 아닙니다(INV-11). 지급은 당사자 간 직접 이루어지며 플랫폼은 확정 사실만 기록합니다.';

COMMENT ON VIEW public.v_inv11_violations IS '자금수탁 컬럼. **0이어야 합니다** — 다만 건강몰 결제의 거래번호는 예외입니다(직판). 카드번호 · CVC 는 어느 관에서도 남기지 않습니다.';

COMMENT ON VIEW public.v_inv9_violations IS '공제·수수료 컬럼. **0이어야 합니다** — 다만 건강몰(hlt_·v_hlt_)은 직판이라 판매수수료가 있습니다. 소개형 4관에 스며들면 여전히 잡힙니다.';

COMMENT ON VIEW public.v_job_stale IS '주기의 3배가 지나도록 안 돈 작업. 비어 있어야 정상입니다 — 구독 청구가 여기 뜨면 매출이 멈춘 것이고, pii_purge 가 뜨면 법적 문제입니다.';

COMMENT ON VIEW public.v_lead_economics IS '리드 실측. **손익분기는 실측 열람률로 다시 계산합니다** — 가정 55%가 아니라 실제로 몇 %가 열람했는지가 기준입니다. avg_fee 가 breakeven_fee 아래면 리드관이 자금을 태우고 있습니다.';

COMMENT ON VIEW public.v_lead_fee_void_mismatch IS '무효 시각과 상태가 어긋난 이용료. 0이어야 정상 — "무효인데 PENDING" 같은 행은 집계를 조용히 틀리게 만듭니다.';

COMMENT ON VIEW public.v_lead_fee_void_without_rule IS '규칙 없이 무효 처리된 이용료. 0이어야 정상 — voided_at 과 state 를 모두 봅니다. 하나만 보면 다른 쪽으로 빠져나갑니다.';

COMMENT ON VIEW public.v_listing_search IS '검색용 등록 목록. search_text 에 LIKE 를 걸면 인덱스를 탑니다. LIKE 로 후보를 좁힌 뒤 fn_search_match 가 최종 판정을 합니다 — 순서를 바꾸면 인덱스를 못 탑니다.';

COMMENT ON VIEW public.v_location_columns IS '좌표 컬럼. **0이어야 위치기반서비스가 아닙니다** — 하나라도 생기면 방통위 신고 대상이 될 수 있으니 법무에 확인하십시오.';

COMMENT ON VIEW public.v_location_waiver_broken IS '폐기 판단이 깨진 곳. **0이어야 합니다** — 좌표를 담기 시작하면 위치정보법 대상이 되어 신고와 약관이 다시 필요합니다.';

COMMENT ON VIEW public.v_marketing_consent_stale IS '2년이 넘은 마케팅 동의. 다시 여쭈어야 합니다 — 오래전 동의를 근거로 계속 보내면 안 됩니다.';

COMMENT ON VIEW public.v_marketing_night_violation IS '야간 동의 없이 밤에 보낸 광고. **0이어야 합니다** — 정보통신망법 50조 3항 위반입니다.';

COMMENT ON VIEW public.v_marketing_no_consent IS '동의 없이 나간 광고성 알림. **0이어야 합니다** — 정보통신망법 50조 위반이고 과태료 3천만원 이하입니다.';

COMMENT ON VIEW public.v_marketing_reconfirm_due IS '2년이 지난 마케팅 동의. **다시 여쭙고, 답이 없으면 멈춰야** 합니다 (정보통신망법 시행령 62조의3).';

COMMENT ON VIEW public.v_notify_queue IS '외부 발송 대상. 3일이 지난 것은 보내지 않습니다 — 늦은 안내는 혼란만 줍니다.';

COMMENT ON VIEW public.v_open_blockers IS '값이 있는 것과 값이 맞는 것은 다릅니다. 자리표시자·형식·길이를 함께 봅니다.';

COMMENT ON VIEW public.v_payout_locked IS '다섯 번 틀려 막힌 계좌. 운영이 풀어 주어야 합니다 — 정말 자기 계좌인데 코드를 잘못 본 경우가 있습니다.';

COMMENT ON VIEW public.v_payout_stub IS '스텁으로 통과한 정산 계좌. **오픈 전 0이어야 합니다** — 실제로 확인되지 않은 계좌로 돈이 나갑니다.';

COMMENT ON VIEW public.v_pending_decisions IS '결정 대기 항목. 오픈을 막지는 않지만 **그 위에 무엇을 쌓으면 안 되는지**를 알려 줍니다. HIGH 는 회신 결과에 따라 작업이 통째로 버려질 수 있는 것입니다.';

COMMENT ON VIEW public.v_persona_orphan_history IS '성향을 해지한 사람의 과거 판정 기록. **있는 것이 정상입니다** — 해지해도 "그때 어떤 결과였나" 는 답할 수 있어야 합니다.';

COMMENT ON VIEW public.v_privacy_inventory IS '개인정보처리방침에 적을 내용과 실제 보관 상태가 맞는지 확인합니다.';

COMMENT ON VIEW public.v_ptn_approval_gap IS '승인·반려·무효 처리에서 근거가 빠진 건. 0이어야 정상 — 당한 사람이 따질 때 답할 수 있어야 합니다.';

COMMENT ON VIEW public.v_rate_partial IS '관 전용 단가표가 일부 등급만 가진 건. 0이어야 정상 — 일부만 두면 등급 사이에서 단가가 튑니다.';

COMMENT ON VIEW public.v_refund_scope IS '환불 대상 구분. **소개비는 우리가 받지 않으므로 환불 대상이 아닙니다** — 겸업이라 헷갈리기 쉬운 지점이라 데이터로 남깁니다.';

COMMENT ON VIEW public.v_refund_violation IS '당일이 아니거나 이미 이용한 구독의 환불. 0이어야 정상 — 한 건이라도 있으면 같은 요구가 계속 들어옵니다.';

COMMENT ON VIEW public.v_report_not_escalated IS '신고가 임계치를 넘었는데 검수 큐에 없는 건. 0이어야 정상 — 쌓이면 에스컬레이션 트리거가 조용히 실패하고 있다는 뜻입니다.';

COMMENT ON VIEW public.v_report_stale IS '3일 넘게 방치된 신고. 답이 없으면 이용자는 다시 신고하지 않고 떠납니다 — 자동 노출의 사후 감시가 그 순간 무너집니다.';

COMMENT ON VIEW public.v_restrict_no_vocab IS '어휘가 없는 제한업종. 이름 한 단어로만 걸러 **대부분 그냥 통과합니다.**';

COMMENT ON VIEW public.v_restricted_unlinked IS '업종이 연결되지 않은 제한업종. **0이어야 정상** — 연결이 없으면 트리거가 restricted_code 를 못 찾아 그냥 통과시킵니다.';

COMMENT ON VIEW public.v_restriction_scope IS '제한업종의 적용 범위. (전 관 공통)은 바꾸면 모든 관이 함께 바뀝니다 — 한 관만 바꾸려면 그 관의 행을 따로 만드십시오.';

COMMENT ON VIEW public.v_revenue_leak IS '스위치가 꺼졌는데 청구가 생기면 나타납니다. 비어 있어야 정상입니다.';

COMMENT ON VIEW public.v_review_automation IS '검수 자동화 비율. auto_pct 가 낮으면 체크리스트가 너무 빡빡하거나 법적 게이트에 걸리는 건이 많다는 뜻입니다. sla_over 가 늘면 병목입니다.';

COMMENT ON VIEW public.v_review_no_event IS '결정됐는데 이력이 없는 검수 건. 0이어야 정상 — 쌓이면 "누가 언제 승인했는가"를 답할 수 없습니다.';

COMMENT ON VIEW public.v_risk_effectiveness IS '규칙별 성적. 오탐률이 높으면 운영이 무시하기 시작하고, 그러면 진짜 위반도 함께 지나갑니다.';

COMMENT ON VIEW public.v_scope_map IS '관별 설정과 전 관 공통 설정의 경계. 한 관을 바꿨는데 다른 관이 함께 바뀌는 일을 막으려면 이 구분을 알아야 합니다.';

COMMENT ON VIEW public.v_search_sanity IS '검색이 도는지 확인. **like_hits 와 fn_hits 가 같아야 합니다** — trgm_hits 가 0이어도 정상입니다(한글은 트라이그램이 안 됩니다).';

COMMENT ON VIEW public.v_trust_scores IS '4관(MNY·MAL·BIZ·LED) 공통. 관마다 별도 평판을 만들지 마십시오 — 같은 사람인데 관마다 점수가 다르면 이용자가 어느 것을 믿을지 모릅니다.';

COMMENT ON TABLE public.visitor_identities IS '비로그인 유입 → 이후 로그인 연결. 이게 없으면 유입의 대부분이 귀속되지 않는다.';

COMMENT ON TABLE public.withdrawal_rules IS '청약철회 규칙. **7일 미만으로 줄일 수 없습니다**(전자상거래법 17조).';

COMMENT ON COLUMN public.withdrawal_rules.blocked_if IS '반품이 안 되는 조건. **개봉·훼손 판정을 우리가 합니다** — 기준이 없으면 매번 다툽니다.';

COMMENT ON INDEX public.idx_listings_search_trgm IS '한글 검색용. **제목 + 본문을 한 덩이로** 봅니다 — 제목만 걸면 본문에만 있는 말로 찾을 때 전 행을 훑습니다.';
