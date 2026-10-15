# 소개뱅크 — AWS 구축 절차서 v2.5 (상세판)

> **★ 2026-10-03 (킷 v10.16) — 아래 부분은 `docs/60_로컬점검_AWS적용절차_v10.16_20261003.md` 로 바뀌었습니다.**
> 이 문서를 쓴 뒤에 사용자 웹 · 운영 화면 · 배치 · 파일 올리기가 더해졌고, 이 문서는 API 만 다룹니다.
>
> | 이 문서 | 지금은 | 이유 |
> |---|---|---|
> | 6-1 Node 20 | **Node 22** | 킷을 22 에서 검정합니다(`deploy/aws/apply.sh` 는 22 가 아니면 멈춥니다) |
> | 7-2 ~ 7-6 (압축 풀기 · 설치 · 마이그레이션 · 빌드 · pm2) | **`deploy/aws/apply.sh` 한 줄** | 사용자 웹 · 운영 화면 빌드, 배치 호출기, 판 교체 · 자동 복귀까지 합니다. `.env`(7-3) · 암호화 열쇠(7-3-1)는 그대로 유효합니다 |
> | 7-6 `pm2 start dist/main.js` · `pm2 restart sgb --update-env` | pm2 가 `deploy/aws/run-*.sh` 를 부릅니다 — `.env` 를 고친 뒤 `pm2 restart sgb` 만 | 실행 스크립트가 `.env` 를 직접 읽습니다 |
> | 8-1 Nginx (전부 3000 으로) | **`deploy/aws/nginx-render.sh`** | 그 설정에서는 메인이 404 입니다(API 에는 화면이 없습니다). 사용자 웹(5174)이 앞에 서야 합니다 |
> | 10-5 `S3_UPLOAD_BUCKET` · `S3_PUBLIC_BUCKET` · `CDN_BASE_URL` | **`S3_BUCKET`** | 지금 코드가 읽는 이름입니다(`deploy/aws/env.production.example`) |
> | 14-1 「나와야 하는 값」 · 부록의 수치 | `docs/60` 12부 | 9/28 기준 수치입니다 |
> | 16-3 「완전히 다시 배포」(`rm -rf sgb`) | **`deploy/aws/rollback.sh`** | `rm -rf sgb` 는 `.env` · `start.sh` · 올린 파일까지 지웁니다 |
>
> 1 ~ 5부(리전 · VPC · 보안 그룹 · RDS · EC2), 7-3 · 7-3-1, 9부(고정 IP), 11부(메일), 13부(백업)는 그대로 유효합니다.


2026-09-22 · **처음 하시는 분을 위해 화면마다 적었습니다**

---

## 0. 읽기 전에

### 이 문서를 쓰는 법

```
① 위에서부터 순서대로 하십시오
② 한 단계가 끝나면 「확인」을 반드시 해 보십시오
③ 안 되면 다음으로 가지 마시고 16부를 보십시오
```

**건너뛰면 나중에 어디서 틀렸는지 못 찾습니다.**

### 걸리는 시간

| 단계 | 시간 | 기다림 |
|---|---|---|
| 1~4 (리전 · VPC · 보안 · RDS) | 40분 | RDS 생성 15분 |
| 5~7 (EC2 · 서버 · 배포) | 60분 | — |
| 8 (도메인 · HTTPS) | 30분 | DNS 2시간 |
| 9 (**고정 IP**) | 5분 | — |
| 10~12 (S3 · 메일 · 백업) | 50분 | CloudFront 15분 · SES 72시간 |

**하루면 끝납니다.** 다만 DNS와 SES 검증은 기다려야 합니다.

### 돈

```
EC2 t3.small       월 2만원
RDS db.t4g.micro   월 2만원
S3 · CloudFront    월 1만원
Route53 (선택)     월 0.6천원
───────────────────────────
합계               월 5만원 안팎
```

> 프리 티어가 남아 있으면 첫 12개월은 더 쌉니다.

### 준비물

```
□ AWS 계정 (결제 수단 등록 완료)
□ 도메인 sogaebaenk.co.kr
□ sgb-integrated-kit.zip
□ 터미널 (맥: 터미널 / 윈도: PowerShell)
```

> **결제 수단을 등록하지 않으면** 만들다가 막힙니다.
> 먼저 확인하십시오.

---

# 1부 · 리전 고르기

## 1-1. 서울로 맞춥니다

```
1  AWS 콘솔에 로그인합니다
2  오른쪽 위 — 계정 이름 왼쪽에 지역 이름이 보입니다
3  눌러서 "아시아 태평양 (서울) ap-northeast-2" 를 고릅니다
```

### ★ 이후 모든 작업을 서울에서 하십시오

```
리전이 다르면 만든 것이 목록에 안 보입니다
```

**가장 흔한 실수입니다.** "분명 만들었는데 없다" 는 대개 이것입니다.

### 확인

주소창이 이렇게 되면 맞습니다.

```
...console.aws.amazon.com/...?region=ap-northeast-2
```

> **딱 한 곳만 예외입니다.** CloudFront 용 SSL 인증서는
> **버지니아 북부(us-east-1)** 에서 발급합니다. 12부에서 다시 말씀드립니다.

---

# 2부 · VPC — 서버가 들어갈 방

## 2-1. 왜 필요한가

```
퍼블릭 서브넷    웹 서버 — 바깥에서 들어와야 합니다
프라이빗 서브넷  DB — 주소를 알아도 못 들어옵니다
```

**DB를 바깥에 두면** 비밀번호만 알면 누구나 들어옵니다.

## 2-2. 만들기

```
1  위 검색창에 "VPC" 입력 → VPC 클릭
2  주황색 "VPC 생성" 버튼
3  맨 위에서 "VPC 등" 을 고릅니다   ★ "VPC만" 이 아닙니다
```

### 입력할 값

| 항목 | 값 |
|---|---|
| 이름 태그 자동 생성 | 체크 · `sgb` |
| IPv4 CIDR 블록 | `10.0.0.0/16` |
| IPv6 CIDR 블록 | IPv6 CIDR 블록 없음 |
| 테넌시 | 기본값 |
| 가용 영역(AZ) 수 | **2** |
| 퍼블릭 서브넷 수 | **2** |
| 프라이빗 서브넷 수 | **2** |
| NAT 게이트웨이 | **없음** |
| VPC 엔드포인트 | **없음** |
| DNS 호스트 이름 활성화 | 체크 |
| DNS 확인 활성화 | 체크 |

```
4  오른쪽에 그림이 그려집니다 — 서브넷 4개가 보이면 맞습니다
5  "VPC 생성"
```

### ★ NAT 게이트웨이를 "없음" 으로 두는 이유

```
월 4만원이 더 듭니다
```

