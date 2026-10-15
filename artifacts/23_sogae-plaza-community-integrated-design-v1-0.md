# 소개뱅크 소개광장(커뮤니티) 통합 설계서 v1.0

Sep 28, 2026 · @박세호

## 0. 개요와 최종 결론

소개광장은 본사 콘텐츠 → 질문 → 답변 → 소개 성사로 이어지는, 소개뱅크 소개 흐름의 입구로 만듭니다. 기준은 분당·판교 1개 권역, 기존 회원 체계(Java/Spring Boot, Aurora DB)입니다.

1. **구조**: 대상을 "장소(우리동네)"와 "상품·서비스(이거 어때?)" 둘로 나누고, 글·답변·반응·설문은 하나의 공통 데이터 구조로 처리합니다. 메뉴는 10개가 넘어도 핵심 테이블은 9개(+보조 4개)로 충분합니다.
2. **알고리즘**: 초기에는 머신러닝이 아니라 규칙과 점수 공식으로 만듭니다. AI(대형 언어 모델)는 입력 해석과 문장 작성에만 쓰고, 무엇을 추천할지는 서버 점수 공식이 정합니다.
3. **오픈 순서**: 동네픽(본사 제작) → 소개해주세요 + AI 동네 추천 → 이거 어때?(설문형) → 같이해요. 같이해요는 오프라인 안전 위험이 가장 커서 마지막에 둡니다.

문서 성격: 권고안입니다. 가중치·기준값 등 숫자는 운영 전 추정 초기값이며, 법률 항목은 법무 확인이 필요합니다.

## 1. 기획안 보완 사항

원 기획안에서 그대로 만들면 문제가 되는 4가지와 권고안입니다.

| # | 원 기획 내용 | 문제 | 권고 |
| --- | --- | --- | --- |
| 1 | AI가 우리동네 데이터를 검색해 추천 리스트 작성 | AI가 일반 지식으로 답하면 없는 가게·폐업한 가게를 지어냄. 초기엔 데이터가 적어 위험이 더 큼 | 소개광장·소개뱅크 DB에 있는 장소만 추천(검색 기반 생성). 통과 결과 3건 미만이면 추천하지 않고 "동네 사람에게 물어보기"를 먼저 표시 |
| 2 | 이거 어때? 하위 메뉴 7개 | 초기 글이 적으면 메뉴마다 빈 화면. AI 한눈에·찐픽은 메뉴가 아니라 결과물 | 메뉴는 요즘픽·VS·평가단 3개. 써봤어요·궁금해요·AI 한눈에는 항목 상세의 탭, 찐픽은 자동 순위 |
| 3 | 동네 인증 방식 미정 | 위치기반으로 확정(2026-09-28). 개인위치정보를 쓰므로 위치정보법상 위치기반서비스사업 신고 대상 | 오픈 전 신고 완료. GPS로 동네를 확인하되 좌표는 저장하지 않고 행정동 코드만 저장(§10) |
| 4 | "소개할게요" 답변 | 답변자가 소개비를 받으면 경제적 이해관계를 숨긴 추천이 됨 | 소개비가 걸린 답변에 "소개비 받는 답변" 표시 자동 부착, 순위 가점 없음 |

## 2. 전체 구조와 콘텐츠 유형

소개광장은 두 공간, 7개 메뉴, 8개 글 유형으로 구성합니다.

```
소개광장
├─ 우리동네 (대상: 장소·동네 업체)
│   ├─ 동네픽        본사 제작 · 유입용        [P0]
│   ├─ 소개해주세요   회원 질문 · 참여용        [P1]
│   │    └─ AI 동네 추천 → "동네 사람에게 다시 물어보기"
│   └─ 같이해요      모임 · 관계 형성          [P3]
│
└─ 이거 어때? (대상: 상품·서비스)
    ├─ 요즘픽        지금 뜨는 항목            [P2]
    ├─ VS           A·B 비교 투표              [P2]
    ├─ 평가단        설문·체험 참여            [P2]
    └─ 항목 상세 (탭)
         ├─ AI 한눈에   의견 요약 (표본 수 표시)
         ├─ 써봤어요    실사용 의견
         └─ 궁금해요    구매 전 질문
       ※ 찐픽 = 검증된 평가 점수 상위 자동 순위
```

### 글 유형 정의

모든 글은 `cm_post` 한 테이블에 유형 코드로 구분합니다.

| 유형 코드 | 이름 | 작성 주체 | 필수 항목 | 반응 버튼 |
| --- | --- | --- | --- | --- |
| PICK | 동네픽 | 본사 | 제목·동네·장소 목록(3\~10)·태그 | 저장, 공유 |
| ASK | 소개해주세요 | 회원 | 제목·동네·분야·조건(예산·주차 등) | 나도 궁금해요, 소개할게요 |
| MEET | 같이해요 | 회원 | 제목·동네·날짜·인원·장소 | 참여하기 |
| TREND | 요즘픽 | 본사 + AI 후보 | 항목·출처·기간 | 관심 |
| VS | VS | 본사·회원 | 항목 A·B·비교 기준 | 투표 |
| REVIEW | 써봤어요 | 회원 | 항목·평점·사용 기간·인증 여부 | 도움돼요 |
| QNA | 궁금해요 | 회원 | 항목·질문 | 나도 궁금해요 |
| PANEL | 평가단 | 본사 | 설문·모집 인원·기간·보상 | 신청하기 |

