# 소개뱅크 v10.26 진행 메모 (2026-10-08)

작업현황 문서(claude/소개뱅크_작업현황_20261006.md) 19절에 이어지는 내용입니다.

## v10.26 반영 — 진행 메모 (10/8 · 작업본 · 아직 묶음 전)

- **확정(10/8)**: A-1 교환 배송비 = 접수 때 온라인 결제(반려 · 회사 사정이면 환불) · A-2 견본 16종 모두 직판 · A-3 일부 반품 넣지 않음(시안 칸도 뺌) · A-4 p12 → 건강식품 + 화장품 견본 p17(단품) · 3절 B 14가지 추천값 · 시안 5곳은 「추천한 형태 · 디자인은 깨지 말 것」 · **약관 1.2 확정**(제3조 「반품 · 교환 비용」) · **교환에서 바꾼 반품은 반품 배송비를 빼지 않음**(전액 환불) · **G-203 이번 판에서 고침**.
- **DB**: D027(옵션 · 카탈로그 · 교환 비용) · **D028**(HLT_SALE 1.2 — 쓰던 DB 는 새 판 발행 · 새 설치는 초안 본문) · **D029**(금칙어 같은 줄 정리 422 → 1 + 유일 규칙 `uq_banned_words_rule` — 운영 화면 같은 금칙어는 409 WORD_EXISTS). 마이그레이션 **74**.
- **서버(이번에 더한 것)**: 성분 상세 상품마다 `ingAmount` · 품절 옵션 담기 = 앞 판과 같은 422 「남은 수량이 0개입니다 — 상품 이름 옵션」(code SOLD_OUT) · 바꾼 반품(`converted_from`)은 `refundDeduction` 0.
- **사용자 웹**: ShopMain(성분별 최저가 「N원 / 30일」 · 새로 올라온 상품 4 · 이번 주 특별 할인 = 배지 특별가격 · 예전 「소개몰 상품」 구역 없앰) · 성분별 3묶음(많이 찾는 · 전체 · 성분군) · 성분 상세(최저 월 N원 · 함량 단추 `?amt=` · 정렬 고르기 `IngSort`) · 검색 `SearchBox`(자동완성 · ↑↓ Enter Esc · 바깥 누르기는 pointerdown — G-204) · 인기 검색어 = 시안 5개 중 살 수 있는 것 · 교환 비용 상자 + `ExchangeFeePay`(시험 결제 · 토스 결제창은 `/my/health/returns/{id}/fee` 로 돌아옴) · 내역/주문 상세의 「결제하기」 · 작은 그림 · 옵션 이름(주문 상세 · 결제 · 완료) · 상품 상세 「← 뒤로」= 메인(시안 parent) · 품절 배지. BO HealthSettle: 바꾼 반품은 「빼지 않고 전액」 미리 보기.
- **시안 v10.26**: `qa/proto_patch_1026.py`(BASE = outputs 의 v10.25 → spec/proto.html · 여러 번 돌려도 같음) — 그림 글자 · `minUnitOf`(살 수 있는 옵션) · 단품 · p12/p17 · 상세 안내 글 · 교환 배송비 줄 · 반품 체크칸 뺌 · 교환 결제 창(`xfeeModal` · 내역 `data-xfee`) · 자동완성(PRODUCTS · 살 수 있는 것만 · capture · 바로 검색) · 견본 주문 이름 · 운영 `admhpr`(SB-ADM-HPR-010 · 화면 195) · 약관 전문 1.2(`qa/hlt_sale_terms.md` · 앞 판 `hlt_sale_terms_v1_1.md`) · 제목 v10.26.
- **시험(새)**: `site_opt.py` 30/30 · `proto_opt.py` 23/23 · `srv_opt.py` 91/91(X-12 바꾼 반품 · T-1/T-2 약관) · `fix_1026.py` 40/40(G-203-1~3) · 갱신: site_mall 48/48 · flow_mall 108/110(+조건부 건너뜀 2) · srv_hlt_ui 15/15 · proto_mall 51/51 · proto_pixel 2/2(본체 194장 같음 · 새 admhpr) · proto_diff(v10.25 와 · 새 화면 admhpr) — proto_diff 는 판 올림(bump) 뒤에 돌림. v10.25 판 도구는 `proto_diff_v1025.py` · `proto_pixel_v1025.py`.
- **전후 그림**: 사용자 웹 시안↔반영 후 `cmp_1026.py after` · `sheet_after` → `design_1007/cmp26/소개몰_v10.26_반영후_1~4_….png` · 시안 전후 `proto_cmp_1026.py` → `시안_v10.26_전후_1~2_….png`.
- **남은 것**: 판 올림(bump_1026 — VERSION · 시안 3벌 · README · 문서 이름) → final_parts 에 새 시험(B: srv_opt · site_opt · D: proto_opt) → 전수 A ~ E → Docker(쓰던 볼륨 → 74) · PowerShell · 새로 설치 · 리허설 → 문서 75 · 매트릭스 · zip + tar(각 30MiB 미만). 사용자 웹 시험 중 btn_site · crawl 은 전수에서 확인.