프라이빗 서브넷에서 바깥으로 나갈 일이 없으면 필요 없습니다.
**나중에 필요해지면 그때 만드십시오.**

## 2-3. 확인

```
VPC → VPC → 목록에 sgb-vpc 가 보입니다
VPC → 서브넷 → sgb-subnet-public1-... 등 4개
```

---

# 3부 · 보안 그룹 — 어느 문을 여나

## 3-1. 웹 서버용

```
1  EC2 → 왼쪽 메뉴 "보안 그룹" → "보안 그룹 생성"
```

| 항목 | 값 |
|---|---|
| 보안 그룹 이름 | `sgb-web` |
| 설명 | `웹 서버 — HTTP/HTTPS/SSH` |
| VPC | **sgb-vpc** ← 기본값이 아닙니다 |

### 인바운드 규칙 — "규칙 추가" 를 세 번

| 유형 | 포트 | 소스 | 설명 |
|---|---|---|---|
| HTTP | 80 | `0.0.0.0/0` | 누구나 |
| HTTPS | 443 | `0.0.0.0/0` | 누구나 |
| SSH | 22 | **내 IP** | 나만 |

### ★ SSH를 0.0.0.0/0 으로 열지 마십시오

```
전 세계가 비밀번호를 찍어 봅니다
```

**실제로 몇 분 안에 시도가 들어옵니다.** 소스에서 "내 IP" 를
고르면 지금 쓰는 IP만 열립니다.

> 카페나 집을 옮기면 IP가 바뀌어 접속이 안 됩니다.
> 그때 이 규칙을 다시 "내 IP" 로 고치면 됩니다.

```
2  아웃바운드는 그대로 두십시오 (모든 트래픽 허용)
3  "보안 그룹 생성"
```

## 3-2. DB용

```
1  다시 "보안 그룹 생성"
```

| 항목 | 값 |
|---|---|
| 이름 | `sgb-db` |
| 설명 | `RDS — 웹 서버만` |
| VPC | **sgb-vpc** |

### 인바운드 규칙 — 한 개

| 유형 | 포트 | 소스 |
|---|---|---|
| PostgreSQL | 5432 | **sgb-web 선택** |

### ★ IP가 아니라 보안 그룹을 넣습니다

소스 칸을 클릭하면 보안 그룹 목록이 나옵니다. 거기서 `sgb-web`
을 고르십시오.

```
IP 를 넣으면     서버를 바꿀 때마다 규칙을 고쳐야 합니다
그룹을 넣으면    그 그룹에 속한 서버는 전부 통합니다
```

---

# 4부 · RDS — 데이터베이스

## 4-0. ★ 파라미터 그룹 먼저 (5분)

**RDS 를 만들기 전에** 해야 합니다. 나중에 붙이면 재부팅을 한 번 더 합니다.

```
RDS → 왼쪽 「파라미터 그룹」 → 「파라미터 그룹 생성」
```

| 항목 | 값 |
|---|---|
| 파라미터 그룹 패밀리 | **postgres16** |
| 유형 | DB Parameter Group |
| 그룹 이름 | `sgb-pg16` |
| 설명 | `소개뱅크 — pg_bigm 한글 검색` |

만든 뒤 **`sgb-pg16` 클릭 → 「편집」**

```
검색창에 shared_preload_libraries
값에  pg_bigm  → 변경 사항 저장
```

값이 비어 있으면 `pg_bigm` 만, 다른 값이 있으면 쉼표로 이어 붙이십시오.

### 왜 하나

```
5만 건 · 한글 2글자 검색 (실측)
  기존 trigram   Seq Scan  56ms   ← 한글에서 색인을 안 탑니다
  pg_bigm        Bitmap     3.4ms
```

**16배 차이입니다.** 없어도 검색은 됩니다 — 느릴 뿐입니다.

## 4-1. 만들기

```
1  검색창 "RDS" → RDS
2  "데이터베이스 생성"
```

### 화면을 따라 내려가며

| 구역 | 항목 | 값 |
|---|---|---|
| 생성 방식 | | **표준 생성** |
| 엔진 옵션 | 엔진 유형 | **PostgreSQL** |
| | 버전 | **16.x** 중 최신 |
| 템플릿 | | 프리 티어 (있으면) / 없으면 **개발/테스트** |
| 설정 | DB 인스턴스 식별자 | `sgb-db` |
| | 마스터 사용자 이름 | `sgbadmin` |
| | 자격 증명 관리 | **자체 관리** |
| | 마스터 암호 | ★ 직접 정하고 **적어 두십시오** |
| 인스턴스 구성 | | `db.t4g.micro` |
| 스토리지 | 유형 | 범용 SSD (gp3) |
| | 할당된 스토리지 | 20 GiB |
| | 스토리지 자동 조정 | 체크 · 최대 100 GiB |
| 연결 | 컴퓨팅 리소스 | EC2 컴퓨팅 리소스에 연결 안 함 |
| | VPC | **sgb-vpc** |
| | 퍼블릭 액세스 | **아니요** ★ |
| | VPC 보안 그룹 | 기존 항목 선택 → **sgb-db** |
| | (기본 보안 그룹은 빼십시오) | |

### 추가 구성 — ★ 펼쳐야 보입니다

```
맨 아래 "추가 구성" 을 클릭해 펼치십시오
```

| 항목 | 값 |
|---|---|
| **초기 데이터베이스 이름** | **`sgb`** ★ |
| **DB 파라미터 그룹** | **`sgb-pg16`** ★ 4-0 에서 만든 것 |
| 백업 보존 기간 | 7일 |
| 백업 창 | 기본 설정 |
| 암호화 활성화 | 체크 |
| 삭제 방지 활성화 | 체크 |

### ★ 초기 데이터베이스 이름을 꼭 적으십시오

```
안 적으면 DB 가 안 만들어집니다
```

인스턴스는 생기는데 그 안에 **데이터베이스가 없습니다.**
나중에 손으로 만들어야 하고, 그 방법을 찾느라 헤맵니다.

```
3  "데이터베이스 생성"
```

## 4-2. 기다립니다

**10~15분**입니다. 상태가 `생성 중` → `사용 가능` 이 됩니다.

## 4-2-1. ★ 재부팅 (2~3분)

```
상태가 「사용 가능」이 되면
RDS → sgb-db → 「작업」 → 「재부팅」
```

**방금 만들었어도 필요합니다.** 재부팅해야 `shared_preload_libraries` 가 적용됩니다.

### 확장은 손으로 안 넣으셔도 됩니다

7부 마이그레이션(`C970`)이 알아서 합니다.

```sql
IF EXISTS (pg_bigm 이 쓸 수 있으면) THEN
  CREATE EXTENSION pg_bigm;  + 색인 4개
ELSE
  색인 없이 넘어감 (검색은 동작)
END IF;
```