## 3. 핵심 흐름

두 흐름 모두 "사람의 답이 다시 데이터가 되어 다음 AI 결과의 근거가 되는" 순환 구조입니다.

### 3-1. AI 동네 추천 (소개해주세요)

1. 회원 입력: "판교에서 부모님 모시고 갈 한식집, 주차 편하고 1인 3만원 정도"
2. AI가 입력을 조건 JSON으로 변환: 동네=판교, 분야=한식, 동반=부모님, 조건=주차·1인 3만원
3. 서버가 조건 검증: 동네가 `cm_region`에 있는지, 분야가 분류표에 있는지 확인. 없으면 가장 가까운 값 제안
4. 필수 조건(동네·분야·운영 중)으로 DB 후보 검색. 후보 0건이면 AI를 부르지 않음(비용 절감)
5. 선택 조건과 평판으로 점수 계산(§6 알고리즘 ①)
6. 판정: 기준 통과 3건 이상이면 추천 목록 + 근거 링크 + "동네 사람에게 다시 물어보기" 버튼. 3건 미만이면 조건이 채워진 질문 등록 화면으로 바로 연결
7. 질문 등록 → 해당 동네 회원 알림(§6 알고리즘 ②) → 답변이 DB에 쌓여 다음 추천의 근거가 됨

AI 응답은 정해진 형식으로만 받고, DB에 없는 장소 ID는 서버가 제거합니다.

```json
{
  "conditions": {"region": "판교", "category": "한식", "companion": "부모님",
                 "parking": true, "budget_per_person": 30000},
  "results": [
    {"place_id": 10231, "reason": "주차 가능, 1인 2.5~3만원대",
     "evidence_post_ids": [551, 602]}
  ],
  "enough_data": true
}
```

### 3-2. 이거 어때? 검증 (설문형 → 커뮤니티 검증)

1. 질문 후보 생성: AI가 항목(예: 무선청소기 A)의 관심 주제를 분류 → 흡입력, 소음, 배터리, AS
2. 운영자 승인: 승인된 문항만 설문으로 공개(AI 질문의 편향·오류 차단)
3. 설문형 리뷰: 선택지로 응답("소음: 조용하다 / 보통 / 시끄럽다") → 참여 장벽이 낮아 초기 데이터가 빨리 모임
4. 참여형 리뷰: 원하는 회원은 써봤어요에 글로 작성
5. 검증 상태 부여: 수집 중 → 참고 → 검증됨(§6 알고리즘 ⑦)
6. AI 한눈에: 검증됨 상태에서만 요약 공개, 항상 "응답 N명 기준 · AI 요약" 표시

## 4. 화면 ID 권고안

> **2026-10-01 철회** — 이 절의 `SB-CMU-*` 화면 ID는 CMU를 영역 코드로 쓴 안이라 규칙 위반으로 철회했습니다. 정본은 구현본 체계 `SB-HOM-CMU-*` · `SB-ADM-CMU-*` · `SB-MYP-CMU-*`이며, `소개광장 v2.0 반영 변경분 v1.0` §1을 따릅니다. 테이블 접두 `cm_`도 `cmu_`로 바뀌었습니다.

새 체계 코드 `CMU`로 사용자 화면 15개, 운영 화면 3개를 권고합니다. 화면ID 단일화 v2.0의 규칙 R5(기능 코드는 예약표에 먼저 등록)에 따라 등록 전 권고안입니다.

| 화면 ID | 화면 | 단계 |
| --- | --- | --- |
| SB-CMU-MAIN-010 | 소개광장 홈 | P0 |
| SB-CMU-PIK-010 / 020 | 동네픽 목록 / 상세 | P0 |
| SB-CMU-ASK-010 / 020 / 030 | 소개해주세요 목록 / 상세 / 작성 | P1 |
| SB-CMU-AIR-010 | AI 동네 추천 결과 | P1 |
| SB-CMU-TRD-010 | 이거 어때? 홈(요즘픽·찐픽) | P2 |
| SB-CMU-ITM-010 | 항목 상세(AI 한눈에·써봤어요·궁금해요 탭) | P2 |
| SB-CMU-VS-010 | VS 비교 | P2 |
| SB-CMU-PNL-010 / 020 | 평가단 목록 / 설문 참여 | P2 |
| SB-CMU-MET-010 / 020 / 030 | 같이해요 목록 / 상세 / 개설 | P3 |
| SB-ADM-CMU-010 | 신고·검수 | P1 |
| SB-ADM-CMU-020 | 동네픽·요즘픽 편집 | P0 |
| SB-ADM-CMU-030 | 설문·평가단 운영 | P2 |

현재 프로토타입의 커뮤니티 화면 `SB-HOM-ETC-050`(`/community`)은 `SB-CMU-MAIN-010`으로 옮기고, 번호는 규칙 R4(재사용 금지)에 따라 비워 둡니다.

