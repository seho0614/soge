# 소개뱅크 메일 구축 절차서 v1.0 (Amazon SES + 외부 메일함)

Oct 7, 2026 · @박세호

## 1. 결론과 전체 구성

메일 서버를 직접 설치하지 않습니다. 서비스 자동 발송은 Amazon SES(AWS 메일 발송 서비스), 직원 메일함은 외부 메일함 서비스, 도메인 연결은 Route 53 한 곳에서 관리합니다.

| 역할 | 담당 | 쓰는 주소 | 이렇게 나누는 이유 |
| --- | --- | --- | --- |
| 직원이 주고받는 회사 메일 | 외부 메일함 서비스 (이 문서는 Google Workspace 기준) | `이름@sogaebaenk.co.kr` · `help@sogaebaenk.co.kr` | 스팸 차단, 백업, 보안 패치를 업체가 맡습니다 |
| 가입 인증 · 비밀번호 재설정 · 알림 자동 발송 | Amazon SES 서울 리전 | `no-reply@mail.sogaebaenk.co.kr` | 서버 설치가 없고 보낸 만큼만 요금을 냅니다 |
| 도메인 연결 레코드 (MX · SPF · DKIM · DMARC) | Route 53 | 해당 없음 | DNS가 이미 Route 53에 있습니다 |

**핵심 설계 한 가지.** 회사 메일함은 본 도메인 `sogaebaenk.co.kr`, 자동 발송은 하위 도메인 `mail.sogaebaenk.co.kr`로 완전히 나눕니다. 두 서비스의 레코드가 서로 겹치지 않아, 초보자가 가장 자주 내는 사고(SPF 레코드 2개 중복)가 생기지 않습니다. 자동 발송 메일의 평판이 나빠져도 직원 메일에는 번지지 않습니다.

**용어 풀이**

| 용어 | 쉬운 뜻 |
| --- | --- |
| MX | "이 도메인으로 온 메일은 이 서버로 배달하라"는 주소 표지 |
| SPF | "우리 도메인 이름으로 메일을 보내도 되는 서버 목록" |
| DKIM | 메일마다 붙이는 전자 도장. 중간에 위조되지 않았음을 증명 |
| DMARC | SPF · DKIM 검사에 실패한 메일을 받는 쪽이 어떻게 처리할지 정하는 규칙 |
| MAIL FROM | 반송 메일이 돌아갈 봉투 주소. 받는 사람 화면에는 보이지 않음 |
| 샌드박스 | SES 신규 계정의 시험 모드. 인증된 주소로만 보낼 수 있음 |

&#91;embedded content: 메일 구성도 · 두 경로와 DNS\]

회사 메일은 Google 메일함으로 들어오고 나가며, 서비스 자동 발송은 SES로만 나갑니다. 두 경로의 주소 표지는 모두 Route 53에 있습니다.

## 2. 전제 · 준비물 · 일정 · 비용

실작업은 약 6\~8시간, 반영 대기를 포함하면 달력으로 2\~4일입니다. 월 비용은 계정 6개 기준 약 44달러, 20개 기준 약 142달러부터입니다(연간 약정, 발송 1만 통 가정).

### 2-1. 전제

1. 도메인은 `sogaebaenk.co.kr`, 등록은 가비아, DNS는 Route 53입니다. STEP 0에서 실제로 확인합니다.
2. AWS 작업은 IAM 관리자 `seho-admin`으로, 리전은 서울(ap-northeast-2)에서만 합니다.
3. 메일 계정은 6\~20개입니다.
4. 메일함은 Google Workspace Business Starter 기준으로 썼습니다. 다른 업체를 쓰면 STEP 1의 레코드 값만 그 업체 값으로 바꿉니다.
5. 서버 예시 코드는 NestJS(Node 22) 기준입니다. 다른 언어여도 SMTP 설정값은 같습니다.

### 2-2. 준비물

| # | 준비물 | 없으면 |
| --- | --- | --- |
| 1 | AWS 콘솔 로그인 (`seho-admin` + 인증 앱) | 모든 AWS 단계 불가 |
| 2 | 법인 카드 | 메일함 서비스 결제 불가 |
| 3 | 계정 명단: 사람별 주소 6\~20개와 공용 주소(`help@` · `admin@` · `dmarc@`) | STEP 1-3 불가 |
| 4 | 사무실 PC의 PowerShell | 확인 명령 실행 불가 |
| 5 | 운영 서버 SSH 접속 권한 | STEP 5 환경변수 반영 불가 |
| 6 | 시험용 외부 메일 주소 2개 (Gmail 1개, 네이버 1개) | STEP 7 수신 확인 불가 |

### 2-3. 일정

| 날 | 할 일 | 실작업 | 기다리는 시간 |
| --- | --- | --- | --- |
| 1일차 오전 | STEP 0 현황 확인, STEP 1 메일함 개통 | 2\~3시간 | MX 반영 최대 72시간 (Google 안내) |
| 1일차 오후 | STEP 2 SES 도메인 인증, STEP 3 DMARC, STEP 4 프로덕션 신청 | 1\~1.5시간 | AWS 첫 회신 24시간 이내 |
| 2\~3일차 | STEP 5 서버 연결, STEP 6 반송 처리, STEP 7 테스트 | 2\~3시간 | 없음 |

STEP 4 신청은 1일차에 반드시 넣습니다. 승인 전에는 인증된 주소로만 발송되므로, 늦게 넣으면 그만큼 오픈이 밀립니다.

### 2-4. 예상 비용 (2026-10-07 확인, 달러는 결제일 환율 적용)