다만 **마스터 계정으로 마이그레이션을 돌리십시오.** 확장 생성에는 권한이 필요합니다.

### 확인 — 7부 뒤에

```sql
SELECT * FROM v_search_bigm_status;
-- extension 1 · indexes 4   ← 이러면 성공
```

`0 · 0` 이면 순서가 어긋난 것입니다. 확장을 깐 뒤 **같은 내용의 새 파일**(`C970b_…`)로 다시 적용하십시오. 이미 적용된 마이그레이션은 고치지 마십시오.

## 4-3. 엔드포인트를 적어 두십시오

```
RDS → 데이터베이스 → sgb-db → "연결 & 보안" 탭
```

```
sgb-db.abcdefg12345.ap-northeast-2.rds.amazonaws.com
```

**이것을 메모장에 붙여 두십시오.** 6부에서 씁니다.

---

# 5부 · EC2 — 서버

## 5-1. 만들기

```
1  검색창 "EC2" → EC2 → "인스턴스 시작"
```

| 구역 | 항목 | 값 |
|---|---|---|
| 이름 | | `sgb-web` |
| AMI | | **Ubuntu Server 24.04 LTS** (64비트 x86) |
| 인스턴스 유형 | | **t3.small** ★ |
| 키 페어 | | "새 키 페어 생성" |

### 키 페어 만들기

```
이름     sgb-key
유형     RSA
형식     .pem
```

```
"키 페어 생성" 을 누르면 파일이 자동으로 내려받아집니다
```

### ★ 이 파일을 잃으면 서버에 다시 못 들어갑니다

```
안전한 곳에 보관하십시오 — 다시 받을 수 없습니다
```

### 네트워크 설정 — "편집" 을 누르십시오

| 항목 | 값 |
|---|---|
| VPC | **sgb-vpc** |
| 서브넷 | **sgb-subnet-public1-ap-northeast-2a** |
| 퍼블릭 IP 자동 할당 | **활성화** ★ |
| 방화벽 | 기존 보안 그룹 선택 → **sgb-web** |

### 스토리지 구성

```
30 GiB · gp3
```

> 기본 8GiB로 두면 빌드 중에 꽉 찹니다.

```
2  오른쪽 "인스턴스 시작"
```

### ★ t2.micro 를 고르지 마십시오

```
메모리 1GB — npm run build 중에 멈춥니다
```

프리 티어라도 **t3.small 이상**을 쓰십시오. 빌드가 안 끝납니다.

## 5-2. 퍼블릭 IP 확인

```
EC2 → 인스턴스 → sgb-web → "퍼블릭 IPv4 주소"
```

메모해 두십시오.

## 5-3. 접속

### 맥 · 리눅스

```bash
cd ~/Downloads
chmod 400 sgb-key.pem
ssh -i sgb-key.pem ubuntu@퍼블릭IP
```

### 윈도 (PowerShell)

```powershell
cd ~\Downloads
icacls sgb-key.pem /inheritance:r
icacls sgb-key.pem /grant:r "$($env:USERNAME):(R)"
ssh -i sgb-key.pem ubuntu@퍼블릭IP
```

처음 접속하면 이렇게 묻습니다.

```
Are you sure you want to continue connecting (yes/no)?
```

`yes` 를 입력하십시오.

### 확인

```
ubuntu@ip-10-0-x-x:~$
```

이 줄이 보이면 들어온 것입니다.

---

# 6부 · 서버 준비

## 6-1. 프로그램 설치

접속한 터미널에 **그대로 붙여 넣으십시오.**

```bash
sudo apt update && sudo apt upgrade -y
```

> 중간에 파란 화면이 나오면 `Tab` → `Enter` 로 넘기십시오.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs postgresql-client nginx unzip
sudo npm install -g pm2
```

### 확인

```bash
node -v      # v20.x
npm -v       # 10.x
psql --version
nginx -v
pm2 -v
```

**다섯 줄이 다 나와야** 다음으로 갑니다.

## 6-2. ★ RDS에 붙는지 먼저 확인

```bash
psql "postgresql://sgbadmin:암호@엔드포인트:5432/sgb" -c "SELECT version();"
```

`암호` 와 `엔드포인트` 를 실제 값으로 바꾸십시오.

### 되면

```
PostgreSQL 16.x on aarch64-unknown-linux-gnu ...
```

### 안 되면 — 다음으로 가지 마십시오

| 메시지 | 원인 | 고치는 법 |
|---|---|---|
| `timeout expired` | 보안 그룹 | 3-2 — 소스가 `sgb-web` 인지 |
| `password authentication failed` | 암호 | 4-1에서 정한 암호 |
| `database "sgb" does not exist` | 초기 DB 이름 | 4-1의 추가 구성을 안 적었습니다 |
| `could not translate host name` | 엔드포인트 오타 | 4-3에서 복사 |

> **여기서 막히면 뒤의 모든 것이 안 됩니다.**
> 시간을 들여서라도 여기를 해결하십시오.

### `database "sgb" does not exist` 일 때

```bash
psql "postgresql://sgbadmin:암호@엔드포인트:5432/postgres" -c "CREATE DATABASE sgb;"
```

`postgres` 로 붙어서 만들면 됩니다.

---

# 7부 · 소개뱅크 올리기

## 7-1. 파일 올리기

**내 컴퓨터**에서 (새 터미널을 여십시오):

```bash
cd ~/Downloads
scp -i sgb-key.pem sgb-integrated-kit.zip ubuntu@퍼블릭IP:~/
```

**3MB**라 금방 끝납니다.

## 7-2. 압축 풀고 설치

서버 터미널에서:

```bash
cd ~
unzip -q sgb-integrated-kit.zip
cd sgb
ls
```

이런 것들이 보여야 합니다.

```
package.json  src/  scripts/  prisma/  spec/  docs/  site/  web/
```

```bash
npm install
```

**3~5분**입니다. 경고가 나와도 `added N packages` 가 보이면 됩니다.

## 7-3. 환경변수

```bash
nano ~/sgb/.env
```

아래를 붙여 넣고 값을 고치십시오.

```
DATABASE_URL=postgresql://sgbadmin:암호@엔드포인트:5432/sgb
JWT_SECRET=여기에_아래에서_만든_값
ENC_KEY=여기에_또_다른_값
NODE_ENV=production
PORT=3000
DB_POOL_MAX=10
JOB_TOKEN=여기에_또_다른_값
```

저장은 `Ctrl+O` → `Enter` → `Ctrl+X` 입니다.

### 비밀값 만들기

```bash
openssl rand -base64 48    # JWT_SECRET
openssl rand -base64 32    # ENC_KEY   ★ 잃어버리면 끝입니다
openssl rand -base64 32    # JOB_TOKEN
```

세 번 돌려서 나온 값을 각각 넣으십시오.

### ★★ ENC_KEY 는 다른 둘과 다릅니다

```
JWT_SECRET  잃어버려도 됩니다 — 바꾸면 전원 재로그인으로 끝
JOB_TOKEN   잃어버려도 됩니다 — 바꾸면 됩니다
ENC_KEY     ★ 잃어버리면 암호화된 자료를 영영 못 읽습니다
```

이 열쇠로 **정산 계좌번호와 리드 연락처**를 암호화합니다.
바꾸면 **이전에 저장된 것이 전부 안 열립니다.**

한 번 정하면 바꾸지 마십시오. 꼭 바꿔야 하면 옛 열쇠로 전부 풀어
새 열쇠로 다시 넣는 작업이 선행되어야 합니다.

**지금 종이에 적어 금고에 두십시오.** 아래 7-3-1 도 함께 하십시오.

## 7-3-1. ★ 암호화 열쇠 — Secrets Manager (15분)

`.env` 파일에 두면 서버에 들어온 사람이 바로 읽습니다.
**정산 계좌와 소비자 연락처를 여는 열쇠**이므로 따로 보관합니다.

### ① Secrets Manager 에 넣기

```
AWS 콘솔 → Secrets Manager → 「새 보안 암호 저장」
```

| 항목 | 값 |
|---|---|
| 유형 | **다른 유형의 보안 암호** |
| 키 | `ENC_KEY` |
| 값 | 위에서 만든 32자 |
| 이름 | `sgb/prod/enc-key` |
| 자동 교체 | **끄십시오** ★ |

**자동 교체를 켜면 안 됩니다.** 열쇠가 바뀌는 순간 이전 자료가 안 열립니다.

### ② EC2 에 읽을 권한 주기

```
IAM → 역할 → EC2 에 붙인 역할 → 권한 추가 → 인라인 정책
```

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "secretsmanager:GetSecretValue",
    "Resource": "arn:aws:secretsmanager:ap-northeast-2:*:secret:sgb/prod/*"
  }]
}
```