## 5. 데이터 구조

핵심 9개 + 보조 4개, 총 13개 테이블입니다. Aurora MySQL 기준이며 PostgreSQL이면 자료형만 바꿉니다.

### 5-1. 핵심 테이블

```sql
-- 1) 동네 (행정동 코드 기준, 중심 좌표 보유 · §10)
CREATE TABLE cm_region (
  region_id    BIGINT PRIMARY KEY AUTO_INCREMENT,
  name         VARCHAR(50) NOT NULL,       -- 판교동, 정자동
  parent_name  VARCHAR(50),                -- 분당구
  is_open      TINYINT(1) DEFAULT 0        -- 오픈 권역만 1
);

-- 2) 대상 (장소 또는 상품·서비스)
CREATE TABLE cm_item (
  item_id      BIGINT PRIMARY KEY AUTO_INCREMENT,
  item_kind    VARCHAR(10) NOT NULL,       -- PLACE, PRODUCT, SERVICE
  name         VARCHAR(200) NOT NULL,
  region_id    BIGINT,                     -- 장소일 때만
  category     VARCHAR(50),
  listing_id   BIGINT,                     -- 소개뱅크 등록 업체 연결 (수익 연결점)
  attrs_json   JSON                        -- 주차, 가격대 등
);

-- 3) 게시글 (모든 유형 공통)
CREATE TABLE cm_post (
  post_id      BIGINT PRIMARY KEY AUTO_INCREMENT,
  post_type    VARCHAR(10) NOT NULL,       -- PICK, ASK, MEET, TREND, VS, REVIEW, QNA, PANEL
  author_id    BIGINT NOT NULL,
  author_role  VARCHAR(10) NOT NULL,       -- MEMBER, STAFF
  region_id    BIGINT,
  title        VARCHAR(200) NOT NULL,
  body         TEXT,
  cond_json    JSON,                       -- 질문 조건, 모임 날짜·인원 등
  status       VARCHAR(10) DEFAULT 'OPEN', -- OPEN, HIDDEN(임시조치), CLOSED, DELETED
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4) 게시글-대상 연결 (동네픽 목록, VS의 A·B)
CREATE TABLE cm_post_item (
  post_id BIGINT, item_id BIGINT, sort_no INT, side CHAR(1),
  PRIMARY KEY (post_id, item_id)
);

-- 5) 답변 (소개할게요, 궁금해요 답변)
CREATE TABLE cm_answer (
  answer_id    BIGINT PRIMARY KEY AUTO_INCREMENT,
  post_id      BIGINT NOT NULL,
  author_id    BIGINT NOT NULL,
  item_id      BIGINT,                     -- 소개한 장소·상품
  body         TEXT,
  has_interest TINYINT(1) DEFAULT 0,       -- 소개비 등 이해관계 → 화면 표시
  status       VARCHAR(10) DEFAULT 'OPEN',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP  -- 최신성 계산용
);

-- 6) 반응 (나도 궁금해요, 도움돼요, 투표, 참여하기)
CREATE TABLE cm_reaction (
  target_type  VARCHAR(10), target_id BIGINT, member_id BIGINT,
  reaction     VARCHAR(10),                -- CURIOUS, HELPFUL, VOTE_A, VOTE_B, JOIN
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (target_type, target_id, member_id, reaction)  -- 중복 반응 차단
);

-- 7) 설문 문항과 응답
CREATE TABLE cm_survey_q (
  q_id BIGINT PRIMARY KEY AUTO_INCREMENT, item_id BIGINT,
  question VARCHAR(200), options_json JSON,
  source VARCHAR(10),                      -- AI, STAFF
  approved TINYINT(1) DEFAULT 0            -- 운영자 승인 전 비공개
);
CREATE TABLE cm_survey_a (
  q_id BIGINT, member_id BIGINT, option_no INT,
  verified_use TINYINT(1) DEFAULT 0,       -- 실사용 인증 여부
  PRIMARY KEY (q_id, member_id)
);

-- 8) AI 요약 (근거와 표본 수를 함께 저장)
CREATE TABLE cm_ai_summary (
  item_id BIGINT PRIMARY KEY, summary TEXT, sample_n INT,
  verify_level VARCHAR(10),                -- COLLECTING, REFERENCE, VERIFIED
  model VARCHAR(50), generated_at DATETIME
);
```

### 5-2. 보조 테이블 (알고리즘용)

| 테이블 | 용도 | 주요 열 |
| --- | --- | --- |
| cm\_region\_adjacent | 인접 동네 | region\_id, adjacent\_id |
| cm\_impression | 노출 수 집계(윌슨 하한값 계산) | target\_type, target\_id, day, count |
| cm\_item\_score | 배치로 미리 계산한 점수 | item\_id, rec\_score, trend\_score, jjin\_score, calc\_at |
| cm\_algo\_config | 가중치·기준값(배포 없이 조정) | key, value, updated\_by, updated\_at |

신고 처리는 기존 `SB-ADM-RSK-010`(AI 위험감지) 대기열과 합칠지, 별도 `cm_report`를 둘지 결정이 필요합니다.

