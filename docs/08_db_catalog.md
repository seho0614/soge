# 소개뱅크 — DB 목록

`npm run docs` 가 다시 만듭니다. **손으로 고치지 마십시오.**

테이블 **252** · 뷰 **312**

## 테이블

| 테이블 | 컬럼 | 설명 |
|---|---:|---|
| `account_roles` | 4 | — |
| `account_status_changes` | 7 | v10.31 — 운영이 회원 상태(정상 · 정지)를 바꾼 기록. 사유 필수 · 지울 수 없음 |
| `accounts` | 16 | — |
| `ad_bookings` | 14 | — |
| `ad_creative_segments` | 2 | — |
| `ad_events` | 9 | — |
| `ad_invoices` | 18 | 광고 청구. **광고비는 우리가 받는 돈**입니다 — 소개비(당사자끼리 주고받음)와 섞지 않습니다. |
| `ad_leak_audits` | 4 | — |
| `ad_payments` | 9 | 광고비 입금 기록. **고치거나 지울 수 없습니다** — 돈이 들어온 기록이라 나중에 따질 때 근거가 됩니다. |
| `ad_placements` | 25 | — |
| `ad_products` | 8 | 광고 정가표. **첫 3주는 도입가**로 팔고 노출 실적을 공개한 뒤 재산정합니다. 지금 숫자는 예상 노출이지 실측이 아닙니다. |
| `ad_segments` | 4 | — |
| `ad_slots` | 9 | — |
| `ad_waitlist` | 7 | — |
| `advertisers` | 13 | 광고주. **회원 계정과 별개입니다** — 대행사가 여러 광고주를 대신 집행하는 경우가 있어, 계정 하나에 광고주 여럿이 붙을 수 있습니다. |
| `adx_clicks` | 11 | — |
| `adx_impressions` | 7 | — |
| `adx_publishers` | 10 | v10.31 — 외부 송출 퍼블리셔(외부 사이트). 도메인 확인 전에는 송출 불가 · owner_ips = F5 본인 IP |
| `adx_statement_items` | 3 | — |
| `adx_statements` | 18 | v10.31 — 퍼블리셔 월 명세서. 월 마감 → 신청 → 승인 → 집행(2인 원칙). 원천징수는 예수금(ACC-TAX)으로 따로 |
| `aff_touches` | 4 | 제휴 링크를 누른 방문자 — 72시간 안의 소개몰 주문을 그 링크에 귀속하는 데만 씁니다. 방문자는 해시로만(쿠키 · IP 원문 없음). 7일 지난 줄은 지웁니다(D031 · G-190) |
| `affiliate_product_rates` | 6 | 단가 변경 이력. **고치고 나면 "그때 얼마였느냐" 를 답할 수 없습니다** — 수정·삭제하지 않고 쌓습니다. |
| `affiliate_products` | 14 | 제휴상품. **건당 정액 수수료**입니다. 재고 연동이 없어 운영자가 판매중·품절·중단을 손으로 바꿉니다. |
| `ai_decisions` | 9 | AI 판정 이력. **성향을 해지해도 이 기록은 지우지 않습니다** — "그때 왜 그렇게 나왔나" 를 답할 수 있어야 합니다. 계정을 지우면 account_id 만 비웁니다(기록 자체는 남습니다). |
| `attribution_events` | 14 | INV-2. 분쟁 시 유일한 증거. 운영자도 수정 불가여야 증거력이 있다. |
| `attribution_policies` | 6 | — |
| `audit_reviews` | 9 | 감사 징후를 확인한 기록. **징후가 떠도 누가 보고 어떻게 판단했는지 남지 않으면** 나중에 "왜 그냥 넘어갔느냐" 에 답할 수 없습니다. |
| `audit_thresholds` | 7 | 이상 판정 기준. **코드를 고치지 않고 운영이 조절합니다** — 오픈 직후엔 낮게 잡고, 익숙해지면 올리십시오. |
| `auto_review_policies` | 7 | — |
| `banned_words` | 8 | — |
| `billing_attempts` | 7 | — |
| `billing_keys` | 10 | — |
| `biz_axis_items` | 29 | v10.31 — 소개창업 축 자료. JOB 공고(도급만 · 개인 노출 없음) · SVC 자문 서비스 · POL 정책 소개(원문 자료 포함) · EDU 창업 교육. 정보 축(POL · EDU)은 소개비 구조 밖입니다. |
| `biz_axis_requests` | 9 | v10.31 — 공고의 「업체 소개 요청」 · 자문 서비스의 「견적 요청」. 요청자의 「지원」 갈래와 올린 업체의 받은 요청 목록이 이 표를 씁니다. 연락처는 담지 않습니다(답은 1:1 대화로). |
| `biz_quick_matches` | 9 | v10.31 — 소개창업 인력 축 「빠른 매칭」. 도급으로만 잇습니다 — 인증 사업자(인력대행업체)만 회신(biz_quick_offers)합니다. 요청자 이름 · 연락처는 공개 목록에 내보내지 않습니다(장소는 시 · 도만). |
| `biz_quick_offers` | 3 | — |
| `board_classify_vocab` | 6 | 게시판 분류 어휘. **학습이 아니라 어휘 관리**입니다 — 고치면 다음 글부터 바뀌고, 왜 그렇게 됐는지 설명할 수 있습니다. |
| `broker_verifications` | 22 | — |
| `business_change_requests` | 12 | — |
| `business_members` | 8 | — |
| `businesses` | 28 | — |
| `call_logs` | 6 | — |
| `categories` | 26 | — |
| `category_grades` | 4 | — |
| `category_matrix_axes` | 7 | — |
| `classify_categories` | 7 | — |
| `classify_learn_log` | 9 | 학습으로 바뀐 기록. **되돌리려면 무엇이 언제 바뀌었는지 알아야 합니다** — 학습이 잘못 가도 여기로 복구합니다. |
| `classify_logs` | 9 | — |
| `classify_signals` | 7 | 분류 교정 신호. 운영이 고칠 때마다 그 글의 단어가 쌓입니다 — **한 줄로는 아무것도 바꾸지 않습니다.** 3회 이상 같은 방향일 때 어휘집에 반영됩니다. |
| `classify_vocab` | 3 | — |
| `code_labels` | 10 | ui_tone 은 색을 직접 지정하지 않습니다. 디자인 토큰 이름만 두어
   팔레트가 바뀌어도 데이터를 고치지 않습니다. |
