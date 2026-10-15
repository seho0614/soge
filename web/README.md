# 소개뱅크 웹

**설계** `../docs/16_프런트엔드설계서.md`

```bash
npm install
npm run api:types    # docs/06_openapi.json → src/api/schema.ts
npm run typecheck
```

## 구조

```
src/
  styles/tokens.css   색 5개 · tabular-nums · .tbd(목적지 없는 링크)
  lib/
    api.ts            ApiFailure(isConflict/isPolicy/isGate) · X-Ref-Code · 멱등키
    codes.ts          부팅 시 1회 로드. 라벨 하드코딩 금지
    format.ts         won() · ago() · remain()
  components/
    ListingCard       금액이 시각적 정점 · 등급 미표시
    ListingList       promoted / organic 분리 렌더
    Badge · AdLabel   tone → 토큰 이름
    ErrorView         403 게이트별 유도 · 409 재시도 버튼 없음
    Footer            full / slim / mini
  app/admin/
    ReviewQueue       SB-ADM-REV-010 · 개입 사유를 카드에 표시
    ReviewDecide      SB-ADM-REV-020 · 사유 코드 없으면 반려 불가
    AutoReviewRules   SB-ADM-REV-030 · 규칙 옆에 개입 건수
```

## 규칙 5가지

1. **라벨을 하드코딩하지 않습니다.** `label('listing.status', code)` 를 씁니다
2. **광고와 일반 목록을 합쳐 렌더하지 않습니다.** 표시 의무 위반이 화면 단에서 발생합니다
3. **목적지 없는 링크를 숨기지 않습니다.** `.tbd` 로 점선 표시 + tip
4. **409 에 재시도 버튼을 주지 않습니다.** 재시도해도 같은 결과입니다
5. **화면 컴포넌트 파일명에 화면 ID를 넣습니다.** 73화면을 추적하는 유일한 방법

## 상세 화면 CTA (미구현 · 착수 시 필수)

```
[문의하기]   주 동선 · 시각적 우위 · 귀속 안 (INV-2)
[전화하기]   보조 · 하단 · 낮은 대비 · 귀속 밖
```

050 안심번호 전까지 이 배치가 통화 유실을 막는 유일한 수단입니다.