## 6. 알고리즘 설계

P1 오픈에 필요한 알고리즘은 ①\~④ 4개이고, ⑤\~⑦은 P2, ⑧은 P1 기본형으로 시작합니다. 모든 숫자는 추정 초기값이며 `cm_algo_config`에서 조정합니다.

| # | 알고리즘 | 쓰이는 곳 | 단계 | 핵심 방식 |
| --- | --- | --- | --- | --- |
| ① | AI 동네 추천 | 소개해주세요 | P1 | 조건 해석 → DB 검색 → 점수 |
| ② | 답변자 알림 대상 선정 | 소개해주세요 | P1 | 동네·분야·응답률 점수 |
| ③ | 답변 정렬 | 질문 상세 | P1 | 윌슨 하한값 |
| ④ | 회원 신뢰도 | 전체 | P1 | 가점·감점 누적 |
| ⑤ | 요즘픽 | 이거 어때? | P2 | 시간 감쇠 + 증가율 |
| ⑥ | 찐픽 | 이거 어때? | P2 | 베이즈 평균 |
| ⑦ | 설문 검증·VS 판정 | 평가단·VS | P2 | 표본 수 + 오차 범위 |
| ⑧ | 어뷰징 탐지 | 전체 | P1 기본 | 규칙 점수 |

용어: **윌슨 하한값**은 표본이 적은 비율을 낮게 잡아 2명 중 2명(100%)이 100명 중 90명보다 위로 오르지 않게 하는 공식입니다. **베이즈 평균**은 리뷰가 적은 항목의 평점을 전체 평균 쪽으로 당겨 리뷰 1개짜리 5점이 1위가 되지 않게 합니다.

### 6-0. 방식 비교

| 방식 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| A. 규칙만(조건 SQL) | 단순, 비용 0 | 자연어("부모님 모시고")를 못 알아들음 | 부족 |
| B. AI 해석 + DB 검색 + 점수 공식 | 자연어 이해, 결과 설명 가능, 지어내기 차단 | 가중치 운영 조정 필요 | 권고 |
| C. 벡터 검색(의미 유사도) | 표현이 달라도 비슷한 글 탐색 | 초기 데이터 적어 효과 작음 | 글 수천 건 이후 추가 |

### 6-1. ① AI 동네 추천

```latex
\text{추천점수} = 0.40\,C + 0.25\,R + 0.20\,E + 0.15\,F
```

| 요소 | 계산 | 범위 |
| --- | --- | --- |
| C 조건일치 | 맞은 선택 조건 수 ÷ 요청한 선택 조건 수. 예산은 가격대가 예산 ±20% 안에 겹치면 일치 | 0\~1 |
| R 평판 | 도움돼요·평점의 베이즈 평균을 0\~1로 환산 | 0\~1 |
| E 근거량 | log(1+근거수) ÷ log(1+20), 1 초과 시 1. 소개비 답변 0.5건, 동네픽 2건으로 계산 | 0\~1 |
| F 최신성 | exp(−마지막 언급 후 경과일 ÷ 90) | 0\~1 |

- 거리 보정: 최종 점수 × 거리계수 G(§10-4)
- 통과 기준: 추천점수 ≥ 0.50 그리고 조건일치 ≥ 0.50, 상위 5개
- 쏠림 방지: 5개 중 1자리는 근거 3건 미만 신규 후보에 배정

```java
public record Candidate(long placeId, double condMatch, double reputation,
                        int evidence, int interestEvidence, int staffPickEvidence,
                        long daysSinceMention, boolean adjacentRegion) {}

public class LocalRecommender {
    static final double W_COND = 0.40, W_REP = 0.25, W_EVI = 0.20, W_FRESH = 0.15;
    static final double MIN_SCORE = 0.50, MIN_COND = 0.50;
    static final int MIN_RESULTS = 3;

    public double score(Candidate c) {
        double evi = c.evidence() + 0.5 * c.interestEvidence() + 2.0 * c.staffPickEvidence();
        double eviNorm = Math.min(1.0, Math.log1p(evi) / Math.log1p(20));
        double fresh = Math.exp(-c.daysSinceMention() / 90.0);
        double s = W_COND * c.condMatch() + W_REP * c.reputation()
                 + W_EVI * eviNorm + W_FRESH * fresh;
        return c.adjacentRegion() ? s * 0.8 : s;
    }

    public RecommendResult recommend(List<Candidate> candidates, Set<Long> aiReturnedIds) {
        List<Candidate> passed = candidates.stream()
            .filter(c -> aiReturnedIds.contains(c.placeId()))       // AI가 고른 것 중 DB에 있는 것만
            .filter(c -> c.condMatch() >= MIN_COND && score(c) >= MIN_SCORE)
            .sorted(Comparator.comparingDouble(this::score).reversed())
            .limit(5)
            .toList();
        return new RecommendResult(passed, passed.size() < MIN_RESULTS); // 부족하면 질문 먼저
    }
}
```

후보 검색 SQL:

```sql
SELECT i.item_id, i.attrs_json,
       COUNT(DISTINCT pi.post_id)                                  AS pick_cnt,
       SUM(a.has_interest = 0)                                     AS answer_cnt,
       SUM(a.has_interest = 1)                                     AS interest_cnt,
       DATEDIFF(NOW(), MAX(COALESCE(a.created_at, p.created_at)))  AS days_since
FROM cm_item i
LEFT JOIN cm_post_item pi ON pi.item_id = i.item_id
LEFT JOIN cm_post p       ON p.post_id = pi.post_id AND p.status = 'OPEN'
LEFT JOIN cm_answer a     ON a.item_id = i.item_id AND a.status = 'OPEN'
WHERE i.item_kind = 'PLACE'
  AND i.category = :category
  AND i.region_id IN (:regionIds)      -- 요청 동네 + 인접 동네
GROUP BY i.item_id;
```

### 6-2. ② 답변자 알림 대상 선정

```latex
\text{알림점수} = 0.35\,\text{동네} + 0.30\,\text{분야전문성} + 0.20\,\text{응답률} + 0.15\,\text{최근활동}
```

| 요소 | 계산 |
| --- | --- |
| 동네 | 인증 동네 중심 기준 거리계수 G(§10-4), 3km 밖 제외 |
| 분야전문성 | 해당 분야 답변의 도움돼요 베이즈 평균(답변 없으면 0.3) |
| 응답률 | (답변 수 + 1) ÷ (알림 받은 수 + 3) |
| 최근활동 | exp(−마지막 접속 후 경과일 ÷ 14) |

1. 상위 20명 발송, 질문자·이미 답변한 사람 제외
2. 회원 1명당 하루 3건 상한
3. 24시간 안에 답변 0건이면 다음 순위 20명에게 1회만 2차 발송

### 6-3. ③ 답변 정렬

```latex
\text{정렬점수} = \text{Wilson}(\text{도움돼요},\ \text{노출}) + 0.3 \times \text{채택} + 0.1 \times \frac{\text{답변자 신뢰도}}{100}
```

- 소개비 답변은 표시만 붙이고 가점 없음
- 신규 답변은 작성 후 24시간 동안 3번째 자리에 한 번 섞어 노출

```java
public static double wilsonLowerBound(int positive, int total) {
    if (total == 0) return 0.0;
    double z = 1.96, p = (double) positive / total, z2 = z * z;
    double num = p + z2 / (2 * total)
               - z * Math.sqrt(p * (1 - p) / total + z2 / (4.0 * total * total));
    return num / (1 + z2 / total);
}
```

### 6-4. ④ 회원 신뢰도 (0\~100)

| 항목 | 점수 |
| --- | --- |
| 기본 | 30 |
| 답변 채택 1건 | +5 (최대 +30) |
| 받은 도움돼요 | +5 × log₂(1 + 개수) (최대 +20) |
| 실사용 인증 리뷰 1건 | +2 (최대 +10) |
| 가입 기간 | 30일마다 +1 (최대 +10) |
| 신고 확정 1건 | −15 |
| 이해관계 미표시 적발 | −30 |

70 이상은 "동네 소개왕" 표시, 20 미만은 새 글을 검수 후 공개합니다. 계산 결과는 0\~100으로 자릅니다.

### 6-5. ⑤ 요즘픽

```latex
S_7 = \sum_i w_i \cdot 0.5^{\Delta t_i / 48\text{h}}, \qquad B = \frac{\text{직전 28일 가중합}}{4}, \qquad \text{뜨는정도} = \frac{S_7}{B + 5}
```

- 가중치 w: 관심 1, 궁금해요 2, 써봤어요 3, VS 투표 1
- +5는 조용하던 항목이 반응 2\~3개로 1위가 되는 것을 막는 보정값
- 노출 조건: S7 ≥ 10, 뜨는정도 상위 10개

### 6-6. ⑥ 찐픽

```latex
\text{찐픽점수} = \frac{C \cdot m + \sum_i w_i r_i}{C + \sum_i w_i}, \quad C = 10,\ w = 1.0\ (\text{인증}),\ 0.3\ (\text{미인증})
```

m은 같은 분류의 전체 평균 평점입니다. 검증됨 상태 항목만 후보가 됩니다.

### 6-7. ⑦ 설문 검증·VS 판정

| 상태 | 조건 | 표시 |
| --- | --- | --- |
| 수집 중 | 응답 < 10 | 비율 숨김 |
| 참고 | 응답 ≥ 10 | 비율 + 응답 수 + 오차 범위 |
| 검증됨 | 응답 ≥ 30, 실사용 인증 ≥ 50% | 찐픽 후보, AI 한눈에 공개 |

```latex
\text{오차} = 1.96\sqrt{\frac{p(1-p)}{n}}
```

| 응답 수 n | 50% 응답일 때 오차 |
| --- | --- |
| 30 | ±18%p |
| 100 | ±10%p |
| 400 | ±5%p |

30명 기준 "조용하다 60%"는 실제로 42\~78% 범위라는 뜻입니다. 검증됨이어도 화면에 "응답 N명 기준"을 반드시 표시하고, 기준 상향(예: 100명)은 운영 판단 사항입니다.