| `collect_fetches` | 9 | 수집 실행 기록. **이 id 가 없으면 데이터가 못 들어옵니다**(INV-C6) — 어느 실행에서 온 값인지 모르면 나중에 되돌릴 수 없습니다. |
| `collect_items` | 9 | 수집한 품목. **사진 · 리뷰 본문 · HTML 원문은 담지 않습니다**(INV-C3) — 담을 컬럼 자체를 두지 않았습니다. 담으면 저작권 문제가 되고 지우기도 어렵습니다. |
| `collect_sources` | 19 | 수집 대상. **게이트를 모두 통과해야 READY 가 됩니다** — robots 확인 · 법무 회신 둘 다 필요합니다. |
| `company_account_changes` | 7 | 수금 계좌 변경 이력. **돈이 어디로 가는지가 바뀌는 일**이라 누가 언제 바꿨는지 남깁니다. 고치거나 지울 수 없습니다. |
| `consult_directory_entries` | 23 | 법률 · 세무 월 정액 노출. 기간 정액만 있고 클릭 · 연락 · 성사 건수와 잇는 칸이 없습니다(D019 · 소개 대가 금지). 리드를 만들지 않습니다. v10.33 부가세 별도 · 연장 신청(RENEW_REQUESTED) · 회차 이력(consult_directory_periods) · 세금계산서(consult_directory_invoices). |
| `consult_directory_invoices` | 27 | v10.33 법률 · 세무 정액 노출료 세금계산서 발행 요청(입금 확인마다 1건). 공급자 = 소개하는 자(운영 법인) · 공급받는 자 = 노출료를 낸 업체(그때의 상호 · 사업자번호). 운영이 「발행」(v10.34 어댑터 — 간주 또는 업체 전송 · etax_*) 또는 발행 번호를 손으로 넣으면(MANUAL) ISSUED. |
| `consult_directory_periods` | 15 | v10.33 정액 노출 기간 이력(회차). 입금 확인마다 1줄(INITIAL 처음 · RENEWAL 연장 · LEGACY D092 전 기록). 같은 항목의 기간은 겹칠 수 없고(EXCLUDE) 연장은 이전 종료일 다음 날부터만. 지우거나 고칠 수 없습니다. |
| `consult_directory_renewals` | 14 | v10.33 정액 노출 연장 신청(A안). 신청 때의 기준 금액 · 개월수 · 공급가액 · 부가세 · 합계를 그대로 적습니다. 열린 신청은 항목마다 하나. 반려 · 취소는 사유 5자 이상. |
| `consult_requests` | 19 | 안심소개 상담 신청. 휴대폰 확인 전에는 리드가 없습니다(INV-12). 연락처는 암호문이며 배분되면 pii.lead_contacts 로 옮기고, purge_after 가 지나면 지웁니다. |
| `contract_revisions` | 8 | — |
| `contract_templates` | 11 | 표준계약서 양식. **자유 양식을 쓰면 분쟁 때 판단 근거가 없습니다** — 소개비 귀속 · 성사 시점 · 해지 조건이 계약마다 달라집니다. |
| `conversations` | 10 | — |
| `deal_confirmations` | 6 | — |
| `deal_contracts` | 25 | — |
| `deal_payment_records` | 7 | INV-11. 결제 금액·계좌 컬럼 없음. 플랫폼은 당사자 결제를 기록만 한다. |
| `deal_reviews` | 9 | — |
| `deal_safe_trades` | 6 | v10.31 — 안전거래(B-04) 합의. 양측이 합의하면 active_at 이 찍히고 그 거래는 당사자 확인 · 분쟁 지원 · 기록 보존 대상입니다. 대금은 플랫폼이 받지 않습니다(INV-11). 금액 = 계약 조건의 합의 금액. |
| `deals` | 20 | — |
| `dispute_messages` | 6 | — |
| `disputes` | 10 | — |
| `etax_send_log` | 14 | v10.34 전자세금계산서 전송 시도 기록(D093) — 발행 · 상태 조회 · 취소마다 1줄. 어댑터(assume 간주 · http 업체) · 결과 · 오류 · 걸린 시간 · 누가. 키 · 요청 본문은 남기지 않습니다. 고치거나 지울 수 없습니다. |
| `event_joins` | 8 | 이벤트 참여 기록. **한 사람이 한 번만** 참여합니다. 지급은 운영이 확인 후 처리하며, 그 사실을 granted_at 에 남깁니다. |
| `events` | 16 | 이벤트. 공지와 달리 **기간이 끝나면 저절로 내려갑니다** — 끝난 이벤트가 걸려 있으면 서비스가 관리되지 않는 것으로 보입니다. |
| `faqs` | 14 | — |
| `favorites` | 4 | — |
| `fee_agreements` | 11 | — |
| `fee_guarantees` | 12 | INV-11. 플랫폼은 예치금을 받지 않습니다. 제3자 예치·지급보증의 확인 기록만 둡니다. 잔액 컬럼이 없는 것이 설계입니다. |
| `fee_guidelines` | 7 | A-12: 플랫폼은 소개비를 계산하지 않는다. 등록 폼의 참고값 표시 전용. |
| `file_policies` | 4 | 파일 용도별 허용 형식과 최대 크기. 서버가 미리 보고, files 트리거가 다시 봅니다. 형식 판정은 매직바이트 기준. |
| `files` | 15 | 올린 파일. 바이트는 저장소(S3 또는 로컬)에 있고 여기에는 메타만 둡니다. READY 가 되어야 다른 표가 가리킬 수 있습니다. |
| `footer_links` | 9 | — |
| `gwan_axes` | 13 | v10.31 — 관 축과 UI 유형(운영 「관 UI/UX 관리」). 거래형 축은 목록형 고정(ui_fixed). 내리면 신규 노출만 멈춤 |
| `gwan_form_copy` | 6 | 관마다 등록 폼이 다릅니다. 새 관을 만들면 여기 문구도 넣어야 합니다. |
| `gwans` | 10 | — |
| `hlt_addresses` | 11 | — |
| `hlt_carriers` | 4 | 택배사 공개 조회 주소({no} = 송장번호) — 「택배사에서 보기」가 새 창으로 엽니다. 택배사 코드 · 송장번호만 넘깁니다(이름 · 주소 · 연락처 X). checked_at 이 비면 운영이 주소를 확인하기 전 · v10.31 |
| `hlt_cart_items` | 7 | 장바구니. **재고를 잡지 않습니다** — 담아 놓고 안 사는 사람 때문에 실제 살 사람이 못 사면 안 되기 때문입니다. 주문할 때 다시 확인합니다. |
| `hlt_carts` | 2 | — |
| `hlt_commission_changes` | 8 | 수수료율 변경 이력. **돈이 얼마나 빠지는지가 바뀌는 일**이라 누가 언제 왜 바꿨는지 남습니다. 고치거나 지울 수 없습니다. |
| `hlt_commission_rates` | 7 | 카테고리별 기본 판매수수료율. **소개뱅크가 정합니다** — 판매자별 예외는 hlt_sellers.commission_rate 에 둡니다. |
| `hlt_concern_ingredients` | 3 | — |
| `hlt_concerns` | 7 | 고민 축 — 이름은 상태 표현만(질병명 금지). 고민은 "많이 찾는 성분" 묶음입니다 — D002 |
| `hlt_exchange_fees` | 15 | 교환 배송비 결제 — 주문 결제(hlt_payments)와 따로 둡니다. 카드 · 계좌이체만(가상계좌 없음). 환불은 결제사 취소(D027) |
| `hlt_notice_groups` | 4 | — |
| `hlt_notice_items` | 4 | — |
| `hlt_order_items` | 12 | — |
| `hlt_orders` | 21 | 건강몰 주문. **우리가 파는 당사자**입니다 — 하자·배송·반품 책임이 우리에게 있습니다. |
| `hlt_payments` | 16 | 결제 기록. **카드번호는 남지 않습니다** — PG 가 처리하고 우리는 거래번호(pg_tid)만 받습니다. |
| `hlt_product_history` | 9 | — |
| `hlt_product_ingredients` | 6 | 상품–성분 연결. amount 는 상품 표시 함량 그대로(예: "1000IU") — D002 |
| `hlt_product_options` | 10 | 소개몰 상품의 옵션(복용 개월 수). 한 달 단가 = round(price / months). months 가 없으면 「단품」. 장바구니 · 주문 · 재고의 단위입니다(D027). |
| `hlt_products` | 21 | 건강몰 판매 상품. **소개 등록(listings)과 다릅니다** — 우리가 직접 파는 물건입니다. |
| `hlt_promos` | 15 | 소개몰 메인 「오늘의 건강상품」 특가 배너(시안 · v10.31). is_sample=true 면 화면에 「견본 문구 — 광고 심의 확인 전」을 붙입니다 — 건강기능식품 기능성 문구는 인정 범위 · 광고 심의를 확인한 뒤 씁니다 |
| `hlt_qna` | 11 | — |
| `hlt_rankings` | 9 | — |
| `hlt_returns` | 19 | 취소 · 반품. **7일 안이면 이유를 묻지 않습니다**(전자상거래법 17조) — 다만 식품은 개봉하면 반품 불가이고, 그 판정을 우리가 합니다. |
| `hlt_reviews` | 14 | — |
| `hlt_sale_categories` | 5 | 소개몰(직판)이 취급하는 갈래의 상태. LOCKED · NOT_SOLD 갈래의 상품은 판매 중으로 둘 수 없습니다(fn_hlt_product_guard). 회원 간 매물의 등록 규칙(restricted_industries)과는 별개입니다. |
| `hlt_seller_licenses` | 10 | 판매자 자격. **만료되면 노출이 즉시 멈춥니다**(INV-H10) — 다만 이미 받은 주문은 이행합니다. 진행 중인 거래를 끊으면 이용자가 피해를 봅니다. |
| `hlt_sellers` | 17 | 건강몰 판매자. DIRECT = 우리가 직접 팜 · BRAND/TENANT = 입점. **입점 판매자는 대금을 직접 받습니다**(하위가맹점) — 우리를 거치면 자금 수탁이 되어 전자금융거래법 등록 대상입니다. |
| `hlt_settlement_items` | 7 | 정산 내역 — 주문별. **한 주문이 매출과 환불로 두 줄**이 될 수 있습니다. |
| `hlt_settlements` | 18 | 주별 정산. **확정분(배송완료 + 7일)만 집계합니다** — 배송 완료로 집계하면 반품될 때마다 되돌려야 합니다. |
| `hlt_shipments` | 8 | 배송 기록. 한 주문에 여러 줄이 쌓입니다 — **언제 무엇이 있었는지**를 남겨야 "안 왔다" 는 문의에 답할 수 있습니다. |
| `idempotency_records` | 14 | 같은 요청을 한 번만 처리하기 위한 기록. 작업을 시작하기 전에 줄을 넣어 선점합니다 |
| `identity_verifications` | 8 | — |
| `ingredients` | 12 | 우리 성분 마스터. 수집한 원재료명을 여기에 맞춰 봅니다. |
| `inquiries` | 13 | — |
| `integrations` | 17 | 시크릿 값은 저장하지 않습니다. Secrets Manager 키 이름과 등록 여부만 기록합니다. |
| `introducer_grades` | 6 | 소개자 등급 기준 · 혜택(시안 「활동 내역 › 등급」 표 · v10.31). 등급은 건수가 아니라 수락률 · 만족도로 정합니다 |
| `introducer_profiles` | 11 | — |
| `introducer_referrals` | 5 | 초대 관계. invitee 가 UNIQUE 이므로 한 사람은 한 번만 초대받습니다. 하위의 하위를 표현할 열이 없습니다 — 다단계가 구조적으로 불가능합니다. |
| `introducer_responses` | 6 | — |
| `introduction_connections` | 10 | — |
| `introduction_invites` | 11 | 소개 초대. 연락처가 아니라 링크를 보냅니다. 상대가 동의해야 연결이 열립니다. |
| `invite_deliveries` | 10 | — |
| `item_types` | 7 | — |
| `job_runs` | 8 | — |
| `job_schedules` | 7 | — |
| `lead_assign_weights` | 4 | 자동 배정 가중치(파트너 등급별). 최근 30일 받은 수 ÷ 가중치가 작은 업체부터, 같으면 가장 오래전에 받은 업체부터 보냅니다. lead_grade_rates(S~G)는 리드 품질 등급별 이용료 비율이라 업체 순번에 쓰지 않습니다. |
| `lead_cash_bonus_rates` | 5 | — |
| `lead_cash_charges` | 16 | — |
| `lead_cash_entries` | 8 | — |
| `lead_cash_invoices` | 21 | 리드 이용료 세금계산서 발행 요청(D076) — 달마다 유상 잔액 실사용액(부가세 포함 금액을 공급가액 · 세액으로 나눔). v10.34 국세청 전송 결과 etax_*(D093). |
| `lead_cash_lines` | 4 | — |
| `lead_cash_refund_parts` | 6 | — |
| `lead_cash_refunds` | 11 | — |
| `lead_cash_wallets` | 9 | 리드 이용료 선불 잔액(D070). 자사 서비스(리드 확인비용) 이용료 선납으로 한정 — 다른 가맹점 사용 · 송금 · 양도 · 현금화 불가, 유상 잔액만 결제 취소로 환불. 조건은 파트너 이용약관 제3~5조(10/10 사용자 답 — 파트너 약관 발행 전부 가능 · D090). 잔액은 lead_cash_lines 로만 움직입니다 — 직접 UPDATE 로 잔액을 바꾸면 불변식(v_lead_cash_invariants)이 잡습니다 |
| `lead_deliveries` | 11 | — |
| `lead_delivery_memos` | 6 | — |
| `lead_fee_changes` | 6 | — |
| `lead_fee_disputes` | 12 | 리드 이용료 반려 신청(T-04). 파트너 신청 → 운영 인정(이용료 무효, 위험감지 규칙 근거) 또는 기각(사유). D003 |
| `lead_fees` | 12 | 정보 이용료 원장. 열람 시점에 발생하고 성사와 무관합니다. D070 부터 선불(settle_mode PREPAID): 리드 이용료 충전 잔액(lead_cash_wallets)에서 차감 — 보너스 먼저, 그다음 유상. 옛 후불 줄(settle_mode POSTPAID)은 전환 전 미청구분 정리용으로만 남습니다. 충전금은 자사 서비스 이용료 선납으로 한정 — 다른 가맹점 사용 · 송금 · 현금화 불가(INV-11 은 중개 대금 수탁 감시로 그대로). |
| `lead_grade_rates` | 7 | — |
| `leads` | 22 | — |
| `listing_badges` | 13 | — |
| `listing_checklist` | 8 | 자동 노출 조건. 여기를 통과하면 사람 심사 없이 바로 보입니다. 항목을 늘리면 자동 통과가 줄고, 줄이면 사후에 잡을 일이 늘어납니다. |
| `listing_edit_drafts` | 6 | SB-HOM-REG-020 「초안 저장」 — 매물 수정 초안(본인만). 재검수 요청(PATCH /listings/{id})이 성공하면 지웁니다. |
| `listing_media` | 7 | — |
| `listing_regions` | 2 | — |
| `listing_versions` | 6 | — |
| `listings` | 32 | — |
| `llm_parse_log` | 6 | LLM 파서 호출 기록. **원문 검색어를 저장하지 않습니다**(INV-SCH2) — 검색어에 상호·연락처가 섞여 들어오기 때문입니다. 구조화된 파라미터만 남깁니다. |
| `main_copy` | 4 | — |
| `main_sections` | 7 | — |
| `mal_partner_axes` | 9 | 안심소개 인증업체의 축별 입점 승인. 한 업체가 여러 축에 입점할 수 있고 축마다 따로 승인합니다(설계서 v1.2 §4). |
| `marketing_materials` | 12 | 마케팅자료. **심의 뒤에 게시합니다** — 파트너가 뿌리는 순간 회사가 한 말이 됩니다. 반려하면 인앱과 이메일로 알립니다(결정 19). |
| `member_ad_profiles` | 9 | 광고 소재 선택과 추천 정렬에만 씁니다. 광고주에게 제공하지 않습니다. |
| `messages` | 8 | — |
| `notices` | 8 | — |
| `notification_deliveries` | 9 | — |
| `notification_event_policies` | 6 | — |
| `notification_preferences` | 5 | — |
| `notification_templates` | 6 | — |
| `notifications` | 9 | — |
| `ops_alerts` | 8 | — |
| `ops_monthly_costs` | 6 | v10.31 — 운영이 입력하는 월 비용(활주로 계산용). 매출은 v_monthly_revenue(실제 입금) |
| `owner_verifications` | 14 | — |
| `partner_badge_rules` | 8 | — |
| `partner_brand_sites` | 6 | 회사 관리 「등록 소재」 — 지점 · 사무소. 시 · 군 · 구까지만(상세 주소는 받지 않음) |
| `partner_brands` | 5 | — |
| `partner_catalog_items` | 8 | — |
| `partner_fulfillment_reports` | 12 | 이행 보고(D073) — 소비자 확인(CONFIRMED)이 「성사」입니다. 성사는 이용료와 무관합니다(정보 이용료 · 열람 시점 확정) |
| `partner_goals` | 8 | 파트너 목표. 등급 일괄과 개인별 둘 다 둡니다. **개인별이 우선입니다**(결정 20) — 특별히 정해 준 것이 일반 규칙보다 앞섭니다. |
| `partner_grade_rules` | 6 | 파트너 등급 기준(이번 달 확정 제휴수수료). 비어 있으면 「다음 등급까지」를 계산하지 않습니다(숫자를 지어내지 않음) |
| `partner_guides` | 8 | — |
| `partner_inquiries` | 9 | — |
| `partner_invoices` | 6 | 세금계산서. **트랙별로 그룹이 다릅니다** — 소개비와 제휴수수료는 성격이 달라 한 장에 묶으면 안 됩니다(결정 8). |
| `partner_link_clicks` | 4 | 링크 클릭 중복 제거용(하루·방문자당 1회). **해시만** 둡니다 — IP·UA·쿠키 원문 없음. 해시에 날짜가 섞여 날을 넘겨 추적할 수 없고, 이틀 지난 행은 fn_plink_click 이 지웁니다. 집계는 partner_link_stats (D001) |
| `partner_link_stats` | 4 | 링크 일별 집계. 매번 세면 느립니다 — 배치가 하루 한 번 채웁니다. |
| `partner_links` | 8 | 파트너 소개링크. 링크마다 코드를 따로 둡니다 — 어느 경로로 들어왔는지 모르면 수수료를 누구에게 줄지 정할 수 없습니다. |
| `partner_orders` | 14 | 제휴 주문. **귀속은 72시간 last-click** 입니다 — 소개비의 90일 first-touch(INV-2)와 다른 스킴입니다. |
| `partner_regions` | 3 | — |
| `partner_revenues` | 8 | 파트너 수익. **트랙을 나눕니다** — AFFILIATE 는 회사가 지급하고 REFERRAL 은 당사자끼리입니다(INV-9). 섞이면 공제 0원 검정이 깨집니다. |
| `partner_service_blocks` | 7 | — |
| `partner_service_events` | 8 | — |
| `partner_service_matrix` | 4 | — |
| `partner_services` | 17 | — |
| `partner_settlement_accounts` | 14 | 파트너 정산 계좌. **번호는 암호화해 두고 뒤 4자리만 보여 줍니다** — 운영 화면에 전체가 보이면 그 자체가 위험입니다. |
| `partner_settlements` | 15 | 파트너 정산. **트랙별로 따로 돕니다** — 정산주기가 다를 수 있어 배치 스케줄을 분리합니다(결정 21). |
| `partner_track_quotes` | 5 | — |
| `partners` | 9 | — |
| `payout_accounts` | 16 | 정산 계좌. **평문 계좌번호 컬럼이 없습니다** — 넣을 때는 fn_payout_add() 로, 꺼낼 때는 fn_payout_reveal() 로만 다룹니다. |
| `pending_decisions` | 6 | — |
| `point_ledger` | 8 | — |
| `point_rules` | 7 | — |
| `policy_items` | 10 | v10.31 — 정책 원본(운영 「정책」 화면 표). 확정/미결 · 근거 결정 번호 |
| `poll_options` | 7 | 투표 보기(D021). 표가 들어온 뒤에는 바꾸거나 지울 수 없습니다(fn_poll_option_guard). |
| `poll_votes` | 8 | 투표한 표(D021). 회원은 계정 1표, 비로그인은 방문자 키(sgb_visitor 쿠키) 1표. 주소는 날짜를 섞은 해시(ip_hash)만 남깁니다 — 원문 없음. 고치거나 지울 수 없습니다. |
| `polls` | 15 | 소개광장 「이건 어때?」 투표(D021). kind — VS 비교해요 · ASK 궁금해요 · USED 써본 의견이 필요해요. 운영자가 만들고 OPEN 으로 열어야 보입니다. show_on_home 이면 메인 카드에 나옵니다(종류마다 1건). |
| `post_comments` | 9 | 댓글. **대댓글은 1단계까지**입니다 — 더 깊으면 화면에서 읽기 어렵습니다. |
| `posting_suspensions` | 7 | v10.31 — 제한업종 · 금칙 표현 반려 3회(90일) → 7일 등록 정지. 운영이 풀 수 있음 |
| `posts` | 18 | 커뮤니티 글. **전체 공개**라 첫 글은 검수를 거칩니다. 소개 후기는 거래 기록이 있어야 합니다 — 거래도 안 한 사람의 후기가 가장 나쁜 광고입니다. |
| `profile_options` | 5 | — |
| `profile_questions` | 4 | — |
| `property_listings` | 11 | — |
| `public_questions` | 8 | — |
| `qualification_reviews` | 12 | — |
| `qualification_rules` | 6 | — |
| `recommend_weights` | 4 | 협업 필터링이 아닙니다. 성사 데이터 전까지는 이 표를 정하는 사람이 곧 알고리즘입니다. |
| `referral_code_payments` | 9 | D010 초과 소개코드 결제. 결제키 1건 = 1행(재사용 불가). 소개비가 아니라 회원이 플랫폼에 내는 코드 요금입니다(INV-11). |
| `referral_codes` | 12 | — |
| `regions` | 7 | — |
| `report_reasons` | 6 | — |
| `reports` | 11 | — |
| `request_proposals` | 12 | — |
| `request_views` | 5 | — |
| `requests` | 26 | — |
| `restrict_vocab` | 3 | 제한업종을 실제로 부르는 말. 올리는 사람은 "의료 서비스" 가 아니라 "성형외과" 라고 씁니다 — 이름만으로는 대부분 통과합니다. |
| `restricted_industries` | 14 | 관별 제한업종. BLOCK = 등록 불가 · AD_ONLY = 광고만 · GATED = 자격을 확인하면 가능 · ALLOW = 제한 없음. **건강몰 의료기기는 GATED** — 심의필 번호가 있으면 판매·광고 모두 됩니다. |
| `review_events` | 7 | — |
| `review_items` | 17 | — |
| `review_reason_codes` | 6 | 반려 사유를 자유서술로 두면 재제출률·사유 분포를 볼 수 없다. 검수가 병목이므로 코드값 필수. |
| `risk_actions` | 6 | — |
| `risk_alerts` | 11 | — |
| `risk_exemptions` | 9 | 위험 경보 예외. 운영이 "정상" 으로 닫은 것이 3회 쌓이면 여기 들어가 더 뜨지 않습니다. **RSK-05(제한업종) · RSK-07(광고 규제)는 제외** — 법이 정한 것이라 사람 판단으로 열 수 없습니다. |
| `risk_rules` | 10 | — |
| `role_changes` | 7 | — |
| `safe_numbers` | 9 | — |
| `safety_cases` | 12 | v10.31 — 사고예방 「피해 사례 게시판」. 작성자는 공개하지 않습니다. 연락처 · 이메일 · 계좌는 저장 전에 가립니다(SafetyService.mask). 하루 3건까지(작성자 기준). |
| `schema_migrations` | 4 | — |
| `search_intents` | 5 | 주관적 표현을 조건으로 바꾸는 사전. **LLM 대신 씁니다** — "가성비" 가 무엇인지 값으로 정해 두면 결과가 일정하고 왜 그렇게 나왔는지 설명할 수 있습니다. |
| `search_synonyms` | 6 | 검색 동의어. 사람이 치는 말을 우리가 저장한 말로 바꿉니다 — "점포" 로 쳐도 "상가" 가 나오게 합니다. |
| `search_term_stats` | 4 | 검색어 통계. **정규화된 말만 담습니다** — 원문에는 상호·연락처가 섞여 들어옵니다(INV-SCH2). |
| `segment_shift_log` | 9 | 성향 세그먼트가 행동으로 바뀐 기록. **질문은 가입할 때 한 번 답한 것이고 사업은 바뀝니다** — 행동이 더 최근 사실입니다. 되돌릴 수 있게 남깁니다. |
| `setting_placeholders` | 2 | — |
| `settlement_approvals` | 6 | v10.31 — 정산 승인 기록(지울 수 없음). 승인은 정산서 확인이며 자금 이동이 아님(INV-11) |
| `settlements` | 17 | INV-9: 공제·수수료 컬럼 없음. amount 는 deals.agreed_fee 와 항상 일치해야 한다. |
| `signup_types` | 6 | — |
| `site_settings` | 10 | — |
| `subscription_invoices` | 20 | — |
| `subscription_plans` | 13 | — |
| `subscription_refunds` | 20 | 구독 환불 요청. 결제사 취소를 확인한 뒤에만 SUCCEEDED 가 됩니다 — 그 전에는 구독 · 청구서를 환불로 바꾸지 않습니다 |
| `subscriptions` | 19 | — |
| `success_fees` | 10 | 회원 → 플랫폼 성사 수수료. 소개비(settlements)와 별개이며 공제 관계가 아니다. |
| `success_stories` | 17 | v10.31 — 베스트매칭 사례(시안 SB-MNY-BST-010). 숫자(거래금액 · 소개비 · 성사기간 · 과정)는 저장하지 않고 v_success_deals · fn_deal_timeline 에서 읽습니다. 운영이 고른 이유 · 매도자 한마디만 저장합니다. 두 당사자 동의 전에는 공개할 수 없습니다(fn_success_story_guard). |
| `term_agreements` | 8 | — |
| `terms` | 13 | 약관. **MARKETING 은 선택 동의**지만, 없으면 광고성 정보를 보낼 수 없습니다 — 동의 없이 보내면 정보통신망법 50조 위반입니다. |
| `trust_weights` | 4 | 신뢰도 가중치. 운영이 화면에서 바꿉니다 — 배포가 필요 없습니다. BASE 를 낮추면 신규가 불리해져 첫 거래가 줄어듭니다. |
| `ui_messages` | 6 | 법적 근거가 있는 화면 문구. 임의로 지우면 표시 의무 위반이 될 수 있어 basis 를 함께 둡니다. |
| `visitor_identities` | 5 | 방문자 키 ↔ 계정 연결(추가만). 같은 짝이 여러 줄일 수 있습니다 — 유입 뒤에 다시 로그인하면 한 줄 더 남깁니다(D011). |
| `withdrawal_rules` | 6 | 청약철회 규칙. **7일 미만으로 줄일 수 없습니다**(전자상거래법 17조). |