| 항목 | 단가 | 월 예상 |
| --- | --- | --- |
| [Google Workspace Business Starter](https://knowledge.workspace.google.com/admin/billing/compare-flexible-and-annual-fixed-term-payment-plans?hl=ko) | 연간 약정 사용자당 7달러, 월 단위 8.40달러 | 6명 42\~50.4달러, 20명 140\~168달러 |
| [Amazon SES 발송 (Essentials 요금제)](https://aws.amazon.com/ses/pricing/) | 1,000통당 0.16달러 | 1만 통 1.6달러, 10만 통 16달러 |
| SES 첨부 데이터 | 1GB당 0.12달러 | 1달러 미만 |
| Route 53 | 기존 호스팅 영역 사용 | 추가분 거의 없음 |

- 2026-07-21부터 SES 신규 계정은 Essentials 요금제로 시작합니다. 낱개 요금(1,000통당 0.10달러)으로 바꿀 수 있지만, 월 10만 통 이하에서는 차이가 6달러 이하라 그대로 둡니다.
- 한국 결제 화면의 Google Workspace 원화 가격은 가입 화면에서 다시 확인합니다.
- AWS 신규 가입 크레딧이 남아 있으면 SES 요금에도 적용됩니다.

### 2-5. 메일함 서비스 선택지

| 서비스 | 메일이 되는 요금제 | 1인 월 요금 | 고르는 경우 |
| --- | --- | --- | --- |
| Google Workspace (추천) | Business Starter | 7달러 (연간 약정) | 설정 문서가 가장 명확하고, 법인 구글 계정이 이미 있으면 그대로 확장 |
| [네이버웍스](https://help.worksmobile.com/ko/use-guides/mail/overview/) | Standard 이상 (Free · Lite는 메일 없음) | 약 7,000원 (참고값, 요금 페이지 확인 필요) | 국내 업체 지원과 한글 화면을 우선할 때 |
| 가비아 하이웍스 | 확인 필요 | 약 4,000원부터 (참고값, 부가세 별도, 확인 필요) | 도메인과 같은 업체에서 결제를 묶고 싶을 때 |

## 3. STEP 0 · 현황 확인 (20분)

아무것도 바꾸기 전에 지금 메일 관련 레코드가 무엇인지 기록합니다. 기존 MX를 모르고 바꾸면 쓰던 회사 메일이 끊깁니다.

### 0-1. DNS가 Route 53에 있는지 확인

사무실 PC에서 PowerShell을 열고 입력합니다.

```powershell
nslookup -type=NS sogaebaenk.co.kr 8.8.8.8
```

`[확인]` 결과에 `awsdns`가 들어간 네임서버 4개가 나옵니다. 가비아(`ns.gabia.co.kr` 계열)가 나오면 이 문서의 레코드 작업을 Route 53이 아니라 가비아 DNS 관리 화면에서 해야 하므로, 먼저 도메인 AWS 이전 절차 v1.0을 끝냅니다.

### 0-2. 현재 메일 레코드 조회

```powershell
nslookup -type=MX  sogaebaenk.co.kr 8.8.8.8
nslookup -type=TXT sogaebaenk.co.kr 8.8.8.8
nslookup -type=TXT _dmarc.sogaebaenk.co.kr 8.8.8.8
```

결과를 아래 표에 그대로 옮겨 적습니다. 없으면 "없음"이라고 적습니다.

| 유형 | 이름 | 현재 값 | 기록일 |
| --- | --- | --- | --- |
| MX | `sogaebaenk.co.kr` |  |  |
| TXT (`v=spf1`로 시작) | `sogaebaenk.co.kr` |  |  |
| TXT (`v=DMARC1`로 시작) | `_dmarc.sogaebaenk.co.kr` |  |  |

### 0-3. Route 53 화면 캡처

`콘솔 › Route 53 › 호스팅 영역 › sogaebaenk.co.kr` 레코드 목록 전체를 캡처해 보관합니다. 되돌릴 때 쓰는 유일한 근거입니다.

### 0-4. 결과에 따른 다음 단계

| MX 조회 결과 | 뜻 | 다음 |
| --- | --- | --- |
| 없음 | 회사 메일함이 아직 없음 | STEP 1을 처음부터 진행 |
| `smtp.google.com` 또는 `aspmx.l.google.com` 계열 | 이미 Google Workspace 사용 중 | STEP 1-1 \~ 1-4를 건너뛰고 1-5(SPF)부터 점검 |
| 그 밖의 값 (카페24 · 가비아 등) | 다른 메일함 사용 중 | 기존 메일을 옮길지 먼저 결정. MX를 바꾸는 순간부터 새 메일은 새 메일함으로만 들어옵니다 |

`[실패 시]` `nslookup` 결과가 `timed out`이면 사내 방화벽 문제일 수 있습니다. `8.8.8.8` 대신 `1.1.1.1`로 다시 시도합니다.

## 4. STEP 1 · 회사 메일함 개통 (2\~3시간)

Google Workspace에 가입하고, Route 53에 레코드 4종(소유 확인 TXT, MX, SPF, DKIM)을 넣으면 `이름@sogaebaenk.co.kr`로 메일을 주고받게 됩니다. Google 화면의 메뉴명은 언어 설정에 따라 조금 다를 수 있습니다.

### Route 53 입력 규칙 3가지 (이 문서 전체 공통)

1. TXT 값은 반드시 큰따옴표로 감쌉니다. 예: `"v=spf1 include:_spf.google.com ~all"`
2. 같은 이름의 TXT는 레코드를 새로 만들지 않고, 기존 레코드를 편집해 값 칸에 한 줄씩 추가합니다. 같은 이름으로 두 번 만들면 오류가 납니다.
3. 레코드 이름 칸에는 앞부분만 적습니다. 본 도메인 자체는 비워 두고, `google._domainkey`처럼 하위 이름만 적습니다.

### 1-1. 가입

1. `workspace.google.com`에서 무료 평가판 시작을 누릅니다. 14일 동안 무료입니다.
2. 회사명, 직원 수, 국가(대한민국)를 입력합니다.
3. "이미 사용 중인 도메인이 있음"을 고르고 `sogaebaenk.co.kr`을 입력합니다.
4. 관리자 계정을 만듭니다. 예: `admin@sogaebaenk.co.kr`. 이 비밀번호는 비밀번호 관리자에 보관합니다.
5. 요금제는 Business Starter를 고릅니다.

`[확인]` `admin.google.com`에 방금 만든 관리자 계정으로 로그인됩니다.

### 1-2. 도메인 소유 확인

1. 설정 도구가 `google-site-verification=...`으로 시작하는 TXT 값을 보여 줍니다. 복사합니다.
2. `콘솔 › Route 53 › 호스팅 영역 › sogaebaenk.co.kr › 레코드 생성`을 엽니다.
3. 아래 값으로 저장합니다.

| 항목 | 값 |
| --- | --- |
| 레코드 이름 | (비움) |
| 유형 | TXT |
| 값 | `"google-site-verification=복사한값"` |
| TTL | 300 |

4. Google 설정 도구로 돌아가 확인을 누릅니다.

`[확인]` "도메인 소유권이 확인됨" 표시가 뜹니다. 안 되면 5\~10분 뒤 다시 누릅니다.

### 1-3. 계정과 공용 주소 만들기

1. `admin.google.com › 디렉터리 › 사용자 › 새 사용자 추가`에서 사람마다 계정을 만듭니다. 계정 1개가 요금 1명분입니다.
2. 공용 주소는 계정이 아니라 그룹으로 만듭니다. 그룹은 요금이 들지 않고, 받은 메일을 구성원 모두에게 전달합니다.
3. `디렉터리 › 그룹 › 그룹 만들기`에서 아래 3개를 만듭니다.

| 그룹 주소 | 용도 | 구성원 |
| --- | --- | --- |
| `help@sogaebaenk.co.kr` | 고객 문의, 자동 발송 메일의 답장 받는 곳 | 고객 응대 담당 |
| `admin@` 또는 `ops@sogaebaenk.co.kr` | AWS · 외부 연동 업체 알림 | 대표, 운영 담당 |
| `dmarc@sogaebaenk.co.kr` | DMARC 보고서 수신 (STEP 3) | 대표 |

4. 각 그룹의 액세스 설정에서 "조직 외부 사용자도 게시 가능"을 켭니다. 꺼져 있으면 외부에서 보낸 메일이 반송됩니다.

### 1-4. MX 레코드 (받는 길 열기)

STEP 0에서 기존 MX가 있었다면 그 값을 지우고 아래 하나만 남깁니다.

| 항목 | 값 |
| --- | --- |
| 레코드 이름 | (비움) |
| 유형 | MX |
| 값 | `1 smtp.google.com` |
| TTL | 300 |

`[확인]` `nslookup -type=MX sogaebaenk.co.kr 8.8.8.8` 결과에 `smtp.google.com`이 나옵니다. [Google 안내](https://support.google.com/a/answer/61158?hl=en)상 반영에 최대 72시간이 걸릴 수 있습니다.

### 1-5. SPF 레코드 (보내도 되는 서버 등록)

1-2에서 만든 본 도메인 TXT 레코드를 편집해, 값 칸에 한 줄을 추가합니다. 결과적으로 값 칸은 두 줄이 됩니다.

```
"google-site-verification=복사한값"
"v=spf1 include:_spf.google.com ~all"
```

STEP 0에서 `v=spf1`로 시작하는 기존 값이 있었다면 새 줄을 추가하지 않고, 그 한 줄 안에 `include:_spf.google.com`을 넣어 합칩니다. `v=spf1` 줄은 도메인당 반드시 하나여야 합니다.

### 1-6. DKIM 레코드 (전자 도장)

1. `admin.google.com › 앱 › Google Workspace › Gmail › 이메일 인증`을 엽니다.
2. 도메인을 고르고 새 레코드 생성을 누릅니다. 키 길이 2048비트, 선택기 `google` 그대로 둡니다.
3. 화면에 나온 TXT 값을 복사해 Route 53에 넣습니다.

| 항목 | 값 |
| --- | --- |
| 레코드 이름 | `google._domainkey` |
| 유형 | TXT |
| 값 | `"v=DKIM1; k=rsa; p=앞부분..." "...뒷부분"` |
| TTL | 300 |

4. 2048비트 값은 255자를 넘습니다. Route 53은 따옴표 한 쌍에 255자까지만 받으므로, 값을 두 토막으로 잘라 각각 따옴표로 감싸고 사이에 공백 한 칸을 둡니다. 줄바꿈으로 나누면 안 됩니다.
5. Google 화면으로 돌아가 인증 시작을 누릅니다.

`[확인]` 상태가 "DKIM으로 이메일 인증 중"으로 바뀝니다. 가입 직후에는 새 레코드 생성 버튼이 준비되지 않았다는 안내가 나올 수 있습니다. 그때는 하루 뒤 다시 합니다.

### 1-7. 개통 확인

1. 시험용 Gmail 주소에서 `대표계정@sogaebaenk.co.kr`로 메일을 보냅니다. 받은편지함에 도착하면 수신 성공입니다.
2. 회사 계정에서 시험용 Gmail · 네이버 주소로 답장을 보냅니다.
3. Gmail에서 받은 메일의 `⋮ › 원본 보기`를 엽니다.

`[확인]` SPF `PASS`, DKIM `PASS`가 보입니다. DMARC는 STEP 3 뒤에 `PASS`가 됩니다.

## 5. STEP 2 · Amazon SES 도메인 인증 (30\~40분)

SES에 "`mail.sogaebaenk.co.kr`은 우리 도메인"임을 증명하고, 전자 도장(DKIM)과 반송 주소(MAIL FROM)를 한 번에 설정합니다. DNS가 같은 AWS 계정의 Route 53에 있어 레코드는 대부분 자동으로 들어갑니다.

### 2-1. 리전 확인

콘솔 오른쪽 위가 **아시아 태평양(서울)** 인지 확인합니다. SES의 인증, 시험 모드 상태, SMTP 비밀번호는 리전마다 따로입니다. 다른 리전에서 만들면 서울에서는 보이지 않습니다.

### 2-2. 도메인 자격 증명 만들기

`콘솔 › Amazon SES › 구성 › 자격 증명 › 자격 증명 생성`

| 항목 | 값 |
| --- | --- |
| 자격 증명 유형 | 도메인 |
| 도메인 | `mail.sogaebaenk.co.kr` |
| 사용자 지정 MAIL FROM 도메인 사용 | 체크 |
| MAIL FROM 도메인 | `bounce` (완성형: `bounce.mail.sogaebaenk.co.kr`) |
| MX 실패 시 동작 | 기본 MAIL FROM 도메인 사용 |
| DKIM 방식 | Easy DKIM |
| DKIM 서명 키 길이 | RSA 2048비트 |
| DKIM 서명 | 활성화 |
| DNS 레코드를 Route 53에 게시 | 체크 (MAIL FROM, DKIM 두 곳 모두) |

자격 증명 생성을 누릅니다.

### 2-3. 레코드가 들어갔는지 확인

`Route 53 › 호스팅 영역 › sogaebaenk.co.kr`에 아래 5개가 생겼는지 봅니다. "Route 53에 게시" 체크 상자가 보이지 않았거나 레코드가 없으면, SES 자격 증명 상세 화면의 "DNS 레코드 게시" 표에 나온 값을 그대로 복사해 직접 만듭니다.

| 용도 | 레코드 이름 | 유형 | 값 |
| --- | --- | --- | --- |
| DKIM (3개) | `토큰._domainkey.mail` | CNAME | SES 화면에 나온 값 (`토큰.dkim.amazonses.com` 형태) |
| 반송 수신 | `bounce.mail` | MX | `10 feedback-smtp.ap-northeast-2.amazonses.com` |
| 반송 주소 SPF | `bounce.mail` | TXT | `"v=spf1 include:amazonses.com ~all"` |

- DKIM 토큰은 계정마다 다릅니다. 직접 타이핑하지 말고 화면의 복사 버튼을 씁니다.
- CNAME 값에는 따옴표를 붙이지 않습니다.
- `bounce.mail`의 MX는 반드시 하나만 둡니다. [AWS 문서](https://docs.aws.amazon.com/ses/latest/DeveloperGuide/mail-from.html)상 MX가 여러 개면 설정이 실패합니다.
- 기존 와일드카드 `*.sogaebaenk.co.kr` A 레코드는 건드리지 않습니다. 서로 충돌하지 않습니다.

### 2-4. 인증 완료 확인

```powershell
nslookup -type=MX  bounce.mail.sogaebaenk.co.kr 8.8.8.8
nslookup -type=TXT bounce.mail.sogaebaenk.co.kr 8.8.8.8
```

`[확인]` SES 자격 증명 화면에서 세 가지가 모두 초록색입니다: 자격 증명 상태 "확인됨", DKIM 구성 "성공", MAIL FROM 구성 "성공". 보통 수 분에서 1시간 안에 끝나고, 길면 72시간까지 걸릴 수 있습니다.

### 2-5. 시험 모드에서 첫 발송

1. 받을 주소를 먼저 인증합니다. `자격 증명 생성 › 이메일 주소`에 대표의 회사 메일 주소를 넣고, 도착한 확인 메일의 링크를 누릅니다.
2. `자격 증명 › mail.sogaebaenk.co.kr › 테스트 이메일 전송`을 엽니다.
3. 보내는 주소 `no-reply`, 시나리오 "사용자 지정", 받는 주소에 방금 인증한 주소를 넣고 보냅니다.

`[확인]` 메일이 도착하고, Gmail에서 보낸사람 옆 ▼(세부정보)를 누르면 `mailed-by: bounce.mail.sogaebaenk.co.kr`, `signed-by: mail.sogaebaenk.co.kr`이 보입니다.

`[실패 시]` "Email address is not verified" 오류는 시험 모드 제한입니다. 받는 주소가 인증된 주소인지 확인합니다. 인증하지 않은 주소로는 STEP 4 승인 뒤에만 보낼 수 있습니다.

## 6. STEP 3 · DMARC 설정 (10분)

레코드 하나로 회사 메일과 자동 발송 메일 양쪽에 위조 방지 규칙이 걸립니다. 처음에는 감시만 하는 `p=none`으로 시작하고, 보고서를 본 뒤 단계적으로 강화합니다.

### 3-1. 레코드 추가

`Route 53 › 호스팅 영역 › sogaebaenk.co.kr › 레코드 생성`

| 항목 | 값 |
| --- | --- |
| 레코드 이름 | `_dmarc` |
| 유형 | TXT |
| 값 | `"v=DMARC1; p=none; rua=mailto:dmarc@sogaebaenk.co.kr"` |
| TTL | 300 |

- 본 도메인에 건 규칙은 하위 도메인 `mail.sogaebaenk.co.kr`에도 그대로 적용됩니다. 따로 만들지 않습니다.
- `rua` 주소는 STEP 1-3에서 만든 `dmarc@` 그룹입니다. 받는 쪽 메일 업체들이 하루 한 번 보고서를 보냅니다.

`[확인]` `nslookup -type=TXT _dmarc.sogaebaenk.co.kr 8.8.8.8` 결과에 위 값이 나옵니다.

### 3-2. 단계적 강화 일정

| 시점 | `p=` 값 | 받는 쪽의 처리 |
| --- | --- | --- |
| 지금 | `none` | 검사에 실패해도 그대로 전달하고 보고서만 보냄 |
| 2주 뒤, 보고서에서 정상 발송이 모두 통과일 때 | `quarantine` | 실패한 메일을 스팸함으로 보냄 |
| 그로부터 4주 뒤 | `reject` | 실패한 메일을 거부. 도메인 사칭이 차단됨 |

보고서는 XML 첨부 파일이라 읽기 어렵습니다. 처음 2주는 한 가지만 봅니다: 발신 서버가 Google과 `amazonses.com` 두 곳뿐인지. 모르는 발신원이 정상 통과로 찍혀 있으면 어디서 보내는지 찾아 SPF · DKIM을 맞춘 뒤 강화합니다.

### 3-3. 왜 필요한가

Gmail은 하루 5,000통 이상 보내는 발신자에게 SPF, DKIM, DMARC를 모두 요구하고, 스팸 신고율 0.3% 미만을 요구합니다. 그보다 적게 보내도 인증이 없으면 스팸함으로 갈 가능성이 커집니다.

## 7. STEP 4 · SES 프로덕션 신청 (20분 + 회신 대기)

신규 계정은 시험 모드(샌드박스)라 인증된 주소로만, 하루 200통, 초당 1통까지만 보낼 수 있습니다. 이 신청이 승인되어야 일반 회원에게 메일이 나갑니다. [AWS 안내](https://docs.aws.amazon.com/ses/latest/DeveloperGuide/request-production-access.html)상 첫 회신은 24시간 안에 옵니다.

### 4-1. 신청 화면 열기

`콘솔 › Amazon SES › 계정 대시보드`에서 위쪽 경고 상자 "계정이 샌드박스에 있습니다"의 `설정 페이지 보기 › 프로덕션 액세스 요청`을 누릅니다. STEP 2의 도메인 인증이 끝난 뒤 신청해야 승인이 빠릅니다.

### 4-2. 입력값

| 항목 | 값 |
| --- | --- |
| 메일 유형 | 트랜잭션 (Transactional) |
| 웹사이트 URL | `https://sogaebaenk.co.kr` |
| 추가 연락처 | `admin@sogaebaenk.co.kr` (STEP 1-3의 그룹 주소) |
| 연락 언어 | English |
| 사용 사례 설명 | 아래 예문을 실제 값으로 고쳐 붙여 넣기 |

### 4-3. 사용 사례 설명 예문

숫자와 서비스 설명은 실제에 맞게 고칩니다. 사실과 다르게 쓰면 나중에 계정 정지 사유가 됩니다.

```
Service: SoGaeBaenk (https://sogaebaenk.co.kr), a referral marketplace platform in Korea.

Mail type: transactional only - sign-up email verification, password reset,
and account or transaction notifications.

Recipients: only users who registered on our website and entered their own
email address. We do not buy, rent, or scrape address lists.

Volume: about 300 emails per day at launch, growing to about 2,000 per day
within 6 months.

Sending domain: mail.sogaebaenk.co.kr. Easy DKIM, a custom MAIL FROM domain,
and a DMARC record are already configured.

Bounces and complaints: the account-level suppression list is enabled for
both bounces and complaints, and events are published to an SNS topic that
our operations team monitors. Suppressed addresses are not mailed again.

Opt-out: we do not send marketing mail from this account. If we add it
later, every message will include a one-click unsubscribe link.
```

### 4-4. 신청 뒤

1. 예문에 적은 반송 · 수신거부 처리는 실제로 켜야 합니다. 회신을 기다리는 동안 STEP 6을 먼저 끝냅니다.
2. AWS가 추가 질문을 보내면 `콘솔 › Support Center`의 해당 문의에 영어로 답합니다.
3. 심사자가 사이트를 열어 볼 수 있어야 합니다. 오픈 전이라면 서비스 소개 페이지라도 공개된 상태로 둡니다.

`[확인]` 계정 대시보드의 경고 상자가 사라지고, 승인된 일일 발송 한도와 초당 발송 속도가 표시됩니다.

`[실패 시]` 거절 회신이 오면 사유를 보완해 같은 문의에 다시 답합니다. 가장 흔한 사유는 수신자 확보 방법과 반송 처리 방법이 구체적이지 않은 경우입니다.

## 8. STEP 5 · 서버 연결 (1\~2시간)

운영 서버(API)는 비밀번호 없이 EC2에 붙은 IAM 역할로 SES를 호출합니다. 기존 "액세스 키를 만들지 않는다" 원칙과 같고, 새어 나갈 비밀값이 생기지 않습니다. SMTP 방식은 n8n처럼 SMTP만 받는 도구에만 씁니다.

| 방식 | 보관할 비밀값 | 쓰는 곳 |
| --- | --- | --- |
| A. SES API + EC2 역할 (추천) | 없음 | 소개뱅크 API 서버 |
| B. SMTP 자격 증명 | SMTP 사용자 이름과 비밀번호 | n8n 등 SMTP 입력 칸만 있는 도구 |

### 5-1. 운영 EC2 역할에 발송 권한 추가

1. `콘솔 › EC2 › 인스턴스 › 운영 서버 › 보안 탭`에서 IAM 역할 이름을 확인하고 누릅니다.
2. `권한 추가 › 인라인 정책 생성 › JSON`에 아래를 붙여 넣습니다. `<계정ID>`는 콘솔 오른쪽 위 계정 메뉴의 12자리 숫자입니다.
3. 정책 이름은 `sgb-ses-send`로 저장합니다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SgbSendMail",
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": [
        "arn:aws:ses:ap-northeast-2:<계정ID>:identity/mail.sogaebaenk.co.kr",
        "arn:aws:ses:ap-northeast-2:<계정ID>:configuration-set/sgb-default"
      ],
      "Condition": {
        "StringLike": { "ses:FromAddress": "*@mail.sogaebaenk.co.kr" }
      }
    }
  ]
}
```

이 정책은 `mail.sogaebaenk.co.kr` 주소로만 보내게 막습니다. 서버가 뚫려도 다른 주소를 사칭해 보낼 수 없습니다.

### 5-2. 서버에서 권한 확인 (코드 없이)

운영 서버에 SSH로 접속해 입력합니다. 받는 주소는 STEP 2-5에서 인증한 주소입니다.

```bash
aws sesv2 send-email --region ap-northeast-2 \
  --from-email-address no-reply@mail.sogaebaenk.co.kr \
  --destination ToAddresses=받는주소@sogaebaenk.co.kr \
  --content "Simple={Subject={Data=SES test,Charset=UTF-8},Body={Text={Data=hello,Charset=UTF-8}}}"
```

`[확인]` `MessageId`가 출력되고 메일이 도착합니다.

`[실패 시]` `AccessDenied`면 5-1 정책의 계정ID와 도메인 철자를 확인합니다. `aws: command not found`면 서버에 AWS CLI가 없는 것이므로 5-4 코드 테스트로 넘어갑니다.

### 5-3. 환경변수 추가

API가 읽는 환경변수 파일 맨 아래에 추가합니다. 파일 위치와 변수 이름은 kit의 `.env.example`이 기준입니다(★ 확인 필요). 이미 메일 변수가 있으면 그 이름을 따릅니다.

```bash
# 메일 (Amazon SES) - 키 없음, EC2 역할 사용
MAIL_PROVIDER=ses
MAIL_FROM_NAME=소개뱅크
MAIL_FROM_ADDRESS=no-reply@mail.sogaebaenk.co.kr
MAIL_REPLY_TO=help@sogaebaenk.co.kr
SES_REGION=ap-northeast-2
SES_CONFIGURATION_SET=sgb-default
```

로컬 PC와 스테이징에는 `MAIL_PROVIDER=log`를 넣어 실제 발송 대신 로그만 남깁니다. 시험 데이터의 주소로 메일이 나가는 사고를 막습니다.

### 5-4. 예시 코드 (NestJS)

```bash
npm i @aws-sdk/client-sesv2
```

```ts
// src/mail/mail.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);

  // 키를 넣지 않습니다. EC2 역할에서 자격을 자동으로 얻습니다.
  private readonly ses = new SESv2Client({
    region: process.env.SES_REGION ?? 'ap-northeast-2',
  });

  // 한글 표시 이름은 MIME 인코딩을 해야 깨지지 않습니다.
  private from(): string {
    const name = process.env.MAIL_FROM_NAME ?? '';
    const addr = process.env.MAIL_FROM_ADDRESS as string;
    if (!name) return addr;
    const encoded = Buffer.from(name, 'utf8').toString('base64');
    return `=?UTF-8?B?${encoded}?= <${addr}>`;
  }

  async send(to: string, subject: string, html: string, text: string) {
    if (process.env.MAIL_PROVIDER !== 'ses') {
      this.log.log(`[mail:log] to=${mask(to)} subject=${subject}`);
      return undefined;
    }
    const out = await this.ses.send(
      new SendEmailCommand({
        FromEmailAddress: this.from(),
        Destination: { ToAddresses: [to] },
        ReplyToAddresses: process.env.MAIL_REPLY_TO
          ? [process.env.MAIL_REPLY_TO]
          : undefined,
        ConfigurationSetName: process.env.SES_CONFIGURATION_SET,
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: html, Charset: 'UTF-8' },
              Text: { Data: text, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
    this.log.log(`mail sent to=${mask(to)} id=${out.MessageId}`);
    return out.MessageId;
  }
}

// 로그에 주소 원문을 남기지 않습니다.
const mask = (e: string) => e.replace(/^(.).*(@.*)$/, '$1***$2');
```

### 5-5. 발송 기록 데이터 구조 (예시)

반송이나 민원이 왔을 때 "언제 무엇을 보냈는지" 답하려면 기록이 필요합니다. 주소 원문은 저장하지 않습니다.

```sql
CREATE TABLE mail_send_log (
  id            BIGSERIAL PRIMARY KEY,
  message_id    TEXT UNIQUE,                  -- SES가 돌려준 MessageId
  member_id     BIGINT,                       -- 받는 회원 (비회원이면 NULL)
  to_hash       TEXT NOT NULL,                -- 주소의 SHA-256 해시
  template_code TEXT NOT NULL,                -- 예: SIGNUP_VERIFY, PW_RESET
  status        TEXT NOT NULL DEFAULT 'SENT', -- SENT / DELIVERED / BOUNCED / COMPLAINED
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mail_send_log_member_idx ON mail_send_log (member_id, created_at DESC);
```

### 5-6. SMTP 방식 (n8n 등에서만)

1. `콘솔 › Amazon SES › SMTP 설정 › SMTP 자격 증명 생성`을 누릅니다. IAM 사용자 생성 화면으로 넘어갑니다.
2. 사용자 이름을 `sgb-ses-smtp`로 바꾸고 생성합니다.
3. 화면에 나온 SMTP 사용자 이름과 비밀번호를 내려받아 비밀번호 관리자에 넣습니다. 이 화면을 닫으면 다시 볼 수 없습니다.

| 설정 칸 | 값 |
| --- | --- |
| 호스트 | `email-smtp.ap-northeast-2.amazonaws.com` (SMTP 설정 화면의 값을 복사) |
| 포트 | `587` |
| 암호화 | STARTTLS |
| 사용자 이름 / 비밀번호 | 방금 내려받은 값 |
| 보내는 주소 | `no-reply@mail.sogaebaenk.co.kr` |

- 25번 포트는 쓰지 않습니다. EC2에서 기본으로 제한됩니다.
- SMTP 비밀번호는 AWS 로그인 비밀번호나 액세스 키와 다른 값이고, 서울 리전에서만 통합니다.

### 5-7. 반영

환경변수를 저장한 뒤 API를 다시 시작합니다. pm2 구성이면 `pm2 restart sgb --update-env`입니다(★ 프로세스 이름 확인 필요).

`[확인]` 사이트에서 가입 인증 메일을 요청하면, 로그에 `mail sent ... id=...`가 찍히고 메일이 도착합니다.

## 9. STEP 6 · 반송 · 수신거부 처리와 감시 (40분)

없는 주소로 계속 보내면 AWS가 계정의 발송을 멈춥니다. [AWS 기준](https://docs.aws.amazon.com/ses/latest/dg/reputationdashboardmessages.html)은 반송률 5% 이상이면 검토, 10% 이상이면 정지 가능, 스팸 신고율 0.1% 이상이면 검토, 0.5% 이상이면 정지 가능입니다. 이 단계는 STEP 5-7 반영 전에 끝냅니다.

### 6-1. 구성 세트 만들기

`콘솔 › Amazon SES › 구성 › 구성 세트 › 세트 생성`에서 이름을 `sgb-default`로 만듭니다. 나머지는 기본값입니다. 구성 세트는 "이 묶음으로 보낸 메일의 결과를 어디로 알릴지" 정하는 설정 묶음입니다.

`[주의]` 이 이름은 STEP 5의 정책과 환경변수에 적은 값과 글자 하나까지 같아야 합니다. 다르면 발송이 실패합니다.

### 6-2. 계정 수준 억제 목록 켜기

`Amazon SES › 구성 › 억제 목록 › 계정 수준 설정 › 편집`에서 반송과 수신 거부(스팸 신고) 두 가지를 모두 체크합니다. 이미 켜져 있으면 그대로 둡니다.

한 번 반송되거나 신고한 주소는 SES가 목록에 올리고, 이후 그 주소로의 발송을 스스로 막습니다. 코드를 짜지 않아도 되는 가장 중요한 안전장치입니다.

### 6-3. 결과 알림 받기

1. `콘솔 › Simple Notification Service › 주제 › 주제 생성`에서 유형 표준, 이름 `sgb-mail-events`로 만듭니다. 기존 `sgb-alerts`는 장애 알림용이라 섞지 않습니다.
2. `구독 생성 › 프로토콜 이메일`에 `admin@sogaebaenk.co.kr`을 넣고, 도착한 메일의 확인 링크를 누릅니다.
3. `Amazon SES › 구성 세트 › sgb-default › 이벤트 대상 › 대상 추가`를 엽니다.
4. 이벤트 유형은 반송, 수신 거부, 거부 세 가지를 고릅니다. 대상은 Amazon SNS, 주제는 `sgb-mail-events`입니다.

`[확인]` 구독 상태가 `확인됨`입니다.

처음에는 메일 알림으로 충분합니다. 하루 발송이 수백 통을 넘으면 같은 주제에 HTTPS 구독(API 또는 n8n 웹훅)을 추가해 `mail_send_log.status`를 자동으로 고칩니다.

### 6-4. 평판 경보

`콘솔 › CloudWatch › 경보 › 경보 생성 › 지표 선택 › SES › 계정 지표`에서 두 개를 만듭니다. 값은 비율이라 3%는 `0.03`으로 적습니다.

| 경보 이름 | 지표 | 조건 | 알림 보낼 곳 |
| --- | --- | --- | --- |
| `sgb-ses-bounce` | `Reputation.BounceRate` | 0.03 이상 | `sgb-alerts` |
| `sgb-ses-complaint` | `Reputation.ComplaintRate` | 0.0008 이상 | `sgb-alerts` |

AWS의 검토 기준(5%, 0.1%)보다 낮게 잡아, 조치할 시간을 벌어 둡니다.

### 6-5. 코드에서 지킬 규칙 3가지

1. 인증이 끝나지 않은 주소로는 인증 메일만 보냅니다. 알림 메일은 인증된 주소에만 보냅니다.
2. 인증 메일 재발송은 주소당 횟수를 제한합니다(예: 1시간에 3회). 남의 주소를 넣어 메일을 쏟아붓는 장난이 곧 스팸 신고로 돌아옵니다.
3. 반송된 주소는 회원 정보에 표시하고, 다음 로그인 때 주소를 다시 입력받습니다.

### 6-6. 반송 처리 시험

SES가 제공하는 시험용 주소로 보냅니다. 이 주소들은 실제 평판 수치에 반영되지 않습니다.

| 받는 주소 | 일어나는 일 |
| --- | --- |
| `success@simulator.amazonses.com` | 정상 전달 |
| `bounce@simulator.amazonses.com` | 반송 발생 |
| `complaint@simulator.amazonses.com` | 스팸 신고 발생 |

`[확인]` `bounce@` 주소로 보낸 뒤 몇 분 안에 `admin@` 그룹으로 반송 알림(영문 JSON)이 도착합니다. 시험할 때는 STEP 5-2 명령 끝에 `--configuration-set-name sgb-default`를 붙여야 알림이 옵니다.

## 10. STEP 7 · 테스트 (30분)

아래 8가지가 모두 통과해야 개통 완료입니다. 4번 이후는 STEP 4 승인 뒤에 합니다.

| # | 시험 | 방법 | 통과 기준 |
| --- | --- | --- | --- |
| 1 | 회사 메일 수신 | 외부 Gmail에서 회사 주소로 발송 | 받은편지함 도착 |
| 2 | 회사 메일 발신 | 회사 주소에서 Gmail · 네이버로 발송 | 스팸함이 아닌 받은편지함 도착 |
| 3 | 공용 주소 수신 | 외부에서 `help@`로 발송 | 그룹 구성원 모두 수신 |
| 4 | 자동 발송 | 사이트에서 가입 인증 메일 요청 | Gmail · 네이버 양쪽 받은편지함 도착 |
| 5 | 인증 결과 | Gmail에서 4번 메일의 `⋮ › 원본 보기` | SPF, DKIM, DMARC 세 줄 모두 `PASS` |
| 6 | 답장 경로 | 4번 메일에 답장 | `help@` 그룹으로 도착 |
| 7 | 한글 표시 | 4번 메일의 보낸사람 이름과 제목 | 글자 깨짐 없음 |
| 8 | 반송 알림 | STEP 6-6의 `bounce@` 시험 | `admin@` 그룹에 알림 도착 |

### 오류가 났을 때 확인 순서

1. DNS: `nslookup`으로 해당 레코드가 실제로 조회되는지 봅니다.
2. 콘솔 상태: SES 자격 증명의 세 항목과 Google 이메일 인증 상태가 정상인지 봅니다.
3. 권한: 서버에서 STEP 5-2 명령이 `MessageId`를 돌려주는지 봅니다.
4. 앱 로그: `mail sent` 줄이 있는지, 오류 메시지가 무엇인지 봅니다.
5. 받는 쪽: 스팸함을 확인하고, 원본 보기에서 어느 검사가 실패했는지 봅니다.

앞 단계가 실패했으면 뒤 단계는 볼 필요가 없습니다. 반드시 1번부터 봅니다.

### 개통 뒤 1주일

- 네이버 등 국내 메일은 새 도메인에 보수적입니다. 첫 며칠은 스팸함으로 가는지 매일 한 번 확인합니다.
- `postmaster.google.com`에 `mail.sogaebaenk.co.kr`을 등록하면 Gmail 쪽 스팸 신고율을 볼 수 있습니다. 하루 발송이 수백 통을 넘은 뒤부터 수치가 표시됩니다.

## 11. 발생할 수 있는 문제와 해결

초보자가 가장 자주 막히는 곳은 DNS 입력 실수입니다. 아래 12건 중 5건(1, 3, 4, 5, 6번)이 레코드 문제입니다.

| # | 증상 | 원인 | 해결 |
| --- | --- | --- | --- |
| 1 | 회사 메일이 들어오지 않음 | MX 미반영, 오타, 옛 MX가 남아 있음 | `nslookup -type=MX`로 `smtp.google.com` 하나만 나오는지 확인. 최대 72시간 대기 |
| 2 | `help@`로 보낸 외부 메일이 반송됨 | 그룹의 외부 게시 허용이 꺼짐 | STEP 1-3의 4번 설정 |
| 3 | 보낸 메일이 스팸함으로 감 | `v=spf1` 줄이 2개, DKIM 인증 시작을 안 누름, DMARC 없음 | 원본 보기에서 실패한 항목 확인 후 해당 STEP 재점검 |
| 4 | Route 53에서 TXT 저장 오류 | 255자 초과, 또는 같은 이름 레코드를 새로 만들려 함 | 값을 두 토막으로 나눔. 기존 레코드를 편집해 줄 추가 |
| 5 | SES 자격 증명이 계속 "확인 보류" | 레코드 이름에 도메인을 두 번 적음 (`...co.kr.sogaebaenk.co.kr`) | Route 53 레코드 이름 칸에는 앞부분만 적음 |
| 6 | Google DKIM이 인증되지 않음 | 값 토막을 줄바꿈으로 나눔, 따옴표 누락 | 한 줄에 `"토막1" "토막2"` 형태로 다시 입력 |
| 7 | `Email address is not verified` | 시험 모드, 또는 서울이 아닌 리전으로 호출 | STEP 4 승인 대기. 코드의 리전 값 확인 |
| 8 | `AccessDenied ... ses:SendEmail` | 정책의 계정ID · 도메인 오타, 보내는 주소가 `mail.` 도메인이 아님 | STEP 5-1 정책과 `MAIL_FROM_ADDRESS` 대조 |
| 9 | `Configuration set does not exist` | `sgb-default`를 안 만들었거나 이름이 다름 | STEP 6-1 |
| 10 | 보낸사람 이름이 깨져 보임 | 한글 이름의 MIME 인코딩 누락 | STEP 5-4의 `from()` 사용 |
| 11 | SMTP 연결 시간 초과 | 25번 포트 사용 | 587번으로 변경 |
| 12 | 프로덕션 신청 거절 | 수신자 확보 · 반송 처리 설명 부족, 사이트 미공개 | STEP 4-4대로 보완해 같은 문의에 회신 |

### 되돌리는 방법

- 회사 메일: MX를 STEP 0에서 기록한 옛 값으로 되돌리면 이전 메일함으로 다시 들어갑니다. 그래서 옛 메일함은 개통 뒤 2주 동안 해지하지 않습니다.
- 자동 발송: 환경변수 `MAIL_PROVIDER=log`로 바꾸고 다시 시작하면 발송이 즉시 멈춥니다. DNS 레코드는 남겨 두어도 해가 없습니다.

## 12. 현장 체크리스트

작업하면서 하나씩 체크합니다. 전부 체크되면 개통 완료입니다.

### 시작 전

- [ ] `nslookup -type=NS` 결과가 `awsdns` 4개임
- [ ] 기존 MX · SPF · DMARC 값을 표에 기록함
- [ ] Route 53 레코드 목록을 캡처해 보관함
- [ ] 계정 명단과 공용 주소 목록을 확정함

### 회사 메일함 (STEP 1)

- [ ] 도메인 소유권 확인됨
- [ ] 사용자 계정 생성, 공용 주소는 그룹으로 생성
- [ ] 그룹의 외부 게시 허용을 켬
- [ ] MX가 `smtp.google.com` 하나뿐임
- [ ] 본 도메인의 `v=spf1` 줄이 정확히 하나임
- [ ] Google 이메일 인증 상태가 "인증 중"임
- [ ] 외부 주소와 송수신 시험 통과

### 자동 발송 (STEP 2 \~ 4)

- [ ] 콘솔 리전이 서울임
- [ ] SES 자격 증명 상태, DKIM, MAIL FROM 세 항목이 모두 정상
- [ ] `_dmarc` 레코드가 조회됨
- [ ] 프로덕션 신청 제출, 승인 회신 받음

### 서버와 감시 (STEP 5 \~ 7)

- [ ] 운영 EC2 역할에 `sgb-ses-send` 정책 추가
- [ ] 서버에서 CLI 시험 발송 시 `MessageId` 출력
- [ ] 구성 세트 `sgb-default` 생성, 이름이 정책 · 환경변수와 일치
- [ ] 계정 수준 억제 목록에 반송 · 수신 거부 모두 체크
- [ ] `sgb-mail-events` 구독 확인됨
- [ ] 평판 경보 2개 생성
- [ ] 로컬 · 스테이징은 `MAIL_PROVIDER=log`
- [ ] STEP 7의 8개 시험 모두 통과

### 개통 후

- [ ] Google 계정 전원 2단계 인증 적용
- [ ] 2주 뒤 DMARC 보고서 확인 후 `p=quarantine`으로 변경
- [ ] 옛 메일함이 있었다면 2주 뒤 해지

## 13. 운영 · 보안 · 법 규정 주의사항

개통 뒤 사고는 대부분 계정 탈취와 광고성 메일 규정 위반에서 납니다. 아래 표의 주기만 지키면 됩니다.

### 13-1. 정기 점검

| 주기 | 할 일 | 어디서 |
| --- | --- | --- |
| 매주 | 반송률 · 신고율 확인 | `Amazon SES › 평판 지표` |
| 매주 (첫 2주) | DMARC 보고서에서 모르는 발신원 확인 | `dmarc@` 그룹 메일 |
| 매월 | 계정 수와 실제 인원 대조, 퇴사자 계정 정지 | `admin.google.com › 사용자` |
| 매월 | 요금 확인 | AWS 청구서, Google 결제 화면 |
| 분기 | DMARC 정책 단계와 SPF 줄 수 점검 | Route 53 |

### 13-2. 보안

1. Google 계정은 전원 2단계 인증을 강제합니다. `admin.google.com › 보안 › 인증 › 2단계 인증`에서 적용합니다.
2. 최고 관리자 계정을 2개 둡니다. 하나가 잠겨도 복구할 수 있습니다.
3. 퇴사자는 당일 계정을 정지하고, 받은 메일은 그룹이나 후임 계정으로 돌립니다.
4. SMTP 비밀번호를 쓰는 경우 코드 저장소에 올리지 않고, 담당자가 바뀌면 새로 발급합니다.
5. 고객 개인정보가 담긴 파일은 메일에 첨부하지 않습니다. 운영 화면의 링크로 공유합니다.
6. 로그에는 메일 주소 원문을 남기지 않습니다. STEP 5-4의 `mask()`를 씁니다.

### 13-3. 광고성 메일 규정 (정보통신망법 제50조)

이 문서의 자동 발송은 가입 인증, 비밀번호 재설정, 거래 알림 같은 안내성 메일만 다룹니다. 이벤트나 홍보 문구를 섞는 순간 광고성 정보가 되어 아래가 필요합니다.

| 요건 | 내용 |
| --- | --- |
| 사전 수신 동의 | 개인정보 수집 동의와 별도 항목으로, "광고성 정보 수신 동의"임을 밝혀 받음 |
| 제목 표시 | 제목 맨 앞에 `(광고)` |
| 본문 표시 | 보낸 곳의 명칭과 연락처, 수신거부 방법 |
| 수신거부 | 비용 없이 쉽게 거부할 수 있어야 하고, 거부한 사람에게는 보내지 않음 |
| 재확인 | 수신 동의 여부를 2년마다 확인 |

- 전자우편은 야간(오후 9시 \~ 오전 8시) 전송 제한의 예외입니다. 문자와 알림톡은 예외가 아닙니다.
- 법령은 개정될 수 있습니다. 광고성 메일을 시작하기 전에 국가법령정보센터에서 현행 조문을 다시 확인합니다.

### 13-4. 확장할 때

| 상황 | 조치 |
| --- | --- |
| 홍보 · 소식 메일을 보내기 시작함 | 하위 도메인 `news.sogaebaenk.co.kr`을 SES에 따로 인증하고, 구성 세트도 분리. 원클릭 수신거부 헤더 추가 |
| 하루 5,000통을 넘김 | Gmail 대량 발신자 기준 적용. DMARC를 `quarantine` 이상으로 올린 상태여야 안전 |
| 스테이징에서도 실제 발송 시험이 필요함 | 받는 주소를 회사 도메인으로 제한하는 코드 조건을 넣고 `MAIL_PROVIDER=ses`로 변경 |
| n8n에서 메일 발송 | STEP 5-6의 SMTP 값을 n8n 자격 증명에 등록. 자동화 서버 역할에는 SES 권한을 주지 않음 |

## 14. 결정 · 확인 필요 사항과 다음 할 일

작업 전에 정해야 할 것은 6건, 실측으로 확인할 것은 3건입니다. 값이 없는 항목은 임의로 채우지 않았습니다.

### 14-1. 정할 것

| # | 사항 | 이 문서의 기본값 | 언제까지 |
| --- | --- | --- | --- |
| 1 | 메일함 서비스 | Google Workspace Business Starter | STEP 1 전 |
| 2 | 계정 명단과 공용 주소 | `help@` · `admin@` · `dmarc@` 그룹 3개 | STEP 1-3 전 |
| 3 | 자동 발송 주소와 표시 이름 | `소개뱅크 <no-reply@mail.sogaebaenk.co.kr>` | STEP 2 전 |
| 4 | 프로덕션 신청서에 적을 예상 발송량 | 하루 300통에서 2,000통 (가정값) | STEP 4 전 |
| 5 | 약정 방식 | 연간 약정 (월 단위보다 사용자당 1.40달러 저렴) | 14일 무료 기간 종료 전 |
| 6 | 광고성 메일 발송 여부 | 보내지 않음 (이 문서 범위 밖) | 필요해질 때 |

### 14-2. 확인할 것

| # | 사항 | 확인 방법 |
| --- | --- | --- |
| 1 | 법인 구글 계정이 이미 Google Workspace인지 | `admin.google.com` 로그인 가능 여부, STEP 0-2의 MX 결과 |
| 2 | 카페24 · 가비아의 기존 메일 계정 사용 여부 | STEP 0-2의 MX 결과, 각 업체 관리 화면 |
| 3 | kit의 메일 관련 환경변수 이름, 환경변수 파일 위치, API 프로세스 이름 | `.env.example`과 서버의 `pm2 status` |

### 14-3. 다음에 바로 할 일

1. 사무실 PC에서 STEP 0의 `nslookup` 명령 4줄을 실행하고 결과를 표에 적습니다.
2. 계정 명단(이름, 원하는 주소)을 6\~20명분 작성합니다.
3. 1일차 작업 시간을 반나절 확보하고, STEP 1부터 STEP 4 신청까지 같은 날 끝냅니다.

## 15. 근거와 한계 (2026-10-07 확인)

요금, 한도, 설정값은 아래 공식 문서에서 확인했습니다. 요금과 화면 구성은 바뀔 수 있으므로 작업 당일 한 번 더 봅니다.

| 항목 | 확인한 내용 | 출처 |
| --- | --- | --- |
| Amazon WorkMail | 2026-04-30부터 신규 고객 미수용, 2027-03-31 지원 종료. 이 문서에서 제외한 이유 | [AWS WorkMail 지원 종료 안내](https://docs.aws.amazon.com/workmail/latest/adminguide/workmail-end-of-support.html) |
| EC2 25번 포트 | 외부 방향 25번은 기본 차단, 해제는 별도 요청. 직접 설치를 택하지 않은 이유 | [AWS 지식 센터](https://repost.aws/knowledge-center/ec2-port-25-throttle) |
| SES 요금 | Essentials 1,000통당 0.16달러, 낱개 요금 0.10달러, 첨부 1GB당 0.12달러. 2026-07-21부터 신규 계정은 Essentials | [Amazon SES 요금](https://aws.amazon.com/ses/pricing/) |
| SES 시험 모드 | 하루 200통, 초당 1통, 첫 회신 24시간 이내 | [프로덕션 액세스 요청](https://docs.aws.amazon.com/ses/latest/DeveloperGuide/request-production-access.html) |
| SES MAIL FROM | MX `10 feedback-smtp.리전.amazonses.com`, SPF `v=spf1 include:amazonses.com ~all`, MX는 하나만 | [사용자 지정 MAIL FROM](https://docs.aws.amazon.com/ses/latest/DeveloperGuide/mail-from.html) |
| SES SMTP | STARTTLS는 25 · 587 · 2587, TLS 래퍼는 465 · 2465 | [SMTP 엔드포인트 연결](https://docs.aws.amazon.com/ses/latest/dg/smtp-connect.html) |
| SES 평판 기준 | 반송률 5% 검토 · 10% 정지 가능, 신고율 0.1% 검토 · 0.5% 정지 가능 | [평판 지표 메시지](https://docs.aws.amazon.com/ses/latest/dg/reputationdashboardmessages.html) |
| Google MX | `smtp.google.com` 우선순위 1, 반영 최대 72시간 | [Google Workspace MX 설정](https://support.google.com/a/answer/61158?hl=en) |
| Google 요금 | Business Starter 연간 약정 7달러, 월 단위 8.40달러 | [Google 요금제 비교](https://knowledge.workspace.google.com/admin/billing/compare-flexible-and-annual-fixed-term-payment-plans?hl=ko) |
| 네이버웍스 메일 | 메일은 Standard · Standard Plus 요금제에서 제공 | [네이버웍스 메일 소개](https://help.worksmobile.com/ko/use-guides/mail/overview/) |
| Gmail 발신자 기준 | 하루 5,000통 이상은 SPF · DKIM · DMARC, 신고율 0.3% 미만 (2차 자료) | [GMass 정리](https://www.gmass.co/blog/gmail-bulk-sender-guidelines/) |
| 프로젝트 기준 | 도메인, 리전, IAM 사용자, "액세스 키 없음" 원칙, Route 53 위임 | AWS적용절차 v2.0, 도메인 AWS이전 절차 v1.0 |

### 확인하지 못한 것

- 네이버웍스와 가비아 하이웍스의 현재 요금은 공식 요금 페이지를 열어 보지 못했습니다. 표의 금액은 참고값입니다.
- Google SPF 값(`include:_spf.google.com`)과 DKIM 선택기(`google`)는 여러 2차 자료에서 일치했지만, Google 공식 문서 원문은 직접 열지 못했습니다. Google 설정 화면이 보여 주는 값을 우선합니다.
- 정보통신망법 제50조 요약은 2차 자료 기준입니다. 현행 조문 확인이 필요합니다.
- AWS · Google 콘솔의 한국어 메뉴명은 실제 화면과 표기가 조금 다를 수 있습니다. 아래 영어 명칭으로 찾으면 됩니다.

### 화면 명칭 대응

| 이 문서 표기 | 영어 화면 |
| --- | --- |
| 자격 증명 | Identities |
| 구성 세트 | Configuration sets |
| 이벤트 대상 | Event destinations |
| 억제 목록 | Suppression list |
| 프로덕션 액세스 요청 | Request production access |
| SMTP 설정 | SMTP settings |
| 평판 지표 | Reputation metrics |
| 이메일 인증 (Google) | Authenticate email |