VS 우세 판정 (d = A 비율 − B 비율):

```latex
|d| > 1.96\sqrt{\frac{1-d^2}{n}} \;\Rightarrow\; \text{우세}, \quad \text{아니면 비슷함}
```

결과는 투표 후에만 공개해 쏠림을 막습니다.

### 6-8. ⑧ 어뷰징 탐지

| 신호 | 점수 |
| --- | --- |
| 같은 기기·IP의 여러 계정이 같은 글에 반응 | +40 |
| 가입 7일 이내 계정이 등록 업체 링크 답변 | +20 |
| 같은 회원이 같은 업체를 30일 내 3회 이상 소개 | +30 |
| 한 글에 10분 안에 도움돼요 10개 이상 | +30 |
| 본문에 전화번호·외부 링크 | +15 |

합계 50 이상은 자동 비공개 후 검수, 30\~49는 노출 유지 + 검수 대기열로 보냅니다. 본문의 전화번호·계좌번호는 자동 가림 처리합니다.

### 6-9. 운영 전제

1. 점수는 요청마다가 아니라 배치(10분\~1시간 주기)로 계산해 `cm_item_score`에 저장
2. 가중치·기준값은 `cm_algo_config`에 두어 배포 없이 조정
3. 추천 노출·저장·소개 성사 기록으로 월 1회 가중치 점검

## 7. 운영 정책과 법무 확인

아래 7개 정책을 오픈 전에 확정합니다. 법률 근거는 조문과 최신 개정 여부를 법무 검토로 확인해야 합니다.

| 영역 | 정책 | 근거·이유 |
| --- | --- | --- |
| 동네 | 회원당 동네 최대 2곳, 변경은 월 1회 | 여러 동네 광고성 도배 방지 |
| 동네 인증 | GPS 1회 확인 → 행정동 코드만 저장, 30일마다 재인증 | 위치정보법 제9조 위치기반서비스사업 신고 필수(§10-2) |
| 이해관계 표시 | 소개비·협찬·체험단 답변에 자동 표시 | 표시광고법, 추천·보증 등에 관한 표시·광고 심사지침(최신 개정 확인 필요) |
| 신고·임시조치 | 권리 침해 신고 시 임시 비공개 후 검토 | 정보통신망법 제44조의2(조문 확인 필요) |
| 개인정보 | 본문 전화번호·계좌번호 자동 가림 | 개인정보 노출·직거래 사기 방지 |
| 같이해요 | 성인 인증 회원만 개설·참여, 공개 장소만, 신고 1회 즉시 비공개 | 오프라인 만남 안전 |
| AI 표시 | AI 추천·요약에 "AI 작성" 표시와 근거 링크 | 인공지능기본법(2026-01 시행) 적용 범위 확인 필요 |

## 8. 단계별 실행, 자원, 테스트

P0\~P3 전체 약 14\~19주(추정)이며, 개발 1\~2명과 콘텐츠 담당 1명이 필요합니다.

| 단계 | 내용 | 기간(추정) | 필요 자원 |
| --- | --- | --- | --- |
| P0 준비 | 권역(분당·판교) 확정, 동네픽 30\~50개 본사 제작, 테이블 13개, 홈·동네픽 화면, 동네픽 편집 운영 화면 | 3\~4주 | 콘텐츠 1명, 개발 1명 |
| P1 참여 | 소개해주세요, AI 동네 추천, 알고리즘 ①\~④·⑧ 기본형, 신고·검수 | 4\~5주 | 개발 1\~2명, AI 호출 비용(사용량 비례) |
| P2 검증 | 이거 어때? 3메뉴, 설문형 리뷰, 알고리즘 ⑤\~⑦, 평가단 1회차 | 4\~6주 | 개발 1\~2명, 평가단 보상 예산 |
| P3 관계 | 같이해요, 알림 고도화 | 3\~4주 | 개발 1명, 안전 정책 법무 검토 |

비용 참고

- 점수 계산·배치는 기존 서버로 충분해 추가 비용이 거의 없습니다.
- AI 호출은 추천 1건당 1\~2회입니다. 추천 이유를 템플릿 문장으로 만들면 1회로 줄어듭니다. 요금은 모델·시점별로 달라 월 한도 금액을 먼저 정합니다.
- 알림은 결정된 카카오 알림톡 체계를 재사용합니다. 하루 3건 상한이 발송 비용 상한이 됩니다.

### 단위 테스트 기준

| # | 테스트 | 기대 결과 |
| --- | --- | --- |
| 1 | wilsonLowerBound(8, 20) | 0.219 (±0.001) |
| 2 | 찐픽: C=10, m=4.0, 인증 리뷰 5개 평균 4.8 | 4.267 |
| 3 | VS 58:42, n=100 | 비슷함 (d=0.16 < 기준 0.193) |
| 4 | 통과 후보 2건 | askFirst = true |
| 5 | AI가 후보에 없는 place\_id 반환 | 결과에서 제거 |
| 6 | 같은 회원 하루 4번째 알림 | 발송 안 됨 |
| 7 | 같은 회원이 같은 글에 도움돼요 2회 | 두 번째 거부(기본키 중복) |