**이 한 줄짜리 권한만 주십시오.** `secretsmanager:*` 는 지우기도 됩니다.

### ③ 서버 켤 때 읽어 오기

```bash
nano ~/sgb/start.sh
```

```bash
#!/bin/bash
set -e
export ENC_KEY=$(aws secretsmanager get-secret-value \
  --secret-id sgb/prod/enc-key --region ap-northeast-2 \
  --query SecretString --output text | python3 -c 'import sys,json;print(json.load(sys.stdin)["ENC_KEY"])')

if [ -z "$ENC_KEY" ]; then
  echo "ENC_KEY 를 못 읽었습니다 — 멈춥니다"; exit 1
fi
exec npm start
```

```bash
chmod +x ~/sgb/start.sh
```

`pm2` 로 띄우실 때 `npm start` 대신 이 파일을 쓰십시오.

```bash
pm2 start ~/sgb/start.sh --name sgb
```

### ③-1. ★ 서버가 DB 에 열쇠를 전달합니다

`ENC_KEY` 를 읽어 오는 것만으로는 부족합니다. **DB 세션에 걸어야** 합니다.

```
Secrets Manager → ENC_KEY 환경변수 → DB 커넥션 → current_setting('app.enc_key')
                                      ↑
                                 여기가 끊겨 있었습니다
```

`src/db/database.service.ts` 가 커넥션마다 걸어 줍니다.

```ts
const encKey = process.env.ENC_KEY ?? '';
if (encKey) {
  this.pool.options.options = `-c app.enc_key=${encKey}`;
}
```

**사장님이 하실 일은 없습니다.** `ENC_KEY` 만 넣어 주시면 됩니다.
다만 이 고리가 끊기면 증상이 이상하게 나타나므로 적어 둡니다 —
서버는 멀쩡히 뜨는데 정산 계좌 등록만 실패합니다.

### ④ 확인

서버가 뜬 뒤 DB 에서 봅니다. **열쇠 값은 안 보여 줍니다.**

```sql
SELECT * FROM v_enc_key_status;
-- is_set = true · key_length = 32   ← 이러면 됩니다
```

`is_set = false` 면 열쇠가 안 걸린 것입니다. 그대로 두면
**파트너가 정산 계좌를 등록하지 못하고, 리드 연락처도 열리지 않습니다.**

### ⑤ 열쇠 이름이 하나로 모였습니다

예전에는 코드마다 이름이 달랐습니다.

| 옛 이름 | 쓰던 곳 |
|---|---|
| `app.enc_key` | 정산 계좌 |
| `app.pii_key` | 지급 계좌 |

**하나만 넣으면 다른 쪽이 조용히 실패**했습니다.
지금은 `fn_enc_key()` 하나를 거치고, 옛 이름 `app.pii_key` 도
뒤를 봐 줍니다. **새로 여시면 `ENC_KEY` 하나만 넣으시면 됩니다.**

### 왜 이렇게까지 하나

예전에는 `app.enc_key` 를 **넣는 곳이 아예 없었습니다.**
넣지 않으면 암호화 결과가 NULL 이 되고, 계좌 컬럼이 NOT NULL 이라
저장이 통째로 실패합니다. 오픈 뒤에 알면 늦습니다.

지금은 `fn_enc_key()` 가 **왜 안 되는지 말해 줍니다.**

```
ENC_KEY: 암호화 열쇠가 없습니다. 서버가 접속할 때 SET app.enc_key 를 해야 합니다
```

### 비용

```
보안 암호 1개  월 0.40 USD (약 600원)
조회          1만 건당 0.05 USD
```

**월 1,000원 이하**입니다.

### ★ 개발용 값을 그대로 두지 마십시오

```
JWT_SECRET=dev-only-secret-change-me-...
```

이것이 남아 있으면 **누구나 관리자 토큰을 만들 수 있습니다.**
`npm run check:secrets` 가 잡지만 한 번 더 확인하십시오.

## 7-4. DB 세우기

```bash
cd ~/sgb
set -a; source .env; set +a
npm run db:migrate
```

### 되면

```
적용 14 · 기존 0 · 변경감지 0
```

**14개가 적용되어야** 맞습니다.

### 확인

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
```

```
 count
-------
   410