## 뷰 (감시·집계)

대부분 **0이어야 정상**인 감시 뷰입니다 — 값이 있으면 그 자체가 경보입니다.

- `v_account_trust`
- `v_ad_advertiser_stats`
- `v_ad_attr_orphan`
- `v_ad_attribution_on`
- `v_ad_auction_ready`
- `v_ad_capacity`
- `v_ad_demo`
- `v_ad_expiring`
- `v_ad_inventory`
- `v_ad_no_product`
- `v_ad_no_slot`
- `v_ad_only_industries`
- `v_ad_only_leak`
- `v_ad_overdue_running`
- `v_ad_platform`
- `v_ad_privacy_leak`
- `v_ad_receivables`
- `v_ad_sellable_gap`
- `v_ad_serving`
- `v_ad_settlement_hold`
- `v_ad_slot_conflict`
- `v_ad_slot_empty`
- `v_ad_stats_for_advertiser`
- `v_ad_waitlist_monthly`
- `v_address_detail_leak`
- `v_admin_settings`
- `v_adx_ledger_mismatch`
- `v_ai_client_scored`
- `v_ai_decision_stats`
- `v_ai_match_fee_violation`
- `v_alimtalk_ad_words`
- `v_alimtalk_no_fallback`
- `v_alimtalk_thin`
- `v_assumed_on`
- `v_attribution_channels`
- `v_attribution_health`
- `v_audit_admin_burst`
- `v_audit_admin_night`
- `v_audit_anomalies`
- `v_audit_night_access`
- `v_audit_no_reason`
- `v_audit_over_retention`
- `v_audit_pii_burst`
- `v_audit_review_overdue`
- `v_audit_review_thin`
- `v_audit_same_target`
- `v_audit_sample_queue`
- `v_auto_approved_recent`
- `v_auto_approved_reported`
- `v_auto_review_rate`
- `v_b12_rollback_scope`
- `v_badge_stats`
- `v_bank_assumed`
- `v_banned_word_wildcards`
- `v_billing_after_cancel`
- `v_billing_attempts_today`
- `v_billing_due`
- `v_billing_duplicates`
- `v_billing_integrity`
- `v_billing_key_exposure`
- `v_billing_notice_missing`
- `v_billing_pending`
- `v_billing_policy`
- `v_billing_policy_mismatch`
- `v_billing_retry_overrun`
- `v_board_misclassified`
- `v_broker_commission_leak`
- `v_broker_gate_leak`
- `v_broker_guarantee_due`
- `v_broker_pending`
- `v_broker_recheck_due`
- `v_broker_verified_assumed`
- `v_business_region`
- `v_business_signals`
- `v_card_columns`
- `v_checklist_for_gwan`
- `v_classify_accuracy`
- `v_classify_blocked_learned`
- `v_classify_corrections`
- `v_classify_learn_burst`
- `v_classify_misses`
- `v_classify_overweight`
- `v_classify_unlinked`
- `v_classify_vocab_conflicts`
- `v_classify_vocab_wildcards`
- `v_code_coverage`
- `v_code_missing_labels`
- `v_collect_gate_status`
- `v_collect_match_rate`
- `v_collect_stuck`
- `v_company_account`
- `v_connection_without_consent`
- `v_consult_directory_lapsed`
- `v_consult_directory_public`
- `v_consult_eligible_partner`
- `v_consult_lead_unverified`
- `v_consult_purge_overdue`
- `v_content_missing`
- `v_contract_conversion`
- `v_contract_draft_marks`
- `v_contract_no_template`
- `v_contract_progress`
- `v_contract_stalled`
- `v_contract_stub`
- `v_contract_unfulfilled`
- `v_daily_metrics`
- `v_dangling_refs`
- `v_deal_refcode_listing_mismatch`
- `v_direct_gwans`
- `v_direct_notice_missing`
- `v_directory_lead_leak`
- `v_domain_mismatch`
- `v_duty_conflict`
- `v_enc_key_direct_use`
- `v_enc_key_missing`
- `v_enc_key_status`
- `v_event_ungranted`
- `v_events_live`
- `v_events_to_close`
- `v_feature_flags`
- `v_fee_mixing_check`
- `v_footer_links`
- `v_gated_no_review`
- `v_gated_unchecked`
- `v_gated_unqualified_public`
- `v_grade_no_rank`
- `v_guarantee_custody_risk`
- `v_gwan_admin`
- `v_gwan_cards`
- `v_gwan_hub`
- `v_gwan_open_ready`
- `v_gwan_system`
- `v_gwan_without_category`
- `v_high_fee_eligible`
- `v_hlt_carryover_large`
- `v_hlt_cart`
- `v_hlt_license_expired`
- `v_hlt_license_expiring`
- `v_hlt_locked_on_sale`
- `v_hlt_paid_no_actor`
- `v_hlt_refund_mismatch`
- `v_hlt_refund_pending`
- `v_hlt_returns_pending`
- `v_hlt_review_pending_overdue`
- `v_hlt_review_stats`
- `v_hlt_sale_leak`
- `v_hlt_sale_violation`
- `v_hlt_seller_no_submerchant`
- `v_hlt_settle_blocked`
- `v_hlt_settle_missed`
- `v_hlt_settle_ready`
- `v_hlt_settlement_ready`
- `v_hlt_ship_overdue`
- `v_hlt_wrong_gwan`
- `v_idempotency_open`
- `v_individual_listing`
- `v_integration_readiness`
- `v_integration_status`
- `v_internal_key_missing`
- `v_intro_money_ledger`
- `v_introducer_matched_requests`
- `v_introducer_scorecard`
- `v_introducer_stats`
- `v_inv11_violations`
- `v_inv9_violations`
- `v_invite_contact_residue`
- `v_invite_self_contact`
- `v_job_failures`
- `v_job_stale`
- `v_k_value`
- `v_landing_broken`
- `v_lead_assign_stuck`
- `v_lead_axis_leak`
- `v_lead_below_breakeven`
- `v_lead_cash_invariants`
- `v_lead_contact_unlogged`
- `v_lead_delivery_gated_leak`
- `v_lead_delivery_overcap`
- `v_lead_delivery_state_mismatch`
- `v_lead_economics`
- `v_lead_fee_coupling`
- `v_lead_fee_due`
- `v_lead_fee_raised`
- `v_lead_fee_void_mismatch`
- `v_lead_fee_void_without_rule`
- `v_lead_fee_without_view`
- `v_lead_fee_zero`
- `v_lead_multi_delivery`
- `v_lead_no_consent`
- `v_lead_price_table`
- `v_lead_purge_overdue`
- `v_lead_restricted_leak`
- `v_led_category_selfmade`
- `v_listing_consult_leak`
- `v_listing_gate_on_counter`
- `v_listing_gwan_mismatch`
- `v_listing_region`
- `v_listing_search`
- `v_listing_urgent`
- `v_location_columns`
- `v_location_waiver_broken`
- `v_main_empty`
- `v_mal_partner_only_gap`
- `v_manual_reasons`
- `v_marketing_consent_stale`
- `v_marketing_night_violation`
- `v_marketing_no_consent`
- `v_marketing_reconfirm_due`
- `v_mmat_unreviewed_live`
- `v_monthly_revenue`
- `v_no_intro_leak`
- `v_notification_copy_conflicts`
- `v_notify_channels`
- `v_notify_queue`
- `v_notify_stuck`
- `v_nts_check_health`
- `v_open_blockers`
- `v_owner_public_stats`
- `v_owner_verified_but_locked`
- `v_owner_verify_pending`
- `v_partner_custody_risk`
- `v_partner_eligible`
- `v_partner_goal_effective`
- `v_partner_path_conflict`
- `v_partner_track_mixed`
- `v_payout_locked`
- `v_payout_queue`
- `v_payout_stub`
- `v_pending_decisions`
- `v_persona_orphan_history`
- `v_phase2_blockers`
- `v_point_redeemable_violation`
- `v_poll_home`
- `v_poll_result`
- `v_porder_unattributed_paid`
- `v_post_badges`
- `v_post_pending_long`
- `v_post_reported`
- `v_post_spam_suspect`
- `v_privacy_inventory`
- `v_promo_cohort`
- `v_property_address_leak`
- `v_property_pending`
- `v_property_unqualified`
- `v_pstl_paid_no_account`
- `v_ptn_approval_gap`
- `v_purge_overdue`
- `v_qualification_no_lookup`
- `v_qualification_pending`
- `v_rate_partial`
- `v_realty_broker_unverified`
- `v_realty_unmarked`
- `v_recommend_weight_sum`
- `v_refcode_extra_unpaid`
- `v_referral_fee_hard_deps`
- `v_referral_fee_leak`
- `v_refund_scope`
- `v_refund_violation`
- `v_report_not_escalated`
- `v_report_pending`
- `v_report_reasons_for_gwan`
- `v_report_stale`
- `v_restrict_no_vocab`
- `v_restricted_still_public`
- `v_restricted_unlinked`
- `v_restriction_scope`
- `v_revenue_leak`
- `v_revenue_model`
- `v_revenue_summary`
- `v_review_automation`
- `v_review_no_event`
- `v_review_throughput`
- `v_risk_dormant`
- `v_risk_effectiveness`
- `v_risk_exempt_forever`
- `v_risk_law_exempted`
- `v_risk_overexempted`
- `v_risk_rule_broken`
- `v_risk_unattended`
- `v_role_holders`
- `v_scope_map`
- `v_search_bigm_status`
- `v_search_dict_empty`
- `v_search_parser_health`
- `v_search_pii_columns`
- `v_search_raw_stored`
- `v_search_sanity`
- `v_search_zero_hit_terms`
- `v_secret_in_db`
- `v_segment_behavior`
- `v_segment_learn_no_consent`
- `v_segment_shift_candidates`
- `v_segment_shift_preview`
- `v_segment_shift_thrash`
- `v_settlement_label_gap`
- `v_signup_order`
- `v_sms_over_limit`
- `v_sms_too_long`
- `v_sub_refund_open`
- `v_subscription_cancelling`
- `v_success_deals`
- `v_success_fee_due`
- `v_suppliers`
- `v_template_no_inapp`
- `v_template_unused`
- `v_term_consent_current`
- `v_term_not_agreed`
- `v_terms_empty`
- `v_terms_not_effective`
- `v_trust_scores`
- `v_trust_thin_sample`
- `v_withdrawn_still_public`