## 10. 위치기반 설계 (2026-09-28 확정)

소개광장은 위치기반으로 운영합니다. 핵심 원칙은 "위치는 확인에 쓰고, 저장은 행정동 코드로만"이며, 오픈 전 위치기반서비스사업 신고가 필수입니다.

### 10-1. 무엇이 달라지나

| 항목 | 이전(자기 선택) | 변경(위치기반) |
| --- | --- | --- |
| 동네 인증 | 회원이 동네 선택 | GPS로 현재 위치 확인 → 행정동 판정 |
| 추천 기준점 | 선택한 동네 | 질문에 적은 동네 중심 → 없으면 현재 위치(동의 시) → 없으면 인증 동네 중심 |
| 거리 계산 | 같은 동 / 인접 동 | 실제 거리(km) 기반 거리계수 G |
| 같이해요 | 동네 표시 | 거리 표시(100m 단위 반올림, 정확한 위치 비공개) |
| 법적 의무 | 해당 없음 | 신고, 약관, 동의, 확인자료 기록 |

### 10-2. 법적 의무

| 의무 | 내용 | 근거 |
| --- | --- | --- |
| 사업 신고 | 개인위치정보를 대상으로 하는 위치기반서비스사업은 방송미디어통신위원회에 신고 | 위치정보법 제9조 ([법령](https://www.law.go.kr/LSW//lsSideInfoP.do?lsiSeq=277359&joNo=0009&joBrNo=00&docCls=jo&urlMode=lsScJoRltInfoR)) |
| 접수처 | 전자민원센터 온라인 접수 | [위치정보지원센터](https://www.lbsc.kr/front/content/contentViewer.do?contentId=CONTENT_0000081) |
| 등록제 구분 | 개인위치정보를 직접 수집·제공하는 개인위치정보사업은 등록제, 위치정보를 제공받아 쓰는 위치기반서비스업은 신고제 | [공공데이터포털](https://www.data.go.kr/data/15022357/fileData.do?recommendDataYn=Y) |
| 소상공인 특례 | 소상공인등은 사업 개시 후 1개월이 지나도 계속하려면 신고 | [위치정보지원센터](https://www.lbsc.kr/front/content/contentViewer.do?contentId=CONTENT_0000091) — 법인은 해당 여부 확인 필요 |
| 약관·동의 | 위치기반서비스 이용약관, 개인위치정보 이용 동의(별도) | 법무 확인 필요 |
| 확인자료 | 위치정보 이용·제공 사실 확인자료 자동 기록·보존 | 보존 기간(6개월 이상으로 알려짐)은 조문 확인 필요 |
| 미성년자 | 14세 미만 법정대리인 동의 | 소개뱅크 가입 연령 기준과 함께 법무 확인 |

앱이 휴대폰 GPS를 직접 받는 구조가 개인위치정보사업(등록) 대상인지, 위치기반서비스사업(신고)만으로 되는지가 가장 중요한 쟁점입니다. 위치정보지원센터 사전 상담으로 확정합니다.

### 10-3. 인증 흐름과 저장 원칙

1. 회원이 동네 인증 버튼 → 위치 이용 동의(최초 1회) → 휴대폰이 좌표 전송
2. 서버가 좌표를 행정동 코드로 변환(역지오코딩: 카카오 로컬 API 등, 이용 조건 확인 필요)
3. 행정동 코드와 인증 시각만 저장, 좌표는 변환 직후 폐기
4. 확인자료 로그에 "누가·언제·어떤 목적으로 이용"만 기록(좌표 제외)
5. 30일마다 재인증, 만료 시 글쓰기·답변만 제한(읽기는 허용)

실시간 "내 주변" 추천은 요청 순간의 좌표를 계산에만 쓰고 저장하지 않습니다.

### 10-4. 알고리즘 변경 — 거리계수 G

```latex
G(d) = \begin{cases} 1.0 & d \le 1\text{km} \\ e^{-(d-1)/2} & 1 < d \le 5\text{km} \\ \text{제외} & d > 5\text{km} \end{cases}
```

| 거리 d | G |
| --- | --- |
| 1km 이하 | 1.00 |
| 2km | 0.61 |
| 3km | 0.37 |
| 5km | 0.14 |

- 알고리즘 ① 추천점수 × G, 기준 반경 5km
- 알고리즘 ② 답변자 알림은 인증 동네 중심 기준 3km 안만 대상
- 반경 값은 `cm_algo_config`에서 조정(도심·외곽 차이)

### 10-5. 데이터 구조 추가·변경

```sql
-- 동네: 행정동 코드와 중심 좌표
ALTER TABLE cm_region
  ADD COLUMN adm_code VARCHAR(10) UNIQUE,          -- 행정동 코드
  ADD COLUMN center   POINT NOT NULL SRID 4326,
  ADD SPATIAL INDEX idx_region_center (center);

-- 대상(업체) 좌표: 사물 위치라 개인위치정보 아님
ALTER TABLE cm_item
  ADD COLUMN geo POINT NOT NULL SRID 4326,
  ADD SPATIAL INDEX idx_item_geo (geo);

-- 회원 동네 인증: 좌표 저장 안 함
CREATE TABLE cm_member_region (
  member_id   BIGINT,
  region_id   BIGINT,
  verified_at DATETIME NOT NULL,
  expires_at  DATETIME NOT NULL,                     -- verified_at + 30일
  PRIMARY KEY (member_id, region_id)
);

-- 위치정보 이용 확인자료 (좌표 없음)
CREATE TABLE cm_location_use_log (
  log_id      BIGINT PRIMARY KEY AUTO_INCREMENT,
  member_id   BIGINT NOT NULL,
  purpose     VARCHAR(20) NOT NULL,                  -- REGION_VERIFY, NEARBY_RECOMMEND
  provided_to VARCHAR(50),                           -- 제3자 제공 시 대상, 없으면 NULL
  used_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 반경 검색 (MySQL 8 계열 기준, Aurora 엔진 버전 확인 필요)
SELECT item_id,
       ST_Distance_Sphere(geo, ST_SRID(POINT(:lng, :lat), 4326)) / 1000 AS dist_km
FROM cm_item
WHERE item_kind = 'PLACE' AND category = :category
HAVING dist_km <= 5
ORDER BY dist_km;
```

`cm_region_adjacent`(인접 동네 표)는 거리계수로 대체되어 필요 없습니다. 보조 테이블은 4개 → 5개(`cm_member_region`, `cm_location_use_log` 추가, `cm_region_adjacent` 삭제)가 됩니다.

### 10-6. 추가 위험과 대응

| 위험 | 대응 |
| --- | --- |
| 신고 전 오픈 | 신고 수리 전에는 위치 기능 비활성, 동네 선택 방식으로 임시 운영 |
| 좌표 유출 | 좌표 미저장 원칙, 로그·오류 메시지에도 좌표 기록 금지 |
| 위치 조작(가짜 GPS) | 인증 후 활동 기반 신뢰도 반영, 짧은 시간 내 먼 거리 반복 인증 탐지 |
| 같이해요 위치 노출 | 모임 장소는 공개 장소만, 개설자 위치 비공개 |

## 9. 문제와 해결, 체크리스트, 다음 할 일

가장 큰 위험은 초기 빈 화면과 AI 지어내기이며, 권역 축소와 DB 한정 추천으로 대응합니다.

| # | 문제 | 해결 |
| --- | --- | --- |
| 1 | 초기 글이 없어 빈 화면 | 권역 1곳, 동네픽 선제작, 빈 목록 대신 "첫 질문 남기기" |
| 2 | AI가 없는 가게 추천 | DB 후보만 허용 + 서버 ID 재검증 |
| 3 | 초기엔 본사 동네픽만 추천됨 | 정상. 답변이 쌓이면 분산됨. 신규 후보 1자리 배정 |
| 4 | 업체 셀프 추천·바이럴 | 이해관계 표시, 반복 소개 탐지, 신규 회원 답변 노출 지연 |
| 5 | 설문 중복 응답 | 회원당 문항 1회(기본키), 실사용 인증 가중치 |
| 6 | 오차 큰 설문을 사실로 오해 | 응답 수·오차 항상 표시 |
| 7 | 특정 업체 비방 | 신고 → 임시조치 → 운영자 판단 |
| 8 | 같이해요 만남 사고 | 성인 인증, 공개 장소 제한, P3로 늦춰 정책 선확정 |
| 9 | 가중치가 현실과 불일치 | 추천 결과 기록 기반 월 1회 점검 |

### 결정 체크리스트

- [ ] 오픈 권역 확정(분당·판교 한정 여부)
- [ ] 동네픽 첫 30개 주제 목록 확정
- [ ] 체계 코드 CMU와 기능 코드 예약표 등록
- [ ] 위치기반서비스사업 신고 접수(emsit.go.kr), 개인위치정보사업 등록 대상 여부는 위치정보지원센터 사전 상담으로 확인
- [ ] 소개할게요 답변과 소개비 연결 여부 → 이해관계 표시 문구 확정
- [ ] AI 호출 월 한도 금액
- [ ] 가중치·기준값 초기값 승인
- [ ] 설문 검증 기준 30명 유지 또는 상향
- [ ] 알림 상한 하루 3건 확정
- [ ] 신고 처리를 AI 위험감지(SB-ADM-RSK-010)와 합칠지 결정

### 다음 할 일

1. 체크리스트의 권역·동네픽 주제·소개비 연결 여부 결정
2. 동네픽 30개 주제안과 P0 화면정의서 작성
3. P1 알고리즘 4종 Spring Boot 서비스 코드(배치 포함)와 단위 테스트 작성

### 참고 문서

- 소개뱅크 화면ID 단일화 v2.0 — 규칙 R4·R5, SB-HOM-ETC-050 (프로젝트 문서)
- 소개뱅크 자동화서버 셋업절차 v1.0 §10 — AI 호출 월 한도·알림톡 (프로젝트 문서)
- 법률 근거(위치정보법, 표시광고법 추천·보증 심사지침, 정보통신망법 제44조의2, 인공지능기본법)는 법무 검토로 최신 조문 확인 필요