```

400개 넘게 나오면 됩니다.

## 7-5. 배포 조건 점검

```bash
npm run deploy:check
```

```
배포 가능
```

### ★ `npm run verify` 를 여기서 돌리지 마십시오

```
DB 를 초기 상태로 되돌립니다
```

운영 서버에서 돌리면 **데이터가 지워집니다.** 로컬에서만
쓰십시오.

## 7-6. 빌드하고 띄우기

```bash
npm run build
```

**2~3분**입니다.

```bash
pm2 start dist/main.js --name sgb
pm2 save
pm2 startup
```

`pm2 startup` 이 명령어 한 줄을 뱉습니다. **그것을 복사해서
한 번 더 실행**하십시오. 서버가 재부팅돼도 자동으로 뜹니다.

### 확인

```bash
curl http://localhost:3000/api/v1/health
```

```json
{"ok":true}
```

### 안 뜨면

```bash
pm2 logs sgb --lines 30
```

| 메시지 | 원인 |
|---|---|
| `ECONNREFUSED ...:5432` | `.env` 를 `set -a` 로 안 읽었습니다 |
| `JWT_SECRET is required` | `.env` 에 빠졌습니다 |
| `Cannot find module` | `npm install` 을 안 했습니다 |

```bash
# 고친 뒤
pm2 restart sgb --update-env
```

---

# 8부 · 도메인 · HTTPS

## 8-1. Nginx 설정

```bash
sudo nano /etc/nginx/sites-available/sgb
```

```nginx
server {
  listen 80;
  server_name sogaebaenk.co.kr www.sogaebaenk.co.kr;

  # 업로드 파일이 큽니다 — 기본 1MB 면 사진이 안 올라갑니다
  client_max_body_size 20M;

  location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/sgb /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
```

```
syntax is ok
test is successful
```

```bash
sudo systemctl reload nginx
```

## 8-2. DNS

도메인 사신 곳(가비아 등)에서 DNS 관리로 들어가십시오.

| 타입 | 호스트 | 값 |
|---|---|---|
| A | `@` | 서버 퍼블릭 IP |
| A | `www` | 서버 퍼블릭 IP |

### 확인 — 반영될 때까지 기다립니다

```bash
dig +short sogaebaenk.co.kr
```

서버 IP가 나오면 됩니다. **30분~2시간** 걸립니다.

> 안 나오면 기다리십시오. 계속 새로고침해도 빨라지지 않습니다.

## 8-3. HTTPS

**DNS가 반영된 뒤에** 하십시오. 안 그러면 실패합니다.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d sogaebaenk.co.kr -d www.sogaebaenk.co.kr
```

### 물어보는 것들

```
이메일         받으실 주소 (만료 알림이 옵니다)
약관 동의      A
뉴스레터       N
리디렉션       2 ← HTTPS 로 자동 전환
```

### 확인

```
https://sogaebaenk.co.kr/api/v1/health
```

브라우저 주소창에 **자물쇠**가 보이면 됩니다.

### 자동 갱신

```bash
sudo certbot renew --dry-run
```

```
Congratulations, all simulated renewals succeeded
```

인증서는 90일마다 자동으로 갱신됩니다.

---

# 9부 · ★ 고정 IP — 오늘 반드시

## 9-1. 왜 지금인가

```
본인인증 · 계좌인증 · 결제 — 여섯 기관이 IP 등록을 요구합니다
IP 가 없으면 신청서를 못 냅니다
각 4~6주 걸립니다
```

**이것이 오픈일을 정합니다.**

## 9-2. 할당

```
1  EC2 → 왼쪽 메뉴 "탄력적 IP"
2  "탄력적 IP 주소 할당"
3  네트워크 경계 그룹: ap-northeast-2
4  "할당"
```

## 9-3. 연결

```
1  방금 만든 IP 를 체크
2  오른쪽 위 "작업" → "탄력적 IP 주소 연결"
3  리소스 유형: 인스턴스
4  인스턴스: sgb-web
5  "연결"
```

### ★ 서버 IP가 바뀝니다

```
연결하는 순간 기존 퍼블릭 IP 가 이 IP 로 바뀝니다
```

**SSH 접속 주소와 DNS 레코드를 새 IP로 고치십시오.**

```bash
# 새 IP 로 다시 접속
ssh -i sgb-key.pem ubuntu@새IP
```

DNS도 8-2의 A 레코드 두 개를 새 IP로 바꾸십시오.

## 9-4. 시스템에 넣기

```bash
cd ~/sgb && set -a; source .env; set +a

psql "$DATABASE_URL" <<'SQL'
UPDATE site_settings SET value = '할당받은IP' WHERE key = 'infra.egress_ip';
UPDATE integrations SET egress_ip = '할당받은IP', ip_requested_at = now()
 WHERE requires_ip;
SQL
```

### 확인

```bash
psql "$DATABASE_URL" -c "SELECT key, value FROM site_settings WHERE key='infra.egress_ip';"
```

## 9-5. 오늘 계약을 넣으십시오

```
본인인증 (PASS)     6주
1원 계좌인증        4주
```

### ★ 반드시 같은 날 신청하십시오

```
순서대로   6주 + 4주 = 10주
동시에     6주
```

**4주가 절약됩니다.**

### 신청서에 적을 것

```
사업자등록증
통신판매업 신고증
서비스 소개서
개인정보 처리방침 (https://sogaebaenk.co.kr/terms)
고정 IP          ← 9-2에서 받은 것
```

---

# 10부 · S3 · CloudFront — 사진

## 10-1. 버킷 둘

```
1  검색창 "S3" → S3 → "버킷 만들기"
```

| 항목 | 값 |
|---|---|
| 버킷 이름 | `sgb-uploads` |
| AWS 리전 | 아시아 태평양(서울) |
| 객체 소유권 | ACL 비활성화됨 |
| 퍼블릭 액세스 차단 | **모두 차단 (그대로)** ★ |
| 버킷 버전 관리 | 비활성화 |
| 기본 암호화 | SSE-S3 |

```
2  "버킷 만들기"
3  같은 방법으로 sgb-public 도 만듭니다 — 역시 모두 차단
```

### ★ 둘 다 차단이 맞습니다

```
CloudFront 를 통해서만 열어 줍니다
```

버킷을 직접 열면 누가 주소를 알아내 **원본을 통째로 받아갑니다.**

| 버킷 | 무엇 |
|---|---|
| `sgb-uploads` | 원본 — 분쟁 때 근거 |
| `sgb-public` | 변환본 — 이용자가 보는 것 |

## 10-2. CloudFront

```
1  검색창 "CloudFront" → "배포 생성"
```

| 항목 | 값 |
|---|---|
| 원본 도메인 | `sgb-public.s3.ap-northeast-2.amazonaws.com` |
| 원본 액세스 | **Origin access control settings** |
| | → "제어 설정 생성" → 그대로 두고 "생성" |
| 뷰어 프로토콜 정책 | **Redirect HTTP to HTTPS** |
| 허용된 HTTP 방법 | GET, HEAD |
| 캐시 정책 | **CachingOptimized** |
| 가격 분류 | 북미·유럽·아시아 사용 |

```
2  "배포 생성"
```

### ★ 화면 위에 파란 띠가 뜹니다

```
S3 버킷 정책을 업데이트해야 합니다 — "정책 복사"
```

**반드시 복사하십시오.** 그리고:

```
S3 → sgb-public → 권한 탭 → 버킷 정책 "편집" → 붙여 넣기 → 저장
```

이걸 안 하면 **사진이 안 보입니다.**

## 10-3. 기다립니다

**10~15분**입니다. 상태가 `배포 중` → `활성화됨`.

배포 도메인을 적어 두십시오.

```
d1234abcd.cloudfront.net
```

## 10-4. IAM 역할 — 서버에 권한

```
1  검색창 "IAM" → 역할 → "역할 만들기"
2  신뢰할 수 있는 엔터티: AWS 서비스
3  사용 사례: EC2 → "다음"
4  권한 정책: AmazonS3FullAccess 체크 → "다음"
5  역할 이름: sgb-ec2-s3 → "역할 생성"
```

### 서버에 붙이기

```
EC2 → 인스턴스 → sgb-web 체크
→ 작업 → 보안 → "IAM 역할 수정"
→ sgb-ec2-s3 선택 → "IAM 역할 업데이트"
```

### ★ 액세스 키를 서버에 두지 마십시오

```
키는 새면 끝입니다
역할은 그 서버에서만 통합니다
```

### 확인

```bash
sudo apt install -y awscli
aws s3 ls s3://sgb-uploads
```

아무것도 안 나오면 정상입니다 (빈 버킷). **오류가 나면**
IAM 역할이 안 붙은 것입니다.

## 10-5. 환경변수 추가

```bash
nano ~/sgb/.env
```

```
AWS_REGION=ap-northeast-2
S3_UPLOAD_BUCKET=sgb-uploads
S3_PUBLIC_BUCKET=sgb-public
CDN_BASE_URL=https://d1234abcd.cloudfront.net
```

```bash
pm2 restart sgb --update-env
```

## 10-6. 도메인 붙이기 (선택)

### ★ 인증서는 버지니아 북부에서

```
1  오른쪽 위 리전을 "미국 동부 (버지니아 북부)" 로 바꿉니다
2  검색창 "Certificate Manager" → "인증서 요청"
3  퍼블릭 인증서 → 도메인: cdn.sogaebaenk.co.kr
4  검증 방법: DNS 검증
5  "요청"
6  만들어진 인증서를 열어 CNAME 값을 복사 → DNS 에 등록
```

**CloudFront 용 인증서만 버지니아 북부입니다.** 서울에서 만들면
목록에 안 보입니다 — 여기서 막히는 분이 많습니다.

```
7  리전을 다시 서울로
8  CloudFront → 배포 → 설정 "편집"
   대체 도메인(CNAME): cdn.sogaebaenk.co.kr
   사용자 정의 SSL 인증서: 방금 만든 것
9  저장
10 DNS 에 CNAME 추가: cdn → d1234abcd.cloudfront.net
```

---

# 11부 · 메일 — SPF · DKIM · DMARC

## 11-1. SES 등록

```
1  검색창 "SES" → Amazon Simple Email Service
2  왼쪽 "확인된 자격 증명" → "자격 증명 생성"
3  자격 증명 유형: 도메인
4  도메인: sogaebaenk.co.kr
5  "DKIM 할당" 펼치기
   ID 유형: Easy DKIM
   서명 키 길이: RSA_2048_BIT
   DKIM 서명: 활성화 체크
6  "자격 증명 생성"
```

## 11-2. DNS에 다섯 줄

### ① DKIM — SES가 준 CNAME 3개

화면에 이렇게 나옵니다.

```
이름                                          값
abc123._domainkey.sogaebaenk.co.kr    abc123.dkim.amazonses.com
def456._domainkey.sogaebaenk.co.kr    def456.dkim.amazonses.com
ghi789._domainkey.sogaebaenk.co.kr    ghi789.dkim.amazonses.com
```

**그대로 DNS에 CNAME 으로 넣으십시오.**

### ② SPF

| 타입 | 호스트 | 값 |
|---|---|---|
| TXT | `@` | `v=spf1 include:amazonses.com ~all` |

### ③ DMARC

| 타입 | 호스트 | 값 |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@sogaebaenk.co.kr` |

### ★ `p=none` 으로 시작하십시오

```
p=reject 로 두면 설정이 조금만 어긋나도
정상 메일까지 반송됩니다
```

**한 달쯤 돌려 보고** 문제가 없으면 `quarantine` → `reject` 로
올리십시오.

## 11-3. 검증 기다리기

```
SES → 확인된 자격 증명 → sogaebaenk.co.kr
```

`확인 보류 중` → `확인됨` 이 됩니다. **최대 72시간**입니다.

## 11-4. 샌드박스 해제

```
SES → 계정 대시보드 → "프로덕션 액세스 요청"
```

### 적을 것

```
메일 유형    트랜잭션

웹사이트     https://sogaebaenk.co.kr

사용 사례
회원 가입 확인, 검수 결과 통보, 주문·배송 안내 등
서비스 이용에 따른 알림을 보냅니다. 광고성 메일은
수신 동의를 받은 회원에게만 보내며, 모든 메일에
수신거부 링크를 포함합니다.

반송 처리
SNS 로 반송·불만 알림을 받아 자동으로 발송 대상에서
제외합니다. 반송률이 5% 를 넘으면 발송을 중단하고
원인을 확인합니다.
```

**24시간** 안에 승인됩니다.

## 11-5. 시스템에 넣기

```bash
cd ~/sgb && set -a; source .env; set +a

psql "$DATABASE_URL" <<'SQL'
UPDATE site_settings SET value = 'no-reply@sogaebaenk.co.kr'
 WHERE key = 'notify.mail_from';
SQL
```

> **채널은 아직 켜지 마십시오.** 검증이 끝난 뒤에 켜야
> 발송 시도가 쌓이지 않습니다.

---

# 12부 · LLM 검색 파서 — 켜기 (선택)

## 12-0. 안 켜도 됩니다

```
search.llm_parser.enabled = off   ← 지금 상태
```

**꺼져 있어도 검색이 됩니다.** 규칙 엔진이 지역·규모·가격·상태를
읽습니다.

```
"10평 이내 상가 급매 있어?"   → sizeMax:10 · urgent → 부동산·점포
"카페 창업 3천만원 이내"       → priceMax:3천만 → 프랜차이즈·창업
"부산 물류창고 납품처"         → sido:부산 → 물류·운송
"겨울 온열기 중 가성비"        → ★ 후보 없음
```

**마지막 줄이 LLM 이 필요한 지점**입니다. "가성비" 같은 **주관적
조건**은 어휘집으로 못 풉니다.

### 언제 켜시면 됩니까

```
오픈 직후      켜지 마십시오 — 볼 것이 많습니다
한 달쯤 뒤     검색 기록을 보고 "후보 없음" 이 잦으면 켜십시오
```

**서두를 이유가 없습니다.** 돈이 들고, 안 켜도 검색은 됩니다.

---

## 12-1. 무엇을 준비하나

| | |
|---|---|
| API 키 | Anthropic 또는 OpenAI |
| 모델 | 저비용 등급 (Haiku급) |
| 비용 | 월 1만 건 약 3,900원 · 10만 건 약 39,000원 |

### ★ 외부 계약이 아닙니다

```
본인인증 · 계좌인증   계약 + IP 등록 + 4~6주
LLM 파서            키 발급 즉시 · 고정 IP 불필요
```

카드만 등록하면 **그 자리에서 키가 나옵니다.**

---

## 12-2. ★ 먼저 알아 두실 것 — 법무 조건

법무 회신은 이렇습니다.

> **개인정보를 전송하지 않으면 문제없음**

이것은 *"지금 이대로 해도 된다"* 가 아니라 **"비식별을 계속
지키는 한 문제없다"** 는 조건부 확인입니다.

### 지켜야 하는 두 가지

| 코드 | 내용 |
|---|---|
| **INV-SCH1** | 파서 호출에 계정 ID · 세션 · IP · 성향을 넣지 않습니다 |
| **INV-SCH2** | 원문 검색어를 저장하지 않습니다 |

### 이미 막아 두었습니다

```
llm_parse_log 에 raw_query 컬럼이 없습니다
parsed_params 에 raw · query · prompt 등 7종 키도 막습니다
```

컬럼만 없애면 **"디버깅용으로" 파라미터에 넣습니다.** 그래서 키
이름까지 막았습니다.

### ★ 개인화로 넓히시려면 법무 질의를 다시 하십시오

```
"이 회원은 부동산을 자주 보니 부동산 위주로 보여 주자"
```

이런 것은 **계정 정보를 보내는 것**이라 회신 범위 밖입니다.
검정이 막지만, 막히기 전에 알고 계셔야 합니다.

---

## 12-3. 키 넣기

```bash
nano ~/sgb/.env
```

```
LLM_API_KEY=sk-ant-여기에_받은_키
```

```bash
# 저장 뒤
pm2 restart sgb --update-env
```

### ★ 키를 코드에 넣지 마십시오

```
git 에 올라가면 그 순간 새어 나갑니다
```

`npm run check:secrets` 가 잡지만, 잡히기 전에 올라갑니다.

---

## 12-4. 모델 지정

```bash
cd ~/sgb && set -a; source .env; set +a

psql "$DATABASE_URL" <<'SQL'
UPDATE site_settings SET value = 'claude-haiku-4-5'
 WHERE key = 'search.llm_parser.model';
SQL
```

> 모델 이름이 틀리면 호출이 실패하고 **자동으로 규칙 엔진으로
> 돌아갑니다.** 이용자는 차이를 못 느낍니다.

---

## 12-5. 켜기

```bash
psql "$DATABASE_URL" <<'SQL'
UPDATE site_settings SET value = 'on'
 WHERE key = 'search.llm_parser.enabled';
SQL
```

**재시작이 필요 없습니다.** 다음 검색부터 적용됩니다.

---

## 12-6. 확인 — 반드시 해 보십시오

### ① 검색이 되는가

```bash
curl -s -X POST http://localhost:3000/api/v1/search/prompt \
  -H 'Content-Type: application/json' \
  -d '{"q":"겨울 온열기 중 가성비 좋은 거"}'
```

파서가 붙으면 **후보가 나와야** 합니다. 전에는 안 나왔습니다.

### ② 원문이 저장되지 않는가

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM v_search_raw_stored;"
```

```
 count
-------
     0
```

**0이 아니면 즉시 끄십시오.** 법무 회신의 전제가 깨진 것입니다.

```bash
psql "$DATABASE_URL" -c \
  "UPDATE site_settings SET value='off' WHERE key='search.llm_parser.enabled';"
```

### ③ 파서가 제 몫을 하는가

```bash
psql "$DATABASE_URL" -c "SELECT * FROM v_search_parser_health;"
```

```
 calls | fallbacks | fallback_pct | avg_ms
-------+-----------+--------------+--------
  1284 |        12 |            1 |    340
```

| 값 | 뜻 |
|---|---|
| `fallback_pct` 30% 넘음 | **돈만 쓰고 정확도는 규칙 엔진과 같습니다** |
| `avg_ms` 1000 넘음 | 검색이 느려집니다 — 이용자가 떠납니다 |

### ④ 운영 화면에서

```
https://sogaebaenk.co.kr/#/admin/search
```

24시간 호출 · 폴백 비율 · 평균 응답이 한 화면에 보입니다.

---

## 12-7. ★ 되돌리기

문제가 생기면 **한 줄이면 됩니다.**

```bash
psql "$DATABASE_URL" -c \
  "UPDATE site_settings SET value='off' WHERE key='search.llm_parser.enabled';"
```

```
재시작 불필요 · 즉시 규칙 엔진으로 복귀 · 이용자 체감 없음
```

### 언제 되돌리나

```
원문이 저장되고 있을 때        즉시 (법무 조건 위반)
폴백이 30% 를 넘을 때          돈만 나갑니다
평균 응답이 1초를 넘을 때       검색이 느려집니다
비용이 예상을 크게 넘을 때
```

---

## 12-8. 비용 보기

```
Anthropic Console → Usage
```

### 예상

| 월 호출 | 월 비용 (1,400원/$ 기준) |
|---|---|
| 1만 건 | 약 3,900원 |
| 10만 건 | 약 39,000원 |
| 100만 건 | 약 392,000원 |

> **파서 1회 호출로 끝나는 설계**를 유지해야 이 금액이 나옵니다.
> 대화형으로 여러 번 부르면 배로 늡니다.

### 한도를 걸어 두십시오

```
Anthropic Console → Limits → 월 한도 설정
```

**한도가 없으면 잘못 짠 코드가 하룻밤에 수십만원을 씁니다.**

---

# 13부 · 백업 — 첫날 하십시오

## 13-1. 스냅샷

```
RDS → 데이터베이스 → sgb-db 체크
→ 작업 → "스냅샷 생성"
→ 스냅샷 이름: sgb-초기구축-20260922
→ "스냅샷 생성"
```

**뭔가 크게 잘못되면 여기로 돌아옵니다.**

## 13-2. 자동 백업 확인

```
RDS → sgb-db → "유지 관리 및 백업" 탭
→ 자동 백업: 활성화 · 보존 기간 7일
```

4-1에서 설정했지만 한 번 더 보십시오.

## 13-3. 되돌리는 법 (알아만 두십시오)

```
RDS → 스냅샷 → 해당 스냅샷 → 작업 → "스냅샷 복원"
```

**새 인스턴스로 복원됩니다.** 기존 것을 덮어쓰지 않습니다.
복원 후 `.env` 의 엔드포인트를 바꾸면 됩니다.

---

# 14부 · 마무리 점검

## 14-1. 명령으로

```bash
cd ~/sgb && set -a; source .env; set +a

npm run smoke          # 라우트 342건
npm run deploy:check   # 배포 가능
npm run open:check     # 오픈 차단 확인
```

### 나와야 하는 값 (2026-09-28 기준)

```
라우트    342건
불변식    통과 155 / 실패 0
공격      안전 577 · 뚫림 0
배포      배포 가능
```

이보다 **적게 나오면 배포본이 옛 것**입니다. 킷을 다시 받으십시오.
`npm run attack` 은 시드를 지우므로, 돌리신 뒤에는 시드를 다시 넣어야
로그인이 됩니다 (로컬테스트 절차서 4부).

### ★ 암호화 열쇠도 함께 보십시오

```bash
psql "$DATABASE_URL" -c "SELECT * FROM v_enc_key_status;"
```

```
 is_set | key_length
--------+------------
 t      |         32
```

`f` 가 나오면 7-3-1 이 안 된 것입니다. **파트너가 정산 계좌를
등록하지 못하고, 리드 연락처도 저장되지 않습니다.**

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM v_enc_key_missing;"
```

**0이어야 합니다.** 0이 아니면 열쇠 없이 저장된 것이 있다는 뜻입니다.

## 14-2. 브라우저로

| 주소 | 기대 |
|---|---|
| `https://sogaebaenk.co.kr/api/v1/health` | `{"ok":true}` |
| `https://sogaebaenk.co.kr` | 메인 화면 |
| `https://sogaebaenk.co.kr/docs` | API 문서 |

**주소창에 자물쇠**가 있어야 합니다.

## 14-3. 남은 것 확인

### 리드관(소개리드)은 아직 꺼져 있습니다

```
LED is_active = false
```

준비는 4/6 끝났습니다 — 제한업종 · 업종 8종 · 폼 문구 · 개인정보 격리.
**남은 둘이 여기 AWS 뒤에 옵니다.**

| 남은 것 | 왜 |
|---|---|
| 알림톡 연동 | **9부 고정 IP 뒤** 신청 가능 |
| 검수 인력 재산정 | 4관 대응 |

알림톡 없이 열면 리드 등급이 기본값이라 **3,000원이라는 가격 근거가
서지 않습니다.** 서두르지 마십시오.

```bash
psql "$DATABASE_URL" -c \
  "SELECT key, coalesce(nullif(value,''),'(비어있음)') FROM site_settings
    WHERE coalesce(btrim(value),'')='' AND key !~ 'assume';"
```

**`infra.egress_ip` 가 채워져 있어야** 합니다.

---

# 15부 · 오늘 하실 순서

```
오전  1~4부   리전 · VPC · 보안 그룹 · RDS      40분 + 대기 15분
      5~7부   EC2 · 서버 준비 · 배포            60분
      ★ 7-3-1 암호화 열쇠 (Secrets Manager)   15분

오후  8부     도메인 · HTTPS                    30분 + DNS 대기
      ★ 9부   고정 IP                           5분
      ★ 계약   본인인증 · 계좌인증 동시 신청

저녁  10부    S3 · CloudFront                   30분
      11부    SES 등록 · DNS                    20분
      13부    백업                              5분
```

> **12부(LLM 파서)는 오늘 안 하셔도 됩니다.** 꺼져 있어도
> 검색이 되고, 한 달쯤 써 보고 "후보 없음" 이 잦으면 그때
> 켜시면 됩니다.

## ★ 9부가 끝나면 바로 계약을 넣으십시오

```
본인인증 6주 · 계좌인증 4주
같은 날 넣으면 6주, 따로 하면 10주
```

**그날 하루가 4주를 좌우합니다.**

---

# 16부 · 막혔을 때

## 16-1. 증상별

| 증상 | 원인 | 고치는 법 |
|---|---|---|
| 만든 게 목록에 없음 | 리전 | 오른쪽 위가 "서울" 인지 |
| SSH 접속 안 됨 | 내 IP 바뀜 | 보안 그룹에서 "내 IP" 다시 |
| `Permission denied (publickey)` | 키 권한 | `chmod 400 sgb-key.pem` |
| RDS 접속 timeout | 보안 그룹 | 3-2 — 소스가 `sgb-web` 인지 |
| `database "sgb" does not exist` | 초기 DB 이름 | 6-2 아래 방법으로 생성 |
| 빌드 중 멈춤 | 메모리 | t3.small 이상으로 |
| pm2 로 띄웠는데 죽음 | 환경변수 | `.env` 를 `set -a` 로 읽었는지 |
| 도메인이 안 뜸 | DNS 전파 | 2시간 기다리십시오 |
| certbot 실패 | DNS 미반영 | `dig` 로 먼저 확인 |
| ACM 인증서가 안 보임 | 리전 | CloudFront 용은 **버지니아 북부** |
| `aws s3 ls` 권한 오류 | IAM 역할 | 10-4 — EC2에 붙었는지 |
| 사진이 안 보임 | 버킷 정책 | 10-2 — 파란 띠의 정책을 붙였는지 |
| 메일이 스팸함 | SPF/DKIM | 11-3 — "확인됨" 인지 |
| 메일이 아예 안 감 | 샌드박스 | 11-4 — 프로덕션 액세스 |
| **403 이 뜬다** | **대개 토큰이 빈 것** | 로그인부터 확인 |

## 16-2. 로그 보는 법

```bash
pm2 logs sgb --lines 50        # 앱
sudo tail -50 /var/log/nginx/error.log   # 웹서버
```

## 16-3. 되돌리기

```bash
# 앱만 다시
pm2 restart sgb --update-env

# 완전히 다시 배포
cd ~ && rm -rf sgb
unzip -q sgb-integrated-kit.zip && cd sgb
npm install
set -a; source .env; set +a
npm run db:migrate && npm run build
pm2 restart sgb --update-env
```

DB를 되돌리시려면 **13-3의 스냅샷 복원**을 쓰십시오.

---

## 부록 · 지금 킷 상태 (2026-09-22 실측)

```
DB       표 173 · 뷰 241 · 함수 513 · 트리거 174 · 마이그레이션 15
코드     라우트 330 · 타입 오류 0
검정     불변식136 · 공격528 · 오류코드66 · 배치3
         비밀값5 · 시험안전19
화면     163 (시안 163 · 어긋남 0)
오픈     차단 3건 — 전부 외부 계약
LLM      search.llm_parser.enabled = off (12부 — 선택)
```

---

*작성 2026-09-22 · v2.1 — 12부(LLM 검색 파서) 추가.
로컬에서 먼저 돌려 보시고 AWS 로 가십시오.*
