"""v10.25 확장 점검(2026-10-08 · 연동 · 버튼 체크 · flow 점검 · DB 연동)에서 나온 것 — defects.json 에 넣고(findings_r2.json 도 씀) 여러 번 돌려도 같습니다.

kind  제품 결함 = 만든 대로 움직이지 않음 / 빠진 기능 = 화면 · API 가 아직 없음(범위 · 결정 사항) / 시안 = 시안 파일의 것 / 시험 도구 = 점검 도구의 착오 / 관찰 = 사실 기록
sev   상 · 중 · 하        tag = 엑셀의 실패 줄과 잇는 열쇠(묶음, 단계)
"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
OPEN = '(열려 있음) '
F = [
 # ── 시험 도구 ──
 dict(no='G-170', kind='시험 도구', area='시험 도구 · 운영 화면 전수', sev='중', open=False,
      what='운영 화면 전수 확인(crawl_admin_final.py)이 위 탭을 「글자가 들어 있는 첫 단추」로 눌러 「광고」 탭 대신 「광고 과금」을, 「감사」 탭 대신 「표본 감사」를 열었음 — 두 탭은 지금까지 실제로 열어 보지 않은 채 통과로 적혔음',
      cause='Playwright 의 has_text 는 부분 일치', evidence='10/8 버튼 체크 도구(btn_bo.py)를 만들며 발견 — 탭 41개 가운데 이름이 다른 탭 이름에 들어 있는 것 2개',
      fix='10/8 — 탭 · 하위 탭을 순서 번호로 누르게 고침. 두 탭을 포함해 다시 돌림(오류 0)', file='qa/crawl_admin_final.py'),
 dict(no='G-202', kind='시험 도구', area='시험 도구 · 시안 그림 비교', sev='하', open=False,
      what='시안 그림 비교(proto_pixel.py)가 다른 시험과 같이 돌 때 한 장(운영 「회원」 화면)의 오른쪽 끝 3점을 다르게 찍음 — 같은 두 파일을 혼자 돌리면 194장 모두 같음',
      cause='부하 중 그리기 시점 차이(같은 화면을 이어서 세 번 찍으면 두 번은 같고 한 번은 다름)', evidence='10/8 확장 점검 — 버튼 체크와 같이 돈 실행 1 / 2 → 혼자 다시 2 / 2',
      fix='10/8 — 혼자 다시 돌려 통과 확인(final_all 의 _rerun 줄). 전수 검정 D 구간은 버튼 체크(E)와 겹치지 않게 돌림', file='qa/proto_pixel.py · qa/final_parts.sh'),
 # ── 제품 결함 ──
 dict(no='G-203', kind='제품 결함', area='DB · 금칙어 · 공격 점검', sev='하', open=True,
      what='금칙어 표(banned_words)에 「100% 성공」 줄이 422개 — 공격 점검(attack-check.sh G-02)이 돌 때마다 한 줄씩 더 넣음. 기준선(B900)에도 422줄이 들어가 새로 설치한 DB 에도 그대로. 운영 화면에서 같은 금칙어를 두 번 넣어도 「이미 등록된 금칙어입니다」가 나오지 않고 한 줄 더 들어감',
      cause='banned_words 에 유일 규칙이 id 하나뿐 — `ON CONFLICT DO NOTHING` 이 걸릴 충돌이 없음', evidence='10/8 v10.26 반영 중 발견 — select count(*) from banned_words where word=\'100% 성공\' → 422',
      fix='(권고) 같은 줄 정리 + 유일 규칙(말 · 맞춤 방식 · 관)', file='sgb/scripts/attack-check.sh:198 · sgb/src/modules/site/site.service.ts:274 · sgb/prisma/migrations/B900_reference_data'),
 dict(no='G-204', kind='시안', area='시안 · 소개몰 검색 자동완성', sev='하', open=True,
      what='시안의 검색 칸에서 ↓ 로 제안을 고르고 Enter 를 치면 고른 말이 아니라 친 글자로 검색됨(소개몰 본문의 Enter 처리가 먼저 돎). 같은 결함을 v10.26 사용자 웹 자동완성을 만들며 한 번 만들었다가 시험(site_opt W-13)이 잡음',
      cause='시안 — 자동완성의 키 처리가 본문 처리보다 뒤에 붙음 / 사용자 웹 — 바깥 누르기를 click 으로 봐서 Enter 가 만드는 검색 단추 click 이 목록을 먼저 닫음', evidence='10/8 proto_opt 1b · site_opt W-13',
      fix='(권고) 자동완성이 Enter 를 먼저 받음', file='sgb/spec/proto.html(hltSugBind) · sgb/site/src/components/health/SearchBox.tsx'),
 dict(no='G-205', kind='제품 결함', area='DB · 자금수탁 감시(INV-11)', sev='중', open=True,
      what='v10.26 의 교환 배송비 결제 표(hlt_exchange_fees)에 결제사 거래번호 칸(pg_tid)이 생겨 통합 검정 INV-11 · 공격 검정 D-02(「자금수탁 칸 전무」)가 걸림',
      cause='INV-11 의 예외가 소개몰 주문 결제(hlt_payments.pg_tid) 하나뿐 — 같은 성격의 새 결제 표를 예외에 넣지 않았음', evidence='10/8 v10.26 전수 검정 A — verify 288 / 1 · 공격 626 · 뚫림 1(v_inv11_violations = hlt_exchange_fees.pg_tid)',
      fix='(권고) 교환 배송비도 직판에서 회사가 판매자로서 받는 돈이라 같은 예외 — 표 · 칸 이름을 정확히', file='sgb/prisma/migrations/D027 · C850(v_inv11_violations)'),
 dict(no='G-206', kind='시안', area='시안 · 서버 연동 「재고 되돌리기」', sev='하', open=True,
      what='시안의 서버 연동 화면 「③ 취소 시 재고 되돌리기」(srvstk)가 v10.26 서버에서 주문하지 못함 — 옵션이 여럿인 상품에 옵션 없이 주문',
      cause='v10.26 서버는 옵션이 여럿인 상품의 주문에 옵션을 요구(OPTION_REQUIRED) · 시안의 연동 코드는 상품 코드만 보냄', evidence='10/8 v10.26 전수 검정 B — srv_proto 「TypeError: NoneType」(시연 결과 없음)',
      fix='(권고) 카드의 담기 옵션(cartOptionId)을 같이 보냄', file='sgb/spec/proto.html(stockLive)'),
 dict(no='G-207', kind='제품 결함', area='운영 화면 · 중개사 인증 심사', sev='하', open=True,
      what='「중개사 인증 심사」 목록의 심사 대기는 **오래된 것부터 200건까지만** 보임 — 대기가 200건을 넘으면 새 신청이 화면에 나오지 않고 쪽 넘김도 없음(개발 DB 에 시험 신청 202건이 쌓여 srv_lead_ui UI-4-1 이 새 신청을 찾지 못함)',
      cause='GET /admin/brokers?state=PENDING — ORDER BY created_at ASC LIMIT 200 · 화면에 다음 쪽 · 검색 없음 / 시험(srv_lead · srv_lead_ui)이 넣은 신청을 닫지 않아 대기가 쌓임',
      evidence='10/8 v10.26 전수 검정 B · 다시 돌림 — 두 번 모두 같은 자리에서 멈춤 · 개발 DB 심사 대기 202건(시험 계정 lbr* 175 · luibrk* 27)',
      fix='(권고) 목록에 쪽 넘김 또는 「최근 순」 · 검색. v10.26 에서는 시험이 넣은 신청을 끝에 반려로 닫게 고치고 쌓인 202건을 반려로 정리함(시험 쪽만)', file='sgb/src/modules/partner/broker.service.ts:50-64 · sgb/web/src/app/admin/Qualifications.tsx · qa/srv_lead.py · qa/srv_lead_ui.py'),
 dict(no='G-208', kind='제품 결함', area='서버 · 권한 표시(통합 검정)', sev='하', open=False,
      what='v10.26 의 새 운영 API 12개(/admin/health/products · ingredients · sale-categories)가 통합 검정(check:acl)에서 「공개 구역이 아닌데 표시가 없음」으로 걸려 npm run verify 가 종료 코드 1 — 실제로는 막혀 있음(로그인 없이 · 일반 회원 토큰으로 4곳을 불러 모두 403)',
      cause='클래스 전체 권한 @Roles 를 @Controller 위에 둠 — 다른 모든 컨트롤러는 아래에 두고, 검정 도구는 @Controller 아래의 @Roles 만 읽음', evidence='10/8 v10.26 다시 돌린 통합 검정(새 검정 DB) — 통과 289 · 뚫림 0 인데 종료 코드 1 · check:acl 「검토 필요 12건」',
      fix='v10.26 수정 — @Roles 를 @Controller 아래로(동작 같음) → check:acl 「공개 구역 외에는 전부 표시가 있습니다」 · 통합 검정 전체 통과', file='sgb/src/modules/health/health-admin.controller.ts:96-98 · sgb/scripts/check-acl.js:67-72'),
 dict(no='G-209', kind='제품 결함', area='약관 · 발행 스크립트', sev='중', open=False,
      what='약관을 처음 발행하는 길(scripts/publish-terms.sh — 로컬 설치 · 통합 검정 · 운영의 약관 발행 절차)이 초안 1.0 의 본문을 초안 생성기의 글(docs/terms/HLT_SALE.md)로 덮고 발행함 — 그 글에는 v10.26 의 교환 배송비 조항이 없어, 새로 설치한 DB 에서는 교환 배송비를 받는데 발행된 판매 약관에 근거가 없게 됨(통합 검정 DB 에서 확인: 발행 1.0 에 「교환 배송비 6,000원」 0곳)',
      cause='판매 약관의 글이 두 곳(DB 의 글 — C880 · D024 · D028 / 초안 생성기의 글 — gen-terms-draft.js)에 있고, 발행 스크립트는 초안 상태의 본문을 생성기의 글로 맞춤. D028 은 DB 의 글만 고침',
      evidence='10/8 Docker 쓰던 볼륨 확인 중 — 통합 검정 DB(sgb_check)의 HLT_SALE 1.0(발행) 본문에 교환 조항 없음 · 새 불변식 SV-T3 이 고치기 전 1(기대 0)',
      fix='v10.26 수정 — 초안 생성기의 판매 약관에 확정 문안과 같은 교환 배송비 조항(표 두 줄 · 교환 · 상품이 없을 때)을 넣음 · 새 불변식 SV-T3(발행 · 초안 판매 약관에 「교환 배송비 6,000원」) → 통합 검정 290 / 0. 두 글의 다른 문장(장 번호 · 「의료기기 · 건강기기」 등)은 그대로 — 문서 75 의 6절', file='sgb/scripts/gen-terms-draft.js:255-300 · sgb/scripts/publish-terms.sh:30-37 · sgb/scripts/verify-invariants.sh(SV-T3)'),
 dict(no='G-210', kind='시험 도구', area='통합 검정 · 검정 픽스처(fixture.sql)', sev='중', open=False,
      what='쓰던 검정 DB(PC 의 Docker 볼륨에 남은 sgb_check — v10.25 에서 ./dev.ps1 check 를 한 번이라도 돌린 경우)에서 v10.26 의 ./dev.ps1 check 가 실패 — SV-T3(교환 배송비 조항) 1건. 새로 만든 검정 DB 에서는 통과',
      cause='검정 픽스처가 약관을 1.0 만 남기고 다른 판을 지움(DELETE version <> 1.0) — 쓰던 검정 DB 에서는 1.0 이 이미 발행되어 D028 이 새 조항을 1.1 로 발행하는데, 픽스처가 그 1.1 을 지우고 옛 글의 1.0 을 다시 발행',
      evidence='10/8 Docker — 쓰던 볼륨에 v10.26 을 올린 뒤 ./dev.ps1 check 종료 코드 1(통과 289 / 실패 1 · SV-T3) · 재현: v10.25 판으로 만든 검정 DB → v10.26 마이그레이션 → 고치기 전 픽스처 SV-T3 = 1 · 고친 뒤 0',
      fix='v10.26 수정 — 픽스처가 다른 판을 지우기 전에 가장 새 판(시험 자리표시자 · 9.9 제외)의 본문을 1.0 에 옮김. 확인: Docker 검정 DB 를 v10.25 판 상태로 만든 뒤 ./dev.ps1 check — 적용 5 · 기존 70 · 통과 290 / 0 · 전체 통과', file='sgb/scripts/fixture.sql:80-92'),
 dict(no='G-211', kind='시험 도구', area='시험 도구 · Docker 실구동', sev='하', open=False,
      what='Docker(쓰던 볼륨)에서 시험 3묶음이 제품과 관계없이 걸림 — srv_opt T-1 · T-2(판매 약관 새 판 번호를 「1.2」로 박아 둠 — Docker 볼륨은 1.0 → 1.1) · fix_1026 G-177-3(검수 대기 건이 있는 DB 를 가정 — Docker DB 는 0건) · site_detail D-6(로그인 뒤 2.5초만 기다림 — Docker 의 개발 모드 사용자 웹은 로그인 처리가 2.45초)',
      cause='개발 DB 의 상태 · 속도를 가정한 시험', evidence='10/8 docker_1026.txt — srv_opt 89 / 91 · fix_1026 39 / 40 · site_detail 24 / 26(중간에 멈춤)',
      fix='v10.26 수정 — T-1/T-2 는 「발행된 판 = 가장 새 번호 · 나머지는 보관」 · G-177-3 은 대기 건이 없으면 시험용 1건을 넣었다가 지움 · 로그인은 쿠키가 생길 때까지 최대 15초. 다시 돌림: Docker 91 / 91 · 40 / 40 · 44 / 44 · 로컬 같은 결과', file='qa/srv_opt.py · qa/fix_1026.py · qa/site_detail.py'),
 dict(no='G-212', kind='제품 결함', area='DB · 기준 데이터(B900) · 백업/복원', sev='하', open=True,
      what='기준 데이터가 외래 키를 어긴 줄을 넣음 — 운영 설정 3줄(company.bank_account · bank_name · bank_holder)의 「바꾼 사람」이 없는 계정(시험 계정 1111…) · 광고 자리 1줄의 광고주 사업자가 없는 사업자. 그래서 DB 를 pg_dump 로 떠서 새 DB 에 부으면 외래 키 2개가 만들어지지 않음(오류 2줄 · 자료는 들어감). 9/30 서버를 흉내 낸 리허설 DB · 개발 DB · 검정 DB 모두 같음',
      cause='B900_reference_data 가 트리거를 내린 채(외래 키 검사 없음) 개발 DB 스냅숏의 줄을 그대로 넣음', evidence='10/8 v10.26 서버 적용 리허설 뒤 — 리허설 DB(sgb_aws)를 pg_dump → 새 DB 로 부을 때 ad_placements_advertiser_business_id_fkey · site_settings_updated_by_fkey 오류',
      fix='(결정 필요) 새 마이그레이션으로 없는 계정을 가리키는 「바꾼 사람」은 비우고(NULL) · 없는 사업자를 가리키는 광고 자리는 광고주를 비움 — 운영 DB 의 자료를 바꾸는 일이라 확인 뒤에. RDS 스냅숏 백업 · 복원에는 영향 없음', file='sgb/prisma/migrations/B900_reference_data/migration.sql:43 · :1509'),
 dict(no='G-173', kind='제품 결함', area='소개광장 · 서버 + 사용자 웹', sev='상', open=True, tags=[('db_link', 'C-6b'), ('flow', 'P3', 19)],
      what='글쓴이가 지운 글이 주소(/community/{id})를 알면 누구에게나 제목 · 본문 · 댓글까지 그대로 보임. 검수 중이라 남에게 안 보이던 글도 지우는 순간 공개됨',
      cause='글 상세 조회가 「가려진 글(HIDDEN)」 「검수 중(PENDING)」만 가리고 「지운 글(DELETED)」은 가리지 않음', evidence='db_link.py C-6b · flow_plaza.py P3-19 — 지운 글 주소가 200 으로 열리고 제목 · 본문이 보임. 목록 · 검색에서는 빠짐',
      fix='(권고) 지운 글은 「작성자가 지운 글입니다」 자리만 남기고 제목 · 본문을 내보내지 않음(댓글은 남김) — 서버 한 곳 + 사용자 웹 글 상세 한 곳', file='sgb/src/modules/community/community.service.ts:116-156 · sgb/site/src/app/community/[id]/page.tsx'),
 dict(no='G-177', kind='제품 결함', area='운영 화면 · 검수 큐', sev='상', open=True, tags=[('flow', 'T3', 6), ('flow', 'T3', 7), ('flow', 'T5', 5), ('flow', 'T5', 6)],
      what='운영 화면 「검수 큐」가 늘 「대기 중인 검수 건이 없습니다」로 보임 — 같은 때 서버는 대기 건을 돌려주고 있음. 운영자가 화면에서 매물 · 요청을 승인 · 반려할 수 없음(지금까지의 시험은 승인을 API 로 했음)',
      cause='화면은 응답의 items 를 읽는데 서버는 목록(배열)을 그대로 줌', evidence='flow_trade.py T3-6 · T5-5 — 화면 0건 · 같은 때 GET /admin/reviews 22건. 10/8 직접 확인: 응답이 배열 50건',
      fix='(권고) 화면이 배열을 읽게 한 줄 수정 + 화면에서 승인하는 시험 추가', file='sgb/web/src/app/admin/ReviewQueue.tsx:38-41 · sgb/src/modules/review/review.controller.ts:42'),
 dict(no='G-178', kind='제품 결함', area='운영 화면 · 신고 처리 · 이벤트 · 수집 관리', sev='상', open=True, tags=[('flow', 'T7', 6), ('link_check', 'A-12')],
      what='운영 화면 세 곳의 처리 단추가 눌러도 「처리하지 못했습니다」 — 「신고 처리」(처리 · 기각), 「이벤트」(상태 바꾸기 · 지급 처리), 「수집 관리」(쓰기 전부). 서버가 403 으로 거절함',
      cause='이 세 화면만 공용 호출 함수(api)를 거치지 않고 fetch 로 바로 보내 로그인 토큰(Authorization)이 빠짐', evidence='flow_trade.py T7-6(403) · link_check.py A-12(직접 fetch 5곳: ReportQueue.tsx:50 · Events.tsx:37, 51 · Collect.tsx:43) · 토큰 없는 요청 403 직접 확인',
      fix='(권고) 세 화면의 요청을 공용 함수로 바꿈 + 화면에서 처리하는 시험 추가', file='sgb/web/src/app/admin/ReportQueue.tsx · Events.tsx · Collect.tsx'),
 dict(no='G-182', kind='제품 결함', area='소개몰 · 주문서', sev='상', open=True, tags=[('flow', 'M5', 4), ('flow', 'M5', 5)],
      what='상품 상세의 「바로구매」로 주문한 뒤 결제 화면에서 「← 뒤로」를 누르면 주문서에 같은 상품이 다시 나오고, 거기서 결제 단추를 누르면 같은 주문이 하나 더 만들어짐(재고도 한 번 더 줄어듦)',
      cause='주문서가 화면이 들고 있던 장바구니 내용을 그대로 다시 보냄 · 서버는 같은 주문을 막지 않음(G-171)', evidence='flow_mall.py M5-4 · M5-5 — 두 번 실행 모두 재현(주문 2건 · 재고 28 → 26)',
      fix='(권고) 주문이 만들어진 뒤에는 주문서를 다시 그릴 때 장바구니를 새로 읽게 하고, 서버가 같은 요청 키의 주문을 한 번만 받게 함', file='sgb/site/src/components/health/CartAdd.tsx:35 · OrderForm.tsx:32-37 · site/src/app/health/order/pay/page.tsx:39'),
 dict(no='G-174', kind='제품 결함', area='외부 연동 · 결제 키 이름', sev='중', open=True, tags=[('link_check', 'D-3')],
      what='운영 화면 「외부 연동」과 설치 절차서(docs/26)는 결제 키 이름을 PG_SECRET_KEY 로 안내하는데 서버가 읽는 이름은 TOSS_SECRET_KEY — 안내대로 넣으면 결제가 계속 「시험 결제」로 남음',
      cause='연동 표의 키 이름(integrations.secret_key_name)이 어댑터를 만들기 전 값 그대로', evidence='link_check.py D-3 — 연동 7건 가운데 PG 만 불일치',
      fix='(권고) 새 마이그레이션으로 표의 값을 TOSS_SECRET_KEY 로 · 절차서 한 줄 수정', file='sgb/prisma/migrations/B900_reference_data · sgb/docs/26_환경설치절차서.md:236 · sgb/src/modules/billing/payment.provider.ts:543'),
 dict(no='G-179', kind='제품 결함', area='사용자 웹 · 결제 수단', sev='중', open=True, tags=[('flow', 'B1', 5)],
      what='결제 수단 화면(/my/payment)에서 카드를 등록해도 화면은 「등록된 결제 수단이 없습니다」 그대로 · 단추는 「처리 중…」에서 멈춤(DB 에는 등록됨)',
      cause='화면은 registered · brand · last4 를 읽는데 서버는 cardCompany · cardLast4 를 줌 · 성공 뒤 「처리 중」을 풀지 않음', evidence='flow_biz.py B1-5 · 소스 직접 확인',
      fix='(권고) 화면이 서버의 항목 이름을 읽게 맞춤', file='sgb/site/src/app/my/payment/page.tsx:10-11, 54 · site/src/components/PayMethod.tsx:34-37 · src/modules/billing/recurring.service.ts:146-153'),
 dict(no='G-180', kind='제품 결함', area='사용자 웹 · 소개 요청', sev='중', open=True, tags=[('flow', 'T5', 4)],
      what='소개 요청을 등록하면 곧바로 「없는 주소입니다」(404) 화면이 뜸 — 등록은 됐고 검수 대기 중인데 실패한 것처럼 보임',
      cause='등록 폼이 방금 만든 요청의 상세로 보내는데, 상세는 공개된 요청만 보여 줌', evidence='flow_trade.py T5-4 · 소스 직접 확인',
      fix='(권고) 등록 뒤 「접수했습니다 · 검수 뒤 공개됩니다」 안내로 보냄(또는 본인에게는 검수 중 상세를 보여 줌)', file='sgb/site/src/app/request/new/RequestForm.tsx:62 · src/modules/request/request.service.ts:66'),
 dict(no='G-181', kind='제품 결함', area='사용자 웹 · 기본 머리줄', sev='중', open=True,
      what='소개장터 · 안심소개 · 나의공간 등 기본 머리줄은 로그인한 뒤에도 「로그인 · 회원가입」을 그대로 보여 주고 「로그아웃」이 없음(소개광장 · 소개몰의 전용 머리줄에만 로그아웃이 있음)',
      cause='기본 머리줄이 로그인 상태를 보지 않고 늘 같은 링크를 그림', evidence='flow 점검 중 관찰(flow_trade · flow_biz) · 소스 직접 확인', fix='(권고) 기본 머리줄도 로그인 상태에 따라 「로그아웃」을 보여 줌',
      file='sgb/site/src/app/layout.tsx:51-52'),
 dict(no='G-183', kind='제품 결함', area='소개몰 · 취소', sev='중', open=True,
      what='결제 전 주문을 취소 신청한 뒤에도(운영 승인 전) 내 주문에 「결제하기」가 그대로 보이고 실제로 결제가 됨 — 그 뒤 승인되면 환불 처리',
      cause='결제 가능 여부를 주문 상태(PENDING)만 보고 정함 — 취소 신청이 걸려 있는지는 보지 않음', evidence='flow_mall.py 작성 중 관찰 · 10/8 직접 재현 — 주문 → 취소 신청(REQUESTED) → 결제 준비 · 승인이 201 로 되고 주문이 PAID → 그 뒤 운영 승인으로 취소 · 환불(28,000원) · 재고는 처음 값',
      fix='(권고) 취소 신청이 걸린 주문은 결제를 막음', file='sgb/site/src/components/health/MyHltNav.tsx:34 · src/modules/health/health-shop.service.ts:544'),
 dict(no='G-186', kind='제품 결함', area='운영 · 검수 큐 자료', sev='중', open=True,
      what='「사업자 인증」 탭에서 승인해도 그 사업자의 검수 큐 건이 「대기」로 남음 — 10/8 오전 기준 대기 건 1,216건 가운데 1,191건이 이미 승인된 사업자의 것(시험을 돌릴수록 늘어남). 검수 큐 「전체」는 오래된 50건만 주므로 진짜 대기 건(매물 · 요청)이 뒤로 밀림',
      cause='사업자 승인 처리가 검수 큐의 그 건을 닫지 않음', evidence='10/8 DB 직접 확인 — review_items QUEUED: BUSINESS 1,191(모두 verified_at 있음) · LISTING 3 · REQUEST 22',
      fix='(권고) 사업자 승인 때 그 검수 건도 함께 닫음 + 이미 쌓인 건 정리. G-177 을 고치면 화면에서 바로 드러나므로 같이 고쳐야 함', file='sgb/src/modules/identity/business.service.ts · src/modules/review'),
 dict(no='G-175', kind='제품 결함', area='광고 서버(sgb-ads · 아직 띄우지 않음)', sev='하', open=True, tags=[('link_check', 'C-6')],
      what='광고 서버가 본체에 물어볼 때 보내는 머리말 이름(X-Internal-Token)이 본체가 읽는 이름(X-Internal-Key)과 다름 — 광고 서버를 띄우면 성향 조회 · 사업자 실재 확인이 늘 거절돼 조용히 일반 광고로만 나감',
      cause='두 소스의 약속이 어긋남', evidence='link_check.py C-6 · 본체 쪽은 맞는 키로 200 확인(C-5)', fix='(권고) 광고 서버 쪽 머리말 이름 한 줄 수정', file='sgb-ads/src/core/core-api.ts:33 · sgb/src/core/internal-key.guard.ts'),
 dict(no='G-171', kind='제품 결함', area='소개몰 · 주문 생성', sev='하', open=True,
      what='주문 생성(POST /health/orders)은 화면이 요청 키(Idempotency-Key)를 보내지만 서버가 쓰지 않음 — 같은 키로 두 번 보내면 주문이 2건. 화면은 보내는 동안 단추를 꺼서 막음(G-182 의 경우는 못 막음)',
      cause='요청 키 장치는 결제 · 코드 발급 두 곳에만 붙어 있음', evidence='db_link.py E-3(같은 키 두 번 = 주문 2건) · E-3b · E-3c', fix='(권고) G-182 와 함께 — 주문 생성도 같은 키는 한 번만', file='sgb/src/modules/health/health-shop.controller.ts · src/core/idempotency.interceptor.ts'),
 dict(no='G-184', kind='제품 결함', area='소개몰 · 취소 화면 글', sev='하', open=True,
      what='결제하지 않은 주문의 취소 화면에 「결제 금액 · 환불 예정액」 표가 나옴(낸 돈이 없음) · 결제 전 취소가 승인된 뒤에도 내역의 환불 금액이 「확정 전」으로 남음',
      cause='취소 화면 · 내역이 결제 여부를 가리지 않음', evidence='flow_mall.py 작성 중 관찰', fix='(권고) 결제 전 주문은 환불 표를 그리지 않고 「결제 전 취소」로 적음', file='sgb/src/modules/health/health-shop.service.ts:303 · site/src/components/health/ReturnForm.tsx:100 · site/src/app/my/health/returns/page.tsx:59'),
 dict(no='G-185', kind='제품 결함', area='사용자 웹 · 날짜', sev='하', open=True,
      what='날짜가 하루 이르게 보이는 곳 2곳 — 파트너센터 「공지 · 알림」, 나의공간 「내 신고 내역」(한국 시각 0 ~ 9시에 생긴 것이 전날로 보임)',
      cause='시각 글자를 앞 10자만 잘라 씀(세계 표준시 기준) — v10.20 에서 고친 것(G-125 · G-126)과 같은 종류의 남은 곳', evidence='flow_plaza · flow_trade 작성 중 관찰(10/8 06시대 실행)', fix='(권고) 공용 날짜 함수(한국 시각)로 바꿈 · 같은 모양의 다른 곳 전수 확인',
      file='sgb/site/src/app/partner/notices/page.tsx:43 · site/src/app/my/reports'),
 dict(no='G-187', kind='제품 결함', area='운영 화면 · 외부 연동', sev='하', open=True,
      what='「외부 연동」의 발신 IP 칸을 비운 채 「전 연동에 반영」을 누르면 안내 없이 아무 일도 일어나지 않음', cause='빈 값이면 조용히 끝냄', evidence='btn_bo.py — 무반응(처리기 있음) · 소스 확인', fix='(권고) 「IP 를 적어 주십시오」 안내', file='sgb/web/src/app/admin/Integrations.tsx:49-50'),
 dict(no='G-172', kind='관찰', area='DB', sev='하', open=True,
      what='쓰지 않는 빈 표 public._t 가 처음 만든 틀(B040)에 남아 있음 — 행 0 · 어디서도 참조하지 않음', cause='틀을 뽑을 때 섞여 들어간 임시 표', evidence='db_link.py G-1 · G-1b', fix='(권고) 다음에 DB 를 바꿀 때 함께 지움(지금은 해가 없음)', file='sgb/prisma/migrations/B040_tables/migration.sql:56'),
 dict(no='G-176', kind='관찰', area='운영 화면 · 오픈 체크리스트', sev='하', open=True,
      what='운영 화면 「오픈 체크리스트」는 설정 · 약관 · 바닥줄 · 외부 연동만 보고 간주 모드(assume.*)는 보지 않음 — 간주는 쉘 점검(open-check.sh)과 「불변식」 탭이 봄. 중개사 자격 대조(국토부)는 외부 연동 7건 표에도 없음',
      cause='간주 모드를 따로 만든 뒤 체크리스트 뷰에 넣지 않음', evidence='link_check.py E-3b · E-3c', fix='(권고) 체크리스트에 「간주 모드 켜짐」 줄을 더함', file='DB 뷰 v_open_blockers'),
 # ── 빠진 기능(범위 · 결정) ──
 dict(no='G-188', kind='빠진 기능', area='사용자 웹 · 가입', sev='중', open=True, tags=[('flow', 'T1', 2)],
      what='가입 화면에 약관 동의 칸이 없음(약관 제목 링크만) — 가입 요청에 동의 값이 실리지 않음. 동의는 /terms/agree 화면에서만 기록됨(그 화면은 정상). 시안의 가입 4단계에는 전체 동의 · 필수 · 선택 칸이 있음',
      cause='실제 웹 가입은 한 화면짜리 — 시안의 4단계 가입(유형 · 정보 · 약관)이 아직 반영되지 않음', evidence='flow_trade.py T1-2', fix='(결정 필요) 가입 화면에 동의 칸을 넣을지 · 지금처럼 가입 뒤 동의 화면을 거치게 할지',
      file='sgb/site/src/app/signup/page.tsx:27 · spec/proto.html 가입 4단계'),
 dict(no='G-189', kind='빠진 기능', area='사용자 웹 · 구독', sev='상', open=True, tags=[('flow', 'B1', 4)],
      what='요금제 화면(/my/subscription · /upgrade)에 요금제를 골라 결제를 시작하는 단추가 없음 — 「결제 연동은 준비 중입니다(PG 계약 후)」 안내만. 서버의 구독 시작 API 는 있고 시험 결제로 동작함. 구독료가 유일한 매출원이므로 오픈 전에 꼭 필요',
      cause='결제사 계약 전이라 화면을 막아 둠(의도된 상태)', evidence='flow_biz.py B1-4 — 구독 시작은 API 로 이어 감(B1-7)', fix='(결정 필요) 결제사 계약 · 키 발급 뒤 화면을 엶 — 그때 화면으로 결제하는 흐름 시험을 붙임',
      file='sgb/site/src/app/my/subscription/page.tsx:55-84 · upgrade/page.tsx:37-53'),
 dict(no='G-190', kind='빠진 기능', area='제휴 · 주문 귀속', sev='중', open=True, tags=[('flow', 'B5', 12), ('flow', 'B5', 13), ('flow', 'B5', 14), ('flow', 'B5', 17)],
      what='제휴 소개링크로 들어와 소개몰에서 주문 · 결제해도 제휴 주문 · 수익이 기록되지 않음 — 화면은 「클릭 후 72시간 안에 주문하면 수수료」라고 안내. 클릭 기록까지만 됨',
      cause='제휴 주문 · 수익 표(partner_orders · partner_revenues)에 쓰는 서버 코드가 아직 없음', evidence='flow_biz.py B5-12 · B5-13', fix='(결정 필요) 귀속 기능을 만들지 · 그때까지 안내 글을 「준비 중」으로 바꿀지',
      file='sgb/src/modules/affiliate/affiliate.service.ts · src/modules/health/health-shop.service.ts'),
 dict(no='G-191', kind='빠진 기능', area='소개광장 · 글 신고', sev='중', open=True, tags=[('flow', 'P5', 2), ('flow', 'P5', 3), ('flow', 'P5', 4)],
      what='소개광장 글을 신고하는 길이 없음(글 상세에 신고 단추 없음 · 신고 API 가 글을 받지 않음) — 운영 화면은 「신고 3건이 쌓이면 자동으로 가려지고 여기로 옵니다」라고 안내. 시안의 글 상세에는 신고 단추가 있음',
      cause='신고 대상이 등록글 · 요청글 · 서비스 · 프로필 네 가지뿐', evidence='flow_plaza.py P5-2 ~ 4(건너뜀) — 가림 자체는 운영 API 로 확인(통과)', fix='(결정 필요) 글 신고를 만들지 · 운영 화면 안내 글을 고칠지',
      file='sgb/site/src/app/report/[targetType]/[targetId]/page.tsx:12 · src/modules/review/abuse.controller.ts:12'),
 dict(no='G-192', kind='빠진 기능', area='파트너센터', sev='중', open=True, tags=[('flow', 'B4', 13)],
      what='파트너센터에 다음 단계로 가는 수단이 빠져 있음 — ① 활동 지역 화면에 지역을 켜는 입력 · 저장이 없음(「최소 한 곳은 켜셔야 합니다」 안내만 · API 는 있음) ② 입점 신청으로 가는 단추가 없음 ③ 서비스 등록으로 가는 단추가 없음(주소를 직접 쳐야 함)',
      cause='화면이 표시까지만 만들어짐', evidence='flow_biz.py B4-13 · 작성 중 관찰', fix='(결정 필요) 실제 웹 디자인을 시안에 맞추는 작업(미뤄 둔 것)과 함께 넣을지', file='sgb/site/src/app/partner/regions/page.tsx · partner/page.tsx:30-40 · partner/services'),
 dict(no='G-193', kind='빠진 기능', area='사용자 웹 · 거래 흐름', sev='중', open=True,
      what='거래 흐름에서 화면으로 갈 수 없는 길 — ① 문의에서 거래를 만드는 단추가 없음(API 만) ② 매물 등록자가 받은 문의를 모아 보는 화면이 없음 ③ 「소개 내역」에서 성사 확정 · 대금 신고 · 후기로 가는 링크가 없음(주소를 직접 열어야 함) ④ 등록자가 자기 매물을 내리는 수단이 없음',
      cause='화면 사이 연결이 아직 덜 됨', evidence='flow_trade.py — T4-4 는 API 로, 확정 · 대금 · 후기는 주소를 직접 열어 진행(단계 이름에 적음)', fix='(결정 필요) 범위 · 순서',
      file='sgb/site/src/app/chat · my/deals · my/listings'),
 dict(no='G-194', kind='빠진 기능', area='운영 · 소개몰 발송', sev='하', open=True,
      what='운영 쪽에 소개몰 주문의 발송 처리(택배사 · 송장 · 배송 상태 입력) 화면 · API 가 없음 — 배송 상태는 DB 에 직접 넣어야 바뀜', cause='배송 기능은 v10.27 로 나눠 둔 범위', evidence='flow_mall.py M3 — 발송 · 배송 완료를 DB 로 넣어 이어 감(단계 이름에 적음)', fix='v10.27(배송 · 후기 · 문의 · 구매확정)에서', file='sgb/web/src/app/admin/HealthSettle.tsx'),
 dict(no='G-195', kind='빠진 기능', area='사용자 웹 · 나의공간', sev='하', open=True, tags=[('flow', 'T1', 8)],
      what='나의공간(/my) 첫 화면에 내 이름 · 요약이 없고 「관심 목록」으로 가는 카드도 없음(이름은 /my/account 에서만) — 시안은 프로필 · 요약 타일 4개 · 메뉴', cause='실제 웹 디자인을 시안에 맞추는 작업이 미뤄져 있음', evidence='flow_trade.py T1-8',
      fix='미뤄 둔 작업(나의공간 · 파트너센터 · 운영 화면을 시안에 맞추기)에서', file='sgb/site/src/app/my/page.tsx'),
 # ── 시안 ──
 dict(no='G-196', kind='시안', area='시안 · 나의공간', sev='중', open=True, tags=[('flow', 'S2', 17)],
      what='시안의 「설정 · 알림」 메뉴와 머리줄의 종(🔔)을 눌러도 알림 화면으로 가지 않고 안내 글만 뜸 — 알림 화면 자체는 시안 안에 있음', cause='그 화면으로 가는 연결이 빠짐', evidence='flow_proto.py S2-17', fix='(권고) 두 곳을 알림 화면에 연결',
      file='sgb/spec/proto.html:9546 · :5052 · :9797'),
 dict(no='G-197', kind='시안', area='시안 · 끊긴 링크', sev='중', open=True,
      what='시안에서 누르면 「페이지를 찾을 수 없습니다」가 되는 단추 9곳 — 메인 「소개뱅크 핵심」의 「AI로 찾고」 카드(메인 두 판 · 주소 #mh-q)와, 결제 수단 · 알림 · 한도 안내 · 소개 활동 화면 안의 링크 7곳(#mysub · #mypay · #mylst · #introact · #introinv). 지금까지의 전수 누르기는 이것을 「화면이 바뀜」으로 세어 드러나지 않았음',
      cause='가리키는 주소가 시안의 주소 표에 없음', evidence='proto_demo.py — 전수 누르기에 「없는 주소」 표식을 더해 다시 돌리고, 표식된 주소를 하나씩 직접 넣어 다시 확인(매트릭스 56 시트)', fix='(권고) 줄마다 맞는 화면으로 연결', file='sgb/spec/proto.html'),
 dict(no='G-198', kind='시안', area='시안 · 여는 길이 없는 화면', sev='중', open=True,
      what='시안 파일 안에 화면은 있는데 **어느 단추로도 · 주소로도 열리지 않는 화면** 이 있음 — 결제 수단 · 알림 · 한도 안내 · 사업자 전환 · 소개 활동 3장 · 후기 작성 · 운영의 메인 운영 4장 · 자동검수 규칙 · 표본 감사 · 외부 연동 · 코드 라벨 · 배지 검수 · 청구 현황 등(목록은 같은 시트)',
      cause='화면을 넣고 메뉴 · 주소 표에 잇지 않음(또는 다른 화면이 같은 주소를 먼저 가져감)', evidence='proto_demo.py — 단추로 닿지 않는 화면 가운데 시안의 주소 표로도 열리지 않는 것', fix='(권고) 메뉴에 잇거나, 쓰지 않는 화면이면 정리', file='sgb/spec/proto.html'),
 dict(no='G-199', kind='시안', area='시안 · 글 · 숫자', sev='하', open=True, tags=[('flow', 'S3', 11), ('flow', 'S7', 4), ('flow', 'S10', 11)],
      what='시안의 화면끼리 글 · 숫자가 맞지 않는 곳 — 개인 회원 안내(로그인 「가입 불가」 ↔ 가입 「가입 가능」) · 나의공간 건수(메뉴 9 ↔ 목록 6 · 17 ↔ 4) · 운영 대시보드 합계(1,842만원 ↔ 18,840,000원) · 소개몰 메인 카드 ↔ 상품 상세의 이름 · 정가 · 주문 번호의 날짜 ↔ 주문일 · 구독의 지난 날짜 · 약관 상태(발행 ↔ 미확정). 그리고 시안에 없는 화면: 구독 결제 화면 · 약관 전문 · 등록의 단계별 「다음」',
      cause='화면마다 견본 값을 따로 적음', evidence='flow_proto.py 작성 중 관찰 · S3-11 · S7-4 · S10-11(건너뜀 — 시안에 그 화면이 없음)', fix='(권고) 다음에 시안을 고칠 때 한 번에 맞춤', file='sgb/spec/proto.html'),
 dict(no='G-200', kind='시안', area='시안 · 시연', sev='하', open=True,
      what='시안에서 시연이 어색한 곳 — 내 등록 리스팅의 매물 이름 · 「수정」이 그 매물이 아니라 빈 새 등록 화면을 엶 · 가입 3 · 4단계가 필수 값 · 필수 약관 없이도 넘어감 · 취소 · 반품 내역의 상태가 영문(REQUESTED) · 처음 열면 창 제목이 「소개몰」',
      cause='시연용 단순 처리', evidence='flow_proto.py 작성 중 관찰', fix='(권고) 다음에 시안을 고칠 때', file='sgb/spec/proto.html'),
 # ── 관찰 ──
 dict(no='G-201', kind='관찰', area='사용자 웹 · 안내 글 · 길 안내', sev='하', open=True,
      what='흐름을 따라가다 눈에 띈 자잘한 것 — 대금 신고 뒤 안내가 이미 확정된 거래에 「상대방이 확인하면 계약서 서명으로…」 · 사업자 신청 뒤 /my/business 가 다시 빈 폼(「심사 중」 표시 없음) · 검수 큐 거르개가 관 이름 대신 코드(MNY …) · 신고 화면의 「내 등록에서 직접 비공개로」 안내와 달리 그 수단이 없음 · 본인인증 화면의 「돌아가기」가 주문서가 아니라 첫 화면으로 · 결제 화면에 내 주문으로 가는 링크 없음 · 파트너센터 열람 기한에 영문 AM 이 섞임 · 운영 API 의 글 가림이 사유가 비면 201 에 ok:false · 글쓴이 본인이 열어도 조회 수가 오름 · /register 첫 화면이 등록할 업종이 없는 갈래를 먼저 고름 · /biz/register 는 사업자 등록이 아니라 소개창업 매물 등록',
      cause='-', evidence='flow_trade · flow_mall · flow_plaza · flow_biz 작성 중 관찰(시험 단계로는 넣지 않음)', fix='(권고) 실제 웹 화면을 손볼 때 함께', file='여러 곳 — 문서 74 의 표'),
]
# ── v10.26(2026-10-08) — 제품 결함 상 · 중 10건을 고침. 시험(fix_1026.py)을 먼저 만들어 실패를 본 뒤 고쳤고, 흐름 시험의 그 단계도 통과로 바뀜 ──
FIXED = {
 'G-205': 'v10.26 수정 — 마이그레이션 D030: v_inv11_violations 의 예외에 hlt_exchange_fees.pg_tid 한 줄(감시는 그대로). 확인: verify INV-11 · 공격 D-02 다시 돌림',
 'G-206': 'v10.26 수정 — 시안 stockLive 가 cartOptionId 를 보냄(proto_patch_1026.py). 확인: srv_proto 다시 돌림',
 'G-203': 'v10.26 수정 — 마이그레이션 D029: 같은 금칙어 줄 정리(422 → 1) + 유일 규칙 uq_banned_words_rule(말의 앞뒤 공백 · 대소문자 무시 · 맞춤 방식 · 관). 공격 점검을 여러 번 돌려도 늘지 않고, 운영 화면의 같은 금칙어는 409 「이미 등록된 금칙어입니다」. 확인: fix_1026 G-203-1 ~ 3',
 'G-204': 'v10.26 수정 — 시안: 자동완성의 키 처리를 잡는 단계(capture)로 · 고르면 바로 검색 / 사용자 웹: 바깥 누르기를 pointerdown 으로. 확인: proto_opt 1b · site_opt W-13',
 'G-173': 'v10.26 수정 — 지운 글은 서버가 제목 · 본문 · 글쓴이를 내보내지 않고 「작성자가 지운 글입니다」 표시와 댓글만 줌(조회 수도 올리지 않음) · 사용자 웹 글 상세는 「지운 글」 자리와 읽기 전용 댓글을 그림. 확인: fix_1026 G-173-0 ~ 5 · db_link C-6b · flow_plaza P3-19',
 'G-177': 'v10.26 수정 — 검수 큐 응답을 화면이 읽는 모양({items, nextCursor})으로 맞춤(50건씩 · 다음 쪽 표시). 확인: fix_1026 G-177-1 ~ 3(화면에서 승인) · flow_trade T3-6 · 7 · T5-5 · 6',
 'G-178': 'v10.26 수정 — 신고 처리 · 이벤트 · 수집 관리의 요청 5곳을 공용 호출 함수(api)로 바꿔 로그인 토큰이 실림. 운영 화면의 직접 fetch 0곳. 확인: fix_1026 G-178-1 ~ 4 · flow_trade T7-6 · link_check A-12',
 'G-182': 'v10.26 수정 — 주문서의 주문은 서버가 같은 거래 안에서 내 장바구니와 견줘 비우고(품목 · 수량이 다르면 409 「장바구니가 바뀌었습니다」), 주문서는 열릴 때 지금 장바구니를 다시 읽음 → 「← 뒤로」 · 브라우저 뒤로 가기 뒤에 같은 주문이 또 만들어지지 않음. 확인: fix_1026 G-182-1 ~ 8 · flow_mall M5-4 · 5',
 'G-174': 'v10.26 수정 — 마이그레이션 D026 이 연동 표의 결제 키 이름을 TOSS_SECRET_KEY 로 고침 · 설치 절차서(docs/26) 한 줄 수정. 확인: fix_1026 G-174-1 · 2 · link_check D-3',
 'G-179': 'v10.26 수정 — 결제 수단 화면이 서버의 항목 이름(cardCompany · cardLast4)을 읽고, 등록 뒤 「처리 중」을 풂. 확인: flow_biz B1-5',
 'G-180': 'v10.26 수정 — 소개 요청 등록 뒤 공개된 요청이면 상세로, 검수 대기면 「접수했습니다 · 검수 뒤 공개됩니다」 안내(소개받기 목록 · 나의공간 링크)로 보냄. 확인: flow_trade T5-4',
 'G-181': 'v10.26 수정 — 기본 머리줄이 로그인 상태를 보고 「로그아웃」을 보여 줌(로그인 전에는 로그인 · 회원가입). 확인: fix_1026 G-181-1 ~ 3',
 'G-183': 'v10.26 수정 — 취소 신청이 걸린 주문은 결제 준비 · 승인을 409 로 막고, 내 주문 · 결제 화면은 「취소 신청 중」을 보여 주며 결제하기 · 주문취소 단추를 숨김. 확인: fix_1026 G-183-0 ~ 5',
 'G-186': 'v10.26 수정 — 사업자 승인이 같은 거래에서 그 검수 건을 닫음 · 마이그레이션 D026 이 이미 쌓인 건을 정리(개발 DB 1,193건). 확인: fix_1026 G-186-0 ~ 2',
}

# ── v10.27(2026-10-09 · 결함 수정판 — 10/8 「결함은 전체 수정」) — 열린 결함을 고침. 시험(fix_1027 · fix_1027b · fix_1027b_ui · fix_1027_proto)을 먼저 만들어 실패를 본 뒤 고침
F.append(dict(no='G-213', kind='제품 결함', area='API · 거래(대금 신고 · 계약)', sev='상', open=False,
      what='거래 당사자가 아니어도 본인인증만 된 회원이면 남의 거래에 대금 지급 신고를 남기고 상태를 「대금 신고됨」으로 바꿀 수 있었음 · 계약 상태 · 계약 이력(당사자 실명) · 전자서명 상태를 거래 번호만 알면 볼 수 있었음 · 사업자는 남의 거래에 계약서를 발급할 수 있었음',
      cause='deal.service 의 reportPayment · contractState · contractHistory · esignStatus · issueContract 에 당사자 확인이 없었음(confirmDeal · sign 에는 있음)',
      evidence='fix_1027b.py G-213-1 ~ 5(고치기 전 201 · 200 → 고친 뒤 403)', fix='', file='sgb/src/modules/deal/deal.service.ts'))
F.append(dict(no='G-214', kind='빠진 기능', area='약관 · 선택 동의 바꾸기', sev='중', open=True,
      what='선택 약관(마케팅 수신 · 맞춤형 광고 · 야간 광고)은 「언제든 바꿀 수 있다」고 안내하지만 바꿀 길이 없음 — 동의 기록(term_agreements)이 약관 판마다 한 줄 · 고칠 수 없는 줄(trg_term_agr_ro)이라 같은 판의 동의 여부를 다시 적을 수 없음',
      cause='동의 기록이 「현재 상태」 한 줄로 설계됨(uq_term_agreement · 바꾸기 막음). 바꿀 때마다 한 줄 더 쌓는 이력이 아님',
      evidence='flow_trade T1(10/9) — 가입 때 남긴 동의를 「약관 동의」 화면에서 다시 보내면 409 → v10.27 에서 같은 값은 다시 쓰지 않게 고침(G-216) · 다른 값은 CONSENT_ALREADY_RECORDED 로 안내',
      fix='(10/9 결정 — v10.28 에서 고침) 동의 기록을 이력(바꿀 때마다 한 줄)으로 바꾸고 읽는 곳(약관 동의 상태 · AI 동의 확인 · 광고 대상 · 야간 광고)을 「가장 최근 줄」로', file='sgb/src/modules/catalog/compliance.service.ts · term_agreements'))
F.append(dict(no='G-215', kind='제품 결함', area='한국 날짜(G-127 남은 곳)', sev='중', open=False,
      what='제휴 「오늘 클릭」이 한국 0 ~ 9시에 0으로 보였음(클릭 집계는 한국 날짜로 쌓는데 「오늘」은 UTC 날짜로 셈) · 광고 게재 기간(시작 · 끝 날짜) · 등기 서류 경과일 · 판매자 자격 만료도 같은 식으로 9시간 어긋남',
      cause='SQL 의 current_date(DB 는 UTC)를 한국 날짜 값과 견줌 — D033(v10.27)에서 쌓는 쪽만 한국 날짜로 바꿈',
      evidence='flow_biz B5(10/9 00시) — 「1 / 1」이어야 할 클릭이 「0 / 1」 · 고친 뒤 77/77 · fix_1027b G-127-4', fix='', file='affiliate · ads · realty · health-shop service'))
F.append(dict(no='G-216', kind='제품 결함', area='약관 동의 화면', sev='중', open=False,
      what='가입 때 약관 동의를 남긴 회원(v10.27 G-188)이 「약관 동의」 화면에서 「동의하고 계속」을 누르면 409(「이 기록은 수정하거나 삭제할 수 없습니다」)',
      cause='동의 저장이 ON CONFLICT DO UPDATE 였는데 동의 기록은 고칠 수 없는 줄(trg_term_agr_ro)', evidence='flow_trade T1 s5(10/9) · 고친 뒤 91/91', fix='', file='sgb/src/modules/catalog/compliance.service.ts'))
F.append(dict(no='G-221', kind='제품 결함', area='약관 · 마이그레이션 D041 · D042', sev='중', open=False,
      what='D041(약관 한 벌)이 위탁(OUTSOURCE)의 옛 「동의」 글을 담고 있어, D042(위탁 = 알림)를 적용한 DB 에서 D041 을 다시 돌리면 위탁 1.2 를 옛 「동의」 글 · 알림 아님으로 새로 발행했음(동의 목록 · 가입 동의에 위탁이 다시 나타남)',
      cause='G-218 반영 때 D042 만 더하고, 같은 판 안의 D041 에 남은 위탁 글을 빼지 않음 — D041 은 「같은 글이면 건너뜀」이라 다시 돌려도 안전해야 하는데 D042 뒤에는 글이 달라짐',
      evidence='fix_1028 G-8(D041 다시 돌리기) 뒤 I-1 ~ I-12 · fix_1028_ui H 실패 — 개발 DB 위탁 1.2 = 동의 글 · is_notice false',
      fix='v10.28 안(배포 전)에서 D041 의 위탁 줄을 뺌(위탁은 D042 가 맞춤) · 개발 · 검정 DB 의 기록값(checksum) 맞춤 · 개발 DB 는 D042 를 다시 적용해 1.3(알림)으로 바로잡음(1.2 와 그 기록은 보관). 확인: fix_1028 120/120(G-8 뒤 I 전부 통과)',
      file='sgb/prisma/migrations/D041_terms_single_text/migration.sql'))
F.append(dict(no='G-222', kind='제품 결함', area='사용자 웹 · 수화(#418)', sev='중', open=False,
      what='v10.28 에 새로 만든 화면 조각 4곳이 날짜 · 시각을 toLocaleString/DateString(\'ko-KR\') 로 그려, 서버(Node)는 「PM 12:35」 · 브라우저는 「오후 12:35」가 되어 「약관 동의」 화면(선택 항목 바꾸기의 「마지막으로 바꾼 때」)에서 수화 오류 #418 이 매번 남(가입 직후 · 화면이 한 번 다시 그려짐)',
      cause='v10.27 G-201 규칙(lib/format 의 dtKst · ymdKst 를 씀)을 새 조각(OptionalConsents · ConfirmButton · ReviewPanels · ShopMain)에서 지키지 않음',
      evidence='flow_trade T1 16(두 번 모두 /terms/agree · args=text) · flow_mall M3 17 · Node 「2026. 10. 9. PM 12:35:12」 ↔ Chromium 「… 오후 12:35:12」 실측',
      fix='v10.28 수정 — 4곳 모두 dtKst · ymdKst 로 · 같은 실수를 막는 소스 검사(fix_1028 H-3 — 사용자 웹에서 날짜를 toLocale… 로 그리는 곳 0) · flow 의 쪽 오류에 주소를 붙임. 확인: flow_trade 91/91 · flow_mall · fix_1028 H-3',
      file='site/src/app/terms/agree/OptionalConsents.tsx · components/health/ConfirmButton.tsx · ReviewPanels.tsx · components/shop/ShopMain.tsx'))
F.append(dict(no='G-223', kind='시험 결함', area='통합 검정 픽스처 · 쓰던 검정 DB', sev='중', open=False,
      what='쓰던 검정 DB(Docker 볼륨의 sgb_check)에서 통합 검정 픽스처가 약관 판을 1.0 하나로 줄이며 본문만 옮겨, 위탁 1.0 이 「알림」 글인데 알림이 아닌 판으로 발행됨 → SV-T7 실패 · 공격 검정 AD-04 가 대상이 없어 「뚫림」(PowerShell check · realcheck 의 통합 검정)',
      cause='G-210(v10.26)의 「다음 판 본문을 1.0 에 옮김」이 v10.28 의 새 칸(is_notice · 제목)을 옮기지 않음 — 새로 만든 검정 DB 에서는 D042 가 초안 1.0 에 표시해 드러나지 않음',
      evidence='ps_chain check rc=1 · dev.sh check — SV-T7 기대 0 / 실제 1 · ▲뚫림 AD-04 · Docker sgb_check 의 위탁 1.0 = 알림 글 · is_notice false',
      fix='v10.28 수정 — 픽스처가 본문과 함께 알림 표시 · 제목을 옮기고, 「알림」 글인 위탁 판을 알림으로 표시. 확인: dev.sh check 통과 304 / 0 · 뚫림 0 · PowerShell check rc=0 · 새 검정 DB verify 304 / 0',
      file='sgb/scripts/fixture.sql'))
FIXED.update({
 'G-212': 'v10.27 수정 — 마이그레이션 D031 이 없는 계정 · 사업자를 가리키던 4줄을 비움(NULL). 확인: fix_1027 G-212-1 · 2(한 칸짜리 외래 키 전부 위반 0)',
 'G-172': 'v10.27 수정 — D031 이 빈 표 public._t 를 지움. 확인: fix_1027 G-172',
 'G-176': 'v10.27 수정 — D031: 오픈 체크리스트(v_open_blockers)에 「간주 모드 켜짐」 줄 · 외부 연동 표에 국토부 중개사 자격 대조(BROKER). 운영 화면 라벨. 확인: fix_1027 G-176-1 ~ 3 · verify INTG(8종 · 차단 4)',
 'G-175': 'v10.27 수정 — 광고 서버가 본체를 부를 때 머리말 X-Internal-Key. 확인: fix_1027 G-175',
 'G-171': 'v10.27 수정 — 주문 생성에 선택형 요청 키 장치(키가 오면 같은 키의 두 번째 요청은 처음 응답 · 없으면 예전처럼). 확인: fix_1027 G-171',
 'G-184': 'v10.27 수정 — 결제 전 취소는 「환불 없음 — 낸 돈이 없습니다」(반품 신청 화면 · 내역). 확인: fix_1027 G-184',
 'G-185': 'v10.27 수정 — 날짜를 한국 날짜로(ymdKst · 14개 화면) · 시각은 24시간 「2026-10-08 20:05」(dtKst · 22개 화면 — 서버가 그릴 때 영문 AM/PM 이 섞이던 것 포함). 확인: fix_1027b_ui G-201-g · site_tz',
 'G-187': 'v10.27 수정 — 운영 「외부 연동」 발신 IP 를 비우고 저장하면 안내 글. 확인: btn_bo',
 'G-188': 'v10.27 수정 — 가입 화면에 약관 동의(전체 · 필수 · 선택 · 발행 약관 9종) · 서버가 필수 누락 422 · 약관마다 동의/거부 기록. 확인: fix_1027b G-188-1 ~ 7 · fix_1027b_ui G-188-U1 ~ U5',
 'G-189': 'v10.27 수정(10/8 답 ③) — 유료 구독 중 요금제 바꾸기 = 다음 결제일부터 예약(올리기 · 내리기 모두 · 지금 결제 없음) · 처음 유료는 지금 결제 · 예약 거두기 · 정기결제가 예약 요금제 값으로 청구하고 결제되면 바꿈 · 베이직 예약은 기간 끝에 무료로(마이그레이션 D032). 실제 웹 요금제 고르기 · 결제 패널 · 시안 ③. 확인: fix_1027b G-189-1 ~ 11 · fix_1027b_ui G-189-U1 ~ U9 · fix_1027_proto G-189-P1 · P2',
 'G-190': 'v10.27 수정 — 제휴 링크를 누른 방문자(해시만) → 72시간 안 소개몰 주문에 귀속 · 결제되면 제휴 주문 · 수익 · 취소 · 반품이면 회수(D031). 확인: fix_1027 G-190',
 'G-191': 'v10.27 수정 — 소개광장 글 신고(글 상세의 「신고」 · 대상 POST) · 자기 글 신고 불가 · 서로 다른 회원 3명이면 가림(D031). 확인: fix_1027 G-191',
 'G-192': 'v10.27 수정 — 파트너 서비스 지역 켜고 끄기 · 더하기 · 저장 · 서비스 화면의 단추 줄. 확인: btn_site',
 'G-193': 'v10.27 수정 — 받은 문의 · 보낸 문의(/my/inquiries · 이름 첫 글자만 · 안 읽음) · 대화방 · 「계약서 요청하기」(진행 중인 거래는 하나) · 내 거래의 다음 단계 단추 · 매물 내리기(ARCHIVED) · 다시 올리기 = 수정 → 재검수. 확인: fix_1027b G-193 · fix_1027b_ui G-193-U1 ~ U15',
 'G-195': 'v10.27 수정 — 나의공간 첫 화면(시안 scMy): 프로필 · 요약 4칸 · 바로가기(숫자) · 정산 안내(/me/home). 확인: fix_1027b G-195 · fix_1027b_ui G-195-U1 ~ U4',
 'G-196': 'v10.27 수정 — 시안 머리줄 종 · 「설정 · 알림」 → 알림 센터. 확인: fix_1027_proto G-196-1 · 2',
 'G-197': 'v10.27 수정 — 시안 「#화면키」 링크는 그 화면으로 · 검색 칸 링크는 그 칸으로. 확인: fix_1027_proto G-197(9곳)',
 'G-198': 'v10.27 수정 — 시안의 열 수 없던 화면 19장에 주소 · 나의공간 바로가기 · 운영 대시보드 「다른 운영 화면」 · 소개 내역 「후기 쓰기」. 확인: fix_1027_proto G-198-1 ~ 5',
 'G-199': 'v10.27 수정 — 시안 개인 회원 가입 안내 · 메뉴 숫자 = 목록 건수 · 정산 합계 · 약관 상태 「발행」 + 약관 전문 화면 · 견본 주문번호 날짜 = 주문일 · 소개몰 메인 카드 = 실제 상품 값(10/8 답). 확인: fix_1027_proto G-199-1 ~ 9 · proto_mall R-1',
 'G-200': 'v10.27 수정 — 시안 매물 「수정」 = 그 매물 · 가입 3 · 4단계 확인 · 반품 상태 한국어 · 처음 창 제목. 확인: fix_1027_proto G-200-a ~ d',
 'G-201': 'v10.27 수정 — 11건: 확정된 거래의 대금 신고 안내 · 사업자 신청 뒤 「심사 중」 · 검수 큐 관 이름 · 신고 화면 안내(내리기 생김) · 본인인증 「돌아가기」(?next=) · 결제 화면 → 내 주문 · 영문 AM/PM · 글 가림 422/404 · 글쓴이 본인 조회 제외 · /register 첫 갈래 · /biz/register 안내. 확인: fix_1027b G-201 · fix_1027b_ui G-201-*',
 'G-207': 'v10.27 수정 — 중개사 심사 목록 쪽 넘김(50건) · 찾기 · 순서(심사 대기는 오래된 순). 확인: fix_1027 G-207',
 'G-213': 'v10.27 수정 — 대금 신고 · 계약 상태 · 이력 · 전자서명 상태 · 계약서 발급에 당사자 확인(403 NOT_PARTY). 확인: fix_1027b G-213-1 ~ 5',
})
FIXED.update({
 'G-215': 'v10.27 수정 — 「오늘」 · 기간 비교를 한국 날짜((now() AT TIME ZONE \'Asia/Seoul\')::date)로. 확인: flow_biz B5 · fix_1027b G-127-4',
 'G-216': 'v10.27 수정 — 이미 기록된 같은 동의는 다시 쓰지 않음(unchanged) · 다른 값은 CONSENT_ALREADY_RECORDED 안내(G-214). 확인: flow_trade T1',
})
# ── v10.28(2026-10-09 · 두 묶음 한 판 — (가) 소개몰 배송 · 구매확정 · 리뷰 · 문의 · 순위 · G-214 · (나) 약관 발행 · 상담 이메일 · 개인 소개비 정산) ──
F.append(dict(no='G-217', kind='제품 결함', area='약관 · 발행 글', sev='상', open=False,
      what='킷 안에 약관 글이 두 벌 — 초안 생성기의 글(docs/terms · 법률 문체)과 DB 의 글(C880 · 쉬운 말 · 개발 DB 에 발행 · 작업 지시서 3절의 조항 번호가 맞는 쪽). 판매 약관 말고는 모두 달랐고, 운영 서버에서 처음 발행하면 publish-terms.sh 가 초안 본문을 생성기의 글로 덮어 **검토한 글과 다른 글**이 발행될 뻔함. 상담 신청 동의 문구의 항목 이름(「휴대폰」)도 처리방침(「휴대폰 번호」)과 달랐음',
      cause='생성기(gen-terms-draft.js)와 마이그레이션(C880)이 각자 글을 가짐 · 둘을 대조하는 검사가 없었음(판매 약관만 v10.27 에 맞춤)',
      evidence='10/9 비교표 5절(생성기 ↔ DB 대조) · scripts/publish-terms.sh 32 ~ 35줄 · 통합 검정 DB(sgb_check) 의 발행 본문 = 생성기의 글',
      fix='v10.28 수정(10/9 답 「DB 의 글 + 지시서 3절」) — 글을 scripts/terms-text.js 하나로(생성기 · docs/terms 같은 글) · D041: 초안은 본문만 고치고 발행된 DB 는 다음 판 발행(바뀐 점 change_note · 재동의) · 통합 검정 SV-T5(발행 · 초안 본문 = docs 9종) · SV-T6(옛 이름) · 처리방침 보호책임자 전화(법정 고지 값) · 상담 동의 문구 「휴대폰 번호」 · 발행 스크립트 기본 9종. 확인: fix_1028 G-1 ~ G-8 · F-8 · verify 300/0',
      file='sgb/scripts/terms-text.js · gen-terms-draft.js · publish-terms.sh · verify-invariants.sh · prisma/migrations/D041_terms_single_text'))
F.append(dict(no='G-218', kind='결정 필요', area='약관 · 개인정보 처리업무 위탁', sev='중', open=False,
      what='위탁 약관(OUTSOURCE)의 DB 의 글은 제목이 「개인정보 처리 위탁 **동의**」이고 제4조가 「동의를 거부할 권리 — 거부하시면 가입 · 이용이 어렵습니다」로 적혀 있음. 처리 위탁은 보통 동의가 아니라 **알리는 사항**(공개 · 고지)이라, 거부하면 가입을 못 하는 「동의」로 적는 것이 맞는지 확인이 필요함(생성기의 글은 「동의를 받는 사항이 아니라 알려 드리는 사항」으로 적혀 있었음)',
      cause='지시서 3절이 위탁을 「수정 없음」으로 두어, 10/9 결정(DB 의 글 그대로)에 따라 DB 의 글을 한 벌로 삼음',
      evidence='docs/terms/OUTSOURCE.md · 약관 표의 is_required = false(필수 아님)인데 글은 「거부하면 이용이 어렵다」',
      fix='10/9 답 「알림으로」 → v10.28 반영 — 글: 「개인정보 처리 위탁 안내」 · 「이 글은 알림입니다(동의 받는 항목 아님 · 개인정보 보호법 제26조)」 · 제4조 「동의를 거부할 권리」 → 「알림」 · '
          'DB: terms.is_notice(D042) · 발행 판을 새 번호(1.1)의 알림으로(1.0 과 그 동의 기록은 그대로 보관) · 알림 판에 동의 기록을 막는 트리거 · '
          '서버: 동의 목록(/terms/required) · 가입 동의에서 뺌 · 동의를 보내면 422 NOTICE_ONLY · 약관 목록 · 전문에 isNotice · '
          '화면: 가입 · 약관 동의 · 선택 항목에 동의 칸 없음 → 「알림」 링크 한 줄 · 약관 목록 · 전문에 「알림」 · 시안 이용안내 · 약관 전문 · 가입 4단계 · 재동의 화면. '
          '확인: fix_1028 I 14/14 · fix_1028_ui H 7/7 · fix_1028_proto H-32 ~ H-35 · verify SV-T7 ~ T9 · attack AD-04. 법령 문구는 시행 전 법률 검토로 한 번 더 확인',
      file='sgb/scripts/terms-text.js(OUTSOURCE) · sgb/docs/terms/OUTSOURCE.md · prisma/migrations/D042_terms_outsource_notice · compliance.service.ts · auth.service.ts · site NoticeTerms'))
F.append(dict(no='G-219', kind='시험 결함', area='통합 검정 픽스처', sev='하', open=False,
      what='통합 검정 픽스처가 약관 본문의 〔시행일〕을 to_char(…, \'YYYY년 M월 D일\') 로 채워 「2026년 M월 4일」이 박혔음(M 은 형식 글자가 아니고 D 는 요일 번호) — 검정 DB 의 판매 약관 발행 본문에 남아 있었음',
      cause='Postgres 날짜 형식 글자를 잘못 씀', evidence='SV-T5 HLT_SALE(검정 DB 1건 다름) · 본문 끝줄', fix='v10.28 수정 — 형식 \'YYYY"년" FMMM"월" FMDD"일"\' · 이미 박힌 것도 바로잡음 · 픽스처를 다시 돌리지 않는 쓰던 개발 DB(처음 설치 때 local-setup.sh 가 픽스처를 돌린 PC 의 Docker 볼륨)는 D043 이 발행 약관의 시행일 줄만 고침(10/9 Docker 검정 srv_mall K-5 로 찾음 · 보관된 판은 그대로). 확인: verify SV-T5 HLT_SALE · SV-T10 · docker srv_mall K-5',
      file='sgb/scripts/fixture.sql'))
F.append(dict(no='G-220', kind='제품 결함', area='운영 · 후기 검토 대기열', sev='중', open=False,
      what='후기 검토 대기열의 「다음 쪽」 표지(cursor)가 마감 시각을 밀리초까지만 담아, 같은 밀리초 안의 마이크로초가 다른 줄이 다음 쪽에서 빠지거나 겹칠 수 있었음 — 같은 시각인 줄이 여럿이면 순서도 정해지지 않았음',
      cause='표지를 JS Date(밀리초) 로 만들고 정렬에 줄 번호(id)를 함께 쓰지 않음', evidence='fix_1026 G-177-2(쪽 넘김 합계가 전체 건수와 다름)',
      fix='v10.28 수정 — 표지 = 마감 시각(마이크로초) | 줄 번호 · (마감 시각, 줄 번호) 순 정렬 · 형식이 틀린 표지는 400 BAD_CURSOR. 확인: fix_1028 H-1 · H-2 · fix_1026 G-177-2',
      file='sgb/src/modules/review/review.repository.ts · review.service.ts'))
FIXED.update({
 'G-194': 'v10.28 수정 — 운영 「소개몰 주문」(SB-ADM-HOR-010): 택배사 고르기 · 송장 10 ~ 14자리 · 발송 처리 → 배송중 · 배송 완료로 · 배송중일 때만 송장 고침(새 기록 · 전 기록 남음) · 감사 기록 · 배송 완료 7일(청약철회 기간이 길면 그 기간) 뒤 자동 구매확정(D035 · hlt_auto_confirm). 확인: fix_1028 A 20/20 · fix_1028_ui A 6/6',
 'G-214': 'v10.28 수정 — 동의 기록을 이력으로(바꿀 때마다 한 줄 · 지우거나 고치지 않음 · D038) · 읽는 곳(약관 상태 · AI · 광고 · 마케팅/야간 감시)은 가장 최근 줄 · 감시는 보낸 시각의 동의 · 「선택 항목 바꾸기」 화면. 확인: fix_1028 D 10/10 · fix_1028_ui D 2/2',
})
FIXED_D = {
 'G-147': 'v10.26 상품 등록 · 수정(운영 「소개몰 상품」) · v10.28 배송 상태 입력(운영 「소개몰 주문」 · 발송 처리 · 배송 완료 · 송장 고침 · D035). 확인: fix_1028 A · fix_1028_ui A',
}
for f in F:
    if f['no'] in FIXED: f['open'] = False; f['fix'] = FIXED[f['no']]
    if f['no'] == 'G-194' and f['no'] not in FIXED:
        f['fix'] = '(v10.28 로 옮김 — 10/8 「v10.28 — 배송 · 구매확정 · 후기 · 문의 · 순위」)'
    if f['no'] == 'G-171' and f['no'] not in FIXED:
        f['what'] = '주문 생성(POST /health/orders)은 화면이 요청 키(Idempotency-Key)를 보내지만 서버가 쓰지 않음 — API 로 같은 본문을 두 번 보내면 주문이 2건. v10.26 부터 주문서(화면)의 주문은 장바구니 대조로 한 번만 만들어짐(G-182 수정) → 남은 것은 API 를 직접 부르는 경우뿐'
        f['fix'] = '(권고) 주문 생성에도 요청 키 장치를 붙임 — 화면 경로는 v10.26 에서 막혔으므로 급하지 않음'
p = f'{HERE}/defects.json'
d = json.load(open(p, encoding='utf8'))
by = {x['no']: i for i, x in enumerate(d)}
for f in F:
    row = {'no': f['no'], 'area': f['area'], 'sev': f['sev'], 'what': (OPEN if f['open'] else '') + f['what'], 'cause': f['cause'], 'evidence': f['evidence'], 'fix': f['fix'], 'file': f['file']}
    if f['no'] in by: d[by[f['no']]] = row
    else: d.append(row)

# v10.27 — 앞 판에서 열어 둔 G-116 (10/8 답 「세 화면에도 단추 삭제」)
for x in d:
    if x['no'] == 'G-120':
        x['what'] = x['what'].replace('(열려 있음 · 잠재) ', '(잠재) ')
        x['fix'] = 'v10.27 수정 — 정산 신청은 그 거래의 소개자만(403 NOT_PARTY) · 없는 거래 404(전에는 아무것도 만들지 않고 201) · 거래 번호는 uuid 만(400) · DB 규칙 D034(받는 사람 = 소개자 · INV-9R) · 공격 검정 C-00 의 받는 사람을 소개자로 바로잡음. 확인: fix_1027b G-120-1 ~ 4 · attack-check C-00'
    if x['no'] == 'G-130':
        x['what'] = x['what'].replace('(열려 있음 · 결정 필요) ', '')
        x['fix'] = 'v10.27 수정(10/8 답 「22건 모두 만듬」 · 10/9 「개발에도 반영」) — 시안: 새 화면 8장(사기 예방 가이드 · 공고 원문 · 광고주 랜딩 · 파트너사 상세 · 감사 기록 · 옮길 대상 · 계약서 양식 전문 · 택배사 조회) · 파트너 알림 「보기」 5건은 그 화면으로 · 시안만 있는 3장은 「개발중」 표시. 개발: 파트너사 상세(API · 운영 화면) · 파트너 알림 「보기」 · 계약서 양식 전문 · 사기 예방 가이드 · 택배사 조회. 확인: g130_check 19/19 · fix_1027c 20/20'
    if x['no'] == 'G-137':
        x['what'] = x['what'].replace('(열려 있음) ', '')
        x['fix'] = 'v10.27 수정(10/8 답 「지금 적용」 · 「코드로 그린 그림」) — 견본 그림 14칸을 분류마다 다른 그림으로(코드로 그림 · 글자 · 상표 · 배지 없음 · 원본 qa/g137/src). 확인: proto_pixel(G-137 그림이 보이는 11장) · 전후 그림'
    if x['no'] == 'G-114':
        x['fix'] = '(10/9 답 「지금은 가상으로 진행 · 키 받으면 추가」) 가상 결제사로 확인표 T-1 ~ T-10 확인 완료(srv_billing 103/103 · T-8 이미 취소된 결제 2-26 더함). 토스 테스트 키를 받으면 docs/62 9절의 순서대로 실제 확인 — 그 전에는 「수정 완료」로 보지 않음'
    if x['no'] == 'G-116':
        x['what'] = x['what'].replace(OPEN, '').replace('(열려 있음) ', '')
        x['fix'] = 'v10.27 수정(10/8 답 「세 화면에도 단추 삭제」) — 베스트매칭 · 사고예방 · 성공현황 위쪽 줄에서 소개하기 · 소개받고 싶어요 · 소개받기 칸을 뺌(급구 · 급매 · 상세와 같은 처리 · 줄은 한 칸). 확인: fix_1027_proto G-116(너비 1000 · 1280 · 1920) · proto_urg · proto_diff(바뀐 29장)'

for x in d:     # v10.28 — 앞 판의 결함 목록(defects.json)에만 있는 것
    if x['no'] in FIXED_D:
        x['what'] = x['what'].replace('(열려 있음) ', '').replace(OPEN, '')
        x['fix'] = FIXED_D[x['no']]
json.dump(d, open(p, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
json.dump(F, open(f'{HERE}/findings_r2.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
k = {}
for f in F: k[f['kind']] = k.get(f['kind'], 0) + 1
print(f"결함 목록 {len(d)}건 · 이번에 더한 것 {len(F)}건(" + ' · '.join(f'{a} {b}' for a, b in k.items()) + f") · 열려 있음 {sum(1 for f in F if f['open'])}건")
