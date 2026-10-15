# 소개뱅크 AWS CodeCommit 설정 및 적용 절차서 v1.0

Sep 30, 2026 · @박세호

## 0. 최종 결론 · 판단 근거 · 전제

**결론: CodeCommit 은 지금 계정에서 바로 쓸 수 있습니다. 다만 첫 작업은 리포지토리가 아니라 IAM 관리자 사용자 만들기입니다.** 현재 루트 계정으로만 작업 중이고, 루트로는 CodeCommit Git 자격 증명(아이디·암호)을 만들 수 없기 때문입니다.

### 0-1. 판단 근거

| # | 근거 | 출처 |
| --- | --- | --- |
| 1 | 2024-07-25 신규 가입 중단 → 2025-11-24 정식 서비스 복귀, 신규 계정도 콘솔·CLI·API 로 리포지토리 생성 가능 | [AWS DevOps 블로그](https://aws.amazon.com/blogs/devops/tag/aws-codecommit/feed/) · [AWS 문서 이력](https://docs.aws.amazon.com/codecommit/latest/userguide/history.html) |
| 2 | Git 자격 증명과 SSH 키는 루트에 쓸 수 없고, 루트는 관리자 IAM 사용자 생성에만 쓰라고 권고 | [CodeCommit 인증·접근 제어](https://docs.aws.amazon.com/codecommit/latest/userguide/auth-and-access-control.html) |
| 3 | 저장소 결정(09-25): 리포지토리 4개 sgb-core · sgb-adx · sgb-infra · sgb-docs, 그룹 3종, 태그 보호, 주간 백업 | 소개뱅크 CI/CD 적용 절차서 v1.1 §18 |
| 4 | 09-30 진행 현황: 서울 리전, sgb-vpc · sgb-db · sgb-web(EC2) 완료, IAM 작업용 사용자 없음, 스테이징 EC2 없음 | 소개뱅크 AWS 구축 진행 현황 (09-30) |

### 0-2. 이 문서의 범위

이 문서는 CI/CD 절차서 v1.1 의 STEP 1\~3 과 §18(저장소 관리)을 **09-30 실제 상태에 맞춰 따로 떼어 낸 실행본**입니다. 자동 빌드·배포(CodeBuild · CodeDeploy · CodePipeline)는 스테이징 EC2 가 생긴 뒤 v1.1 STEP 4 부터 이어 갑니다.

### 0-3. 전제 조건

1. 리전은 서울 `ap-northeast-2` 로 고정합니다.
2. 루트 MFA 등록 완료(09-30).
3. 대표 PC 는 Windows 기준입니다. Git for Windows 최신판이 필요합니다.
4. kit 소스 전체를 한곳(로컬 폴더 또는 zip)에 모아 두었습니다.
5. 개발자 명단(이름 · 메일)이 있으면 STEP 4 에서 바로 계정을 만듭니다. 없으면 대표 계정만 먼저 진행합니다.

> 확인 필요 — 09-27 로 잡았던 첫 배포 `v1.0.0` 은 진행 현황상 아직 앱 설치(6부) 전입니다. 첫 배포 날짜가 바뀌었다면 알려 주십시오. 이 문서는 배포 일정과 무관하게 먼저 진행해도 됩니다.

## 1. 예상 비용과 필요한 자원

**예상 비용은 월 0\~3달러 수준입니다.** 단, "활성 사용자"에는 사람뿐 아니라 IAM 역할도 들어가므로 5명 안에 드는지 먼저 세어야 합니다.

| 항목 | 요금 (공개 요금표 기준) | 소개뱅크 예상 |
| --- | --- | --- |
| 활성 사용자 | 무료 범위 5명, 초과 1명당 월 $1 | 아래 계산 참조 |
| 저장 용량 | 무료 50 GB, 초과 GB당 월 $0.06 | 소스만 올리면 1 GB 미만 |
| Git 요청 | 무료 월 1만 회, 초과 1회당 $0.001 | 월 수천 회 이하 |
| 리포지토리 개수 | 요금 없음 | 4개 |

출처: [AWS 뉴스 블로그 — CodeCommit 출시 요금](https://aws.amazon.com/blogs/aws/now-available-aws-codecommit/). 활성 사용자는 그 달에 CodeCommit 에 접근한 고유 신원(IAM 사용자·역할, 연동 사용자, 루트)이며, 접근하지 않은 신원은 과금되지 않습니다 ([비용 정리](https://us.fitgap.com/products/aws-codecommit)).

### 1-1. 활성 사용자 계산 (예상)

| 신원 | 종류 | 접근 시점 |
| --- | --- | --- |
| seho-admin (대표) | IAM 사용자 | 지금부터 |
| 개발자 1\~2명 | IAM 사용자 | STEP 4 |
| sgb-ec2-role (sgb-web) | IAM 역할 | STEP 8 |
| sgb-auto-role (자동화 서버) | IAM 역할 | STEP 9 백업 |
| sgb-codebuild-role · sgb-codepipeline-role | IAM 역할 | 파이프라인 도입 후 |

개발자 2명 + 파이프라인까지 가면 **7개 → 초과 2개 × $1 = 월 약 $2** 입니다.

> 추가 확인 필요 — 2025-07 이후 가입 계정은 AWS 프리 티어가 "크레딧·무료 플랜" 방식으로 바뀌었습니다. CodeCommit 상시 무료(5명·50 GB) 범위가 이 계정에도 적용되는지 [CodeCommit 요금 페이지](https://aws.amazon.com/codecommit/pricing/)와 결제 콘솔에서 확인하십시오. 적용되지 않아도 활성 사용자당 월 $1 이므로 금액 영향은 작습니다.

### 1-2. 필요한 자원

1. 사람: 대표 1명, 약 3\~4시간 (STEP 1\~7). STEP 8\~9 는 추가 1\~2시간.
2. 도구: Git for Windows, AWS CLI v2 (STEP 8·9 에서 사용).
3. 기존 자원: sgb-web EC2, sgb-ec2-role, 백업용 S3 버킷(없으면 STEP 9 에서 생성).
4. GitHub 백업을 할 경우: GitHub 계정과 비공개(Private) 리포지토리 4개, 쓰기 권한 토큰 1개.

## 2. STEP 1 · IAM 관리자 사용자 만들기 (루트로 마지막 작업, 30분)

**루트로 하는 일은 이 STEP 이 마지막입니다.** 이후 모든 작업은 `seho-admin` 으로 로그인해서 합니다.

### 2-1. 관리자 그룹 만들기

`콘솔 › IAM › 사용자 그룹 › 그룹 생성`

| 입력란 | 값 |
| --- | --- |
| 그룹 이름 | `sgb-admins` |
| 권한 정책 | `AdministratorAccess` (AWS 관리형 정책 — AWS 가 만들어 둔 권한 묶음) |

> v1.1 §18-2 는 `sgb-admins` 에 `AWSCodeCommitFullAccess` 만 적었습니다. 대표가 IAM · EC2 · RDS 도 다뤄야 하므로 `AdministratorAccess` 로 바꿉니다. 이 정책 안에 CodeCommit 전체 권한이 이미 들어 있습니다.

### 2-2. 관리자 사용자 만들기

`콘솔 › IAM › 사용자 › 사용자 생성`

1. 사용자 이름 `seho-admin` 입력.
2. "AWS Management Console 에 대한 사용자 액세스 권한 제공" 체크 → "IAM 사용자를 생성하고 싶음" 선택.
3. 사용자 지정 암호 입력, "다음 로그인 시 새 암호 생성" 은 체크 해제(본인이 쓰므로).
4. 권한 설정: "그룹에 사용자 추가" → `sgb-admins` 선택 → 생성.
5. 완료 화면의 **콘솔 로그인 URL** 을 적어 둡니다. 형식: `https://<계정ID>.signin.aws.amazon.com/console`

### 2-3. MFA 등록 (필수)

`IAM › 사용자 › seho-admin › 보안 자격 증명 › MFA 디바이스 할당`

1. 디바이스 이름 `seho-admin-phone`, 유형 "인증 관리자 앱".
2. 휴대폰 인증 앱(Google Authenticator 등)으로 QR 스캔 → 연속 코드 2개 입력.

### 2-4. 계정 별칭 (선택, 권장)

`IAM › 대시보드 › AWS 계정 › 계정 별칭 생성` → `sogaebaenk`. 로그인 주소가 `https://sogaebaenk.signin.aws.amazon.com/console` 로 짧아집니다. 이미 다른 계정이 쓰는 이름이면 `sogaebaenk-prod` 처럼 바꿉니다.

### 2-5. 확인

1. 루트에서 로그아웃 → 2-2 의 URL 로 `seho-admin` 로그인 → MFA 코드 입력.
2. 오른쪽 위 계정 표시가 `seho-admin @ <계정ID>` 이면 성공.
3. 루트 자격 증명(메일·암호·MFA)은 금고 보관. 이후 결제·계정 해지 같은 루트 전용 작업에만 씁니다.

`[실패 시]` 로그인 화면에 "루트 사용자" 로만 입력되면 → 화면의 "IAM 사용자" 를 선택하고 계정 ID(12자리)를 넣습니다.

## 3. STEP 2 · 리포지토리 4개 만들기 (seho-admin, 15분)

**09-25 확정안대로 4개를 만듭니다.** 오른쪽 위 리전이 "아시아 태평양(서울)" 인지 먼저 확인합니다.

`콘솔 › CodeCommit › 리포지토리 › 리포지토리 생성` 을 4번 반복합니다.

| 리포지토리 이름 | 설명란에 적을 내용 | 태그 |
| --- | --- | --- |
| `sgb-core` | NestJS API · Next.js 웹 · Vite 어드민 | `Project=sogaebaenk` |
| `sgb-adx` | 광고 플랫폼 | `Project=sogaebaenk` |
| `sgb-infra` | 배포 스크립트 · Nginx · 서버 설정 (비밀값 제외) | `Project=sogaebaenk` |
| `sgb-docs` | 기획 · 설계 · 절차서 문서 | `Project=sogaebaenk` |

생성 화면의 "Amazon CodeGuru Reviewer 활성화" 는 **체크하지 않습니다** (유료, 지금 필요 없음).

### 3-1. 복제 URL 기록

각 리포지토리의 "URL 복제 › HTTPS 복제" 를 눌러 아래 형식 주소를 적어 둡니다.

```
https://git-codecommit.ap-northeast-2.amazonaws.com/v1/repos/sgb-core
https://git-codecommit.ap-northeast-2.amazonaws.com/v1/repos/sgb-adx
https://git-codecommit.ap-northeast-2.amazonaws.com/v1/repos/sgb-infra
https://git-codecommit.ap-northeast-2.amazonaws.com/v1/repos/sgb-docs
```

### 3-2. 콘솔 대신 CLI 로 만들 때 (선택)

AWS CloudShell(콘솔 위쪽 `>_` 아이콘 — 브라우저 안의 명령창)에서 한 번에 만들 수 있습니다.

```bash
for R in sgb-core sgb-adx sgb-infra sgb-docs; do
  aws codecommit create-repository \
    --repository-name "$R" \
    --region ap-northeast-2 \
    --tags Project=sogaebaenk
done
aws codecommit list-repositories --region ap-northeast-2
```

`[확인]` 목록에 4개가 보이면 완료.

### 3-3. 리포지토리에 넣지 않을 것

1. `.env` · `/etc/sogaebaenk/*.env` 같은 비밀값 파일 (DB 암호, API 키).
2. `sgb-key.pem` 같은 SSH 키.
3. `node_modules/`, 빌드 결과물(`dist/`, `.next/`).
4. 개인정보가 들어간 DB 덤프·엑셀.

한 번 올라간 비밀값은 커밋을 지워도 이력에 남습니다. 올렸다면 **그 키·암호를 즉시 바꾸는 것**이 유일한 해결책입니다.

## 4. STEP 3 · 권한 그룹 3종과 main·태그 보호 (seho-admin, 30분)

**권한은 사람에게 직접 붙이지 않고 그룹에만 붙입니다.** 사람이 바뀌면 그룹에서 빼고 넣는 것으로 끝나야 합니다.

| 그룹 | 누구 | AWS 관리형 정책 | 추가 정책 |
| --- | --- | --- | --- |
| `sgb-admins` | 대표 `seho-admin` | `AdministratorAccess` (STEP 1 에서 생성) | 없음 |
| `sgb-developers` | 내부·외주 개발자 | `AWSCodeCommitPowerUser` (읽기·쓰기·PR, 리포지토리 삭제 불가) | `sgb-protect-main-tags` (아래) |
| `sgb-readonly` | 외부 검수 · 법무 · 인수인계 대상 | `AWSCodeCommitReadOnly` (복제·열람만) | 없음 |

### 4-1. 그룹 만들기

`IAM › 사용자 그룹 › 그룹 생성` 을 두 번 합니다: `sgb-developers`, `sgb-readonly`. 정책은 위 표대로 검색해서 체크합니다.

### 4-2. main 직접 push 금지 + 릴리스 태그 보호 정책

`IAM › 정책 › 정책 생성 › JSON` 에 아래를 붙여 넣고, `<계정ID>` 를 12자리 숫자로 바꿉니다. 이름은 `sgb-protect-main-tags`. 만든 뒤 `sgb-developers` 그룹의 "권한 추가 › 정책 연결" 로 붙입니다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyDirectChangesToMain",
      "Effect": "Deny",
      "Action": [
        "codecommit:GitPush",
        "codecommit:DeleteBranch",
        "codecommit:PutFile",
        "codecommit:MergeBranchesByFastForward",
        "codecommit:MergeBranchesBySquash",
        "codecommit:MergeBranchesByThreeWay"
      ],
      "Resource": "arn:aws:codecommit:ap-northeast-2:<계정ID>:sgb-*",
      "Condition": {
        "StringEqualsIfExists": { "codecommit:References": ["refs/heads/main"] },
        "Null": { "codecommit:References": "false" }
      }
    },
    {
      "Sid": "DenyReleaseTagPush",
      "Effect": "Deny",
      "Action": ["codecommit:GitPush"],
      "Resource": "arn:aws:codecommit:ap-northeast-2:<계정ID>:sgb-*",
      "Condition": {
        "StringLikeIfExists": { "codecommit:References": ["refs/tags/v*"] },
        "Null": { "codecommit:References": "false" }
      }
    }
  ]
}
```

무엇을 막는지 쉽게 풀면 이렇습니다.

1. 첫 번째 문: 개발자는 `main` 브랜치에 직접 올리기·삭제·콘솔 편집·직접 병합을 못 합니다. PR 을 통한 병합(`MergePullRequest…`)은 막지 않으므로 PR 로만 들어갑니다.
2. 두 번째 문: 개발자는 `v1.0.0` 같은 릴리스 태그를 만들거나 지우거나 덮어쓰지 못합니다. 태그는 대표만 만듭니다.
3. 리소스가 `sgb-*` 이므로 4개 리포지토리에 모두 적용됩니다.

> v1.1 보정 — v1.1 §4-2·§18-4 는 리소스를 `sgb-core` 하나로 적었습니다. 리포지토리를 4개로 나눈 결정(§18-1)과 맞추려면 `sgb-*` 가 맞습니다.

### 4-3. 특정 리포지토리만 허용할 때 (외주 대비)

외주 개발사가 `sgb-adx` 만 봐야 하면 `sgb-developers-adx` 그룹을 따로 만듭니다. `AWSCodeCommitPowerUser` 대신 리소스를 `arn:aws:codecommit:ap-northeast-2:<계정ID>:sgb-adx` 로 한정한 고객 관리형 정책을 붙이고, 4-2 정책도 함께 붙입니다.

`[확인]` `IAM › 사용자 그룹` 에 3개 그룹이 보이고, `sgb-developers` 의 권한 탭에 정책 2개가 붙어 있으면 완료.

## 5. STEP 4 · Git 자격 증명 발급과 PC 연결 (1인당 15분)

**대표 PC 부터 연결합니다.** 첫 코드 올리기(STEP 5)는 main 보호 정책이 없는 `seho-admin` 으로만 할 수 있기 때문입니다.

### 5-1. HTTPS Git 자격 증명 발급

Git 자격 증명은 콘솔 로그인 암호와 다른, Git 전용 아이디·암호입니다. 사용자 1명당 최대 2세트까지 만들 수 있습니다 ([AWS 문서](https://docs.aws.amazon.com/toolkit-for-visual-studio/latest/user-guide/using-aws-codecommit-with-team-explorer.html)).

1. `IAM › 사용자 › seho-admin › 보안 자격 증명` 탭.
2. 아래로 내려 "AWS CodeCommit 에 대한 HTTPS Git 자격 증명" › **자격 증명 생성**.
3. **자격 증명 다운로드** 로 CSV 저장. 이 창을 닫으면 암호를 다시 볼 수 없습니다.
4. CSV 는 암호 관리자에 옮기고 파일은 지웁니다.

### 5-2. 개발자 계정 (명단이 있을 때)

1. `IAM › 사용자 › 사용자 생성` — 이름 `dev-<이름>`, 콘솔 액세스 **제공 안 함**(Git 만 씀), 그룹 `sgb-developers`.
2. 5-1 과 같은 방법으로 Git 자격 증명 발급.
3. 전달은 암호 관리자 공유나 대면 전달로 합니다. 카카오톡·메일 평문 전달은 하지 않습니다.

외부 검수 인원은 같은 방법으로 만들되 그룹만 `sgb-readonly` 로 넣습니다.

### 5-3. PC 설정 (Windows PowerShell, 1회)

```powershell
git --version                                   # 2.4x 이상이면 됨
git config --global user.name  "박세호"
git config --global user.email "<회사 메일>"
git config --global core.autocrlf input         # 줄바꿈을 LF 로 통일
git config --global init.defaultBranch main
git config --global credential.helper manager   # Windows 자격 증명 관리자에 저장

mkdir C:\sgb; cd C:\sgb
git clone https://git-codecommit.ap-northeast-2.amazonaws.com/v1/repos/sgb-core
git clone https://git-codecommit.ap-northeast-2.amazonaws.com/v1/repos/sgb-adx
git clone https://git-codecommit.ap-northeast-2.amazonaws.com/v1/repos/sgb-infra
git clone https://git-codecommit.ap-northeast-2.amazonaws.com/v1/repos/sgb-docs
```

처음 복제할 때 로그인 창이 뜨면 5-1 의 **Git 자격 증명** 아이디·암호를 넣습니다. 콘솔 암호가 아닙니다.

`[확인]` 빈 저장소 경고(`You appear to have cloned an empty repository`)는 정상입니다. `git remote -v` 에 `git-codecommit` 주소가 보이면 완료.

`[실패 시]` `403` 이 나오면 콘솔 암호를 넣은 경우가 대부분입니다. `제어판 › 자격 증명 관리자 › Windows 자격 증명` 에서 `git:https://git-codecommit…` 항목을 지우고 다시 복제합니다.

## 6. STEP 5 · 첫 코드 올리기 · 브랜치 · 태그 규칙 (대표, 1시간)

**첫 커밋은 대표가 `main` 에 직접 올리고, 그 뒤로는 모두 PR 로만 들어갑니다.**

### 6-1. 저장소 공통 파일 두 개

각 리포지토리 폴더 맨 위에 두 파일을 먼저 만듭니다.

`.gitignore`

```
.env
.env.*
!.env.example
*.pem
*.key
node_modules/
dist/
.next/
build/
*.log
```

`.gitattributes`

```
* text=auto eol=lf
*.png binary
*.jpg binary
*.pdf binary
```

### 6-2. 비밀값 섞임 검사 후 첫 커밋

```powershell
cd C:\sgb\sgb-core
Copy-Item -Recurse <kit 압축 푼 폴더>\* .
git add -A
git status --porcelain | Select-String -Pattern "\.env|\.pem|id_rsa|credentials|secret"
# 위 결과가 아무것도 안 나와야 다음 줄 진행
git commit -m "chore: sgb-core 최초 커밋"
git push -u origin main
```

`sgb-adx` · `sgb-infra` · `sgb-docs` 도 같은 순서로 올립니다. 문서 리포지토리(`sgb-docs`)는 이 프로젝트의 `.md` 문서와 프로토타입 HTML 을 넣습니다.

`[확인]` `콘솔 › CodeCommit › sgb-core › 코드` 에 파일 목록이 보이면 완료.

### 6-3. 브랜치 규칙

| 브랜치 | 용도 | 누가 만드나 | 병합 대상 |
| --- | --- | --- | --- |
| `main` | 항상 배포 가능한 상태 | 없음 (고정) | — |
| `feat/<짧은이름>` | 새 기능 | 개발자 | `main` (PR) |
| `fix/<짧은이름>` | 버그 수정 | 개발자 | `main` (PR) |
| `hotfix/<버전>` | 운영 긴급 수정 | 대표 지시 | `main` (PR, 승인 후 즉시 태그) |

작업 흐름: `git switch -c feat/login-otp` → 작업 · 커밋 → `git push -u origin feat/login-otp` → 콘솔에서 PR 생성 → 승인 → 스쿼시(Squash, 자잘한 커밋을 하나로 합침) 병합 → 소스 브랜치 삭제.

### 6-4. 태그(버전) 규칙

1. 형식은 SemVer `v주.부.수` 입니다. 예: `v1.0.0` → 버그 수정 `v1.0.1` → 기능 추가 `v1.1.0`.
2. 태그는 **실제로 운영에 나간 커밋**에만, 대표만 붙입니다.
3. 한 번 붙인 태그는 지우거나 옮기지 않습니다. 잘못 붙였으면 다음 번호로 새로 붙입니다.

```powershell
# 첫 배포가 끝난 뒤, 배포한 커밋에서
git switch main; git pull
git tag -a v1.0.0 -m "첫 운영 배포"
git push origin v1.0.0
```

> v1.1 과의 차이 — v1.1 은 09-27 배포 커밋에 `v1.0.0` 을 붙이도록 했습니다. 진행 현황상 첫 배포 전이므로, **태그는 첫 배포를 마친 그 커밋에** 붙입니다. 코드를 올리는 일은 배포 전에 먼저 해도 됩니다.

## 7. STEP 6 · PR 승인 규칙 (seho-admin, 20분)

**main 으로 가는 PR 은 대표 1명의 승인이 있어야 병합되도록 합니다.** 승인 규칙 템플릿(여러 리포지토리에 같은 규칙을 한 번에 거는 틀)을 하나 만들어 4개에 연결합니다.

### 7-1. 콘솔로 만들기

`콘솔 › CodeCommit › 승인 규칙 템플릿 › 템플릿 생성`

| 입력란 | 값 |
| --- | --- |
| 템플릿 이름 | `main-requires-1-approval` |
| 필요한 승인 수 | `1` |
| 승인 풀 멤버 | IAM 사용자 ARN `arn:aws:iam::<계정ID>:user/seho-admin` |
| 대상 브랜치 | `main` |
| 연결 리포지토리 | `sgb-core` · `sgb-adx` · `sgb-infra` · `sgb-docs` |

### 7-2. CLI 로 만들기 (CloudShell, 선택)

```bash
ACCT=<계정ID>
aws codecommit create-approval-rule-template \
  --region ap-northeast-2 \
  --approval-rule-template-name main-requires-1-approval \
  --approval-rule-template-content "{\"Version\":\"2018-11-08\",\"DestinationReferences\":[\"refs/heads/main\"],\"Statements\":[{\"Type\":\"Approvers\",\"NumberOfApprovalsNeeded\":1,\"ApprovalPoolMembers\":[\"arn:aws:iam::${ACCT}:user/seho-admin\"]}]}"

aws codecommit batch-associate-approval-rule-template-with-repositories \
  --region ap-northeast-2 \
  --approval-rule-template-name main-requires-1-approval \
  --repository-names sgb-core sgb-adx sgb-infra sgb-docs
```

규칙 내용의 형식은 [AWS CLI 문서 예시](https://docs.aws.amazon.com/en_us/cli/latest/reference/codecommit/create-approval-rule-template.html)와 같습니다.

### 7-3. 알아 둘 점

1. 템플릿은 **연결 이후에 새로 만든 PR** 에만 규칙이 붙습니다. 이미 열린 PR 에는 붙지 않습니다.
2. 승인 규칙은 PR 병합만 막습니다. 직접 push 는 STEP 3 의 IAM 정책이 막습니다. 둘 다 있어야 합니다.
3. 관리자 권한이 있는 `seho-admin` 은 승인 규칙을 무시하고 병합(Override)할 수 있습니다. 긴급 수정 때만 쓰고, 쓰면 PR 댓글에 이유를 남깁니다.
4. 승인 풀에 IAM **그룹** ARN 을 넣은 v1.1 §4-5 방식은 동작하지 않을 가능성이 있습니다. 개발자가 늘면 **사용자 ARN 을 한 명씩** 추가하십시오. (그룹 인식 여부는 추가 확인 필요)
5. 개발자가 한 명도 없는 동안에는 대표가 PR 작성자이자 승인자가 됩니다. 작성자 본인 승인 허용 여부는 첫 PR 에서 확인하고, 막히면 그 기간에는 템플릿 연결을 잠시 풀어 둡니다.

`[확인]` 테스트 브랜치로 PR 을 만들고, PR 화면 "승인" 탭에 `main-requires-1-approval` 규칙이 "승인 필요" 로 보이면 완료.

## 8. STEP 7 · 알림 설정 (seho-admin, 20분)

**PR 생성·병합과 브랜치·태그 변경을 대표 메일로 받습니다.** 자동화 서버가 생기면 받는 곳만 n8n 으로 바꿔 카카오 알림톡으로 돌립니다.

### 8-1. 알림 규칙 만들기 (리포지토리마다)

`콘솔 › CodeCommit › sgb-core › 설정 › 알림 › 알림 규칙 생성`

| 입력란 | 값 |
| --- | --- |
| 이름 | `sgb-core-notify` |
| 세부 정보 유형 | 전체 |
| 이벤트 | 풀 리퀘스트: 생성됨 · 상태 변경됨 · 병합됨 / 브랜치 및 태그: 생성됨 · 삭제됨 / 댓글: 풀 리퀘스트 |
| 대상 | "대상 생성" → SNS 주제 → 이름 `sgb-alerts` |

`sgb-alerts` 주제가 아직 없으면 **이 화면의 "대상 생성" 으로 만드는 것을 권합니다.** 이렇게 만들면 알림 서비스가 주제에 게시할 수 있는 권한이 함께 설정됩니다. 이미 있는 주제를 고르면 그 주제의 액세스 정책에 알림 서비스 허용이 있는지 확인해야 합니다.

나머지 3개 리포지토리도 같은 방법으로 `sgb-adx-notify` · `sgb-infra-notify` · `sgb-docs-notify` 를 만들고 대상은 같은 `sgb-alerts` 를 고릅니다.

### 8-2. 메일 구독

`콘솔 › SNS › 주제 › sgb-alerts › 구독 생성` → 프로토콜 "이메일", 엔드포인트 대표 메일 → 받은 메일의 **Confirm subscription** 클릭.

`[확인]` 테스트 브랜치를 하나 만들어 push 했을 때 몇 분 안에 "브랜치 생성" 메일이 오면 완료. 확인 후 테스트 브랜치는 지웁니다.

### 8-3. 감사 기록 (추가 작업 없음)

누가 언제 push · 병합 · 삭제했는지는 CloudTrail 이벤트 기록에 90일간 자동으로 남습니다. `콘솔 › CloudTrail › 이벤트 기록` 에서 이벤트 소스 `codecommit.amazonaws.com` 으로 걸러 봅니다. 90일보다 오래 보관하려면 v1.1 §18-7 대로 추적(`sgb-audit`)을 만들어 S3 에 쌓습니다.

## 9. STEP 8 · EC2 sgb-web 에서 코드 받기 (seho-admin, 40분)

**서버에는 아이디·암호를 두지 않고, EC2 에 붙은 역할(sgb-ec2-role)의 임시 권한으로 코드를 받습니다.** 이 방식은 git-remote-codecommit(AWS 가 만든 Git 확장 도구)을 씁니다 ([AWS 문서](https://docs.aws.amazon.com/he_il/codecommit/latest/userguide/setting-up-git-remote-codecommit.md)). 파이프라인이 생기기 전, 수동 `deploy.sh` 단계에서 쓰는 방법입니다.

### 9-1. 역할에 읽기 권한 추가

`IAM › 역할 › sgb-ec2-role › 권한 추가 › 인라인 정책 생성 › JSON` → 이름 `sgb-codecommit-pull`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["codecommit:GitPull", "codecommit:GetRepository"],
      "Resource": [
        "arn:aws:codecommit:ap-northeast-2:<계정ID>:sgb-core",
        "arn:aws:codecommit:ap-northeast-2:<계정ID>:sgb-infra"
      ]
    }
  ]
}
```

운영 서버는 **읽기만** 합니다. `GitPush` 를 주지 않으므로 서버가 뚫려도 저장소는 바뀌지 않습니다.

### 9-2. 서버에 도구 설치 (SSH 접속 후)

```bash
# AWS CLI v2 — Ubuntu 24.04 는 apt 의 awscli 가 없을 수 있어 공식 설치본 사용
sudo apt update && sudo apt install -y unzip git pipx
curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp && sudo /tmp/aws/install
aws --version

# git-remote-codecommit — 시스템 파이썬을 건드리지 않도록 pipx 로 설치
pipx install git-remote-codecommit
pipx ensurepath && source ~/.bashrc
```

### 9-3. 역할 권한 확인과 복제

```bash
aws sts get-caller-identity          # Arn 에 assumed-role/sgb-ec2-role 이 보여야 함
sudo mkdir -p /opt/sgb && sudo chown ubuntu:ubuntu /opt/sgb
cd /opt/sgb
git clone codecommit::ap-northeast-2://sgb-core
git clone codecommit::ap-northeast-2://sgb-infra

# 배포할 때는 태그로 받습니다
cd /opt/sgb/sgb-core && git fetch --tags && git checkout v1.0.0
```

`[확인]` `git log --oneline -1` 에 태그 커밋이 보이면 완료.

`[실패 시]` `get-caller-identity` 가 실패하면 EC2 에 역할이 붙지 않은 것입니다 → `EC2 › 인스턴스 › sgb-web › 작업 › 보안 › IAM 역할 수정` 에서 `sgb-ec2-role` 선택. 복제만 실패하면 9-1 정책의 계정 ID·리포지토리 이름 오타를 먼저 봅니다.

## 10. STEP 9 · 백업 — S3 번들 + GitHub 미러 (자동화 서버, 1시간)

**원본은 CodeCommit 하나이고, 백업은 두 곳에 둡니다.** S3 번들은 계정 안의 되돌릴 수 있는 사본, GitHub 비공개 미러는 AWS 계정 자체에 문제가 생겼을 때의 계정 밖 사본입니다.

### 10-1. 역할 권한

자동화 서버 역할 `sgb-auto-role` 에는 09-25 확정대로 **CodeCommit 읽기 + S3 `repos/` 쓰기** 예외만 둡니다(자동화 서버 셋업 절차 v1.1). GitHub 토큰은 Parameter Store(AWS 의 설정값 보관함)에 암호화해 두고, 그 한 항목 읽기 권한만 추가합니다.

```json
{
  "Effect": "Allow",
  "Action": ["ssm:GetParameter"],
  "Resource": "arn:aws:ssm:ap-northeast-2:<계정ID>:parameter/sgb/github/mirror-token"
}
```

### 10-2. GitHub 준비

1. GitHub 에 비공개(Private) 리포지토리 4개를 **빈 상태로** 만듭니다: `sgb-core` · `sgb-adx` · `sgb-infra` · `sgb-docs`.
2. 세분화 토큰(Fine-grained token)을 만들고 범위를 이 4개로 한정, 권한은 Contents 읽기·쓰기만 줍니다. 만료는 1년 이하로 둡니다.
3. `콘솔 › Systems Manager › Parameter Store › 파라미터 생성` → 이름 `/sgb/github/mirror-token`, 유형 `SecureString`, 값에 토큰.

### 10-3. 백업 스크립트 `/usr/local/bin/backup-repos.sh`

```bash
#!/usr/bin/env bash
# 소개뱅크 리포지토리 주간 백업: CodeCommit → S3 번들 + GitHub 미러
set -euo pipefail
REGION=ap-northeast-2
BUCKET="s3://sgb-prod-backups-<접미>/repos"
GH_OWNER="<GitHub 계정 또는 조직>"
REPOS="sgb-core sgb-adx sgb-infra sgb-docs"
TOPIC="arn:aws:sns:${REGION}:<계정ID>:sgb-alerts"
DATE=$(date -u +%Y%m%d)
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
export GIT_TERMINAL_PROMPT=0
GH_TOKEN=$(aws ssm get-parameter --region "$REGION" --name /sgb/github/mirror-token \
           --with-decryption --query Parameter.Value --output text)
FAIL=0
for R in $REPOS; do
  if git clone --quiet --mirror "codecommit::${REGION}://${R}" "$WORK/$R.git"; then
    ( cd "$WORK/$R.git" && git bundle create "$WORK/$R-$DATE.bundle" --all )
    aws s3 cp "$WORK/$R-$DATE.bundle" "$BUCKET/$R/$R-$DATE.bundle" --region "$REGION" --only-show-errors \
      || FAIL=1
    ( cd "$WORK/$R.git" && git push --quiet --mirror \
        "https://x-access-token:${GH_TOKEN}@github.com/${GH_OWNER}/${R}.git" ) \
      || { echo "[backup] $R github FAIL"; FAIL=1; }
    echo "[backup] $R done"
  else
    echo "[backup] $R clone FAIL"; FAIL=1
  fi
done
if [ "$FAIL" = 1 ]; then
  aws sns publish --region "$REGION" --topic-arn "$TOPIC" \
    --subject "[소개뱅크] 리포지토리 백업 실패" --message "backup-repos.sh 실패 $(hostname) $DATE"
  exit 1
fi
```

### 10-4. 설치와 일정 등록

```bash
sudo apt install -y pipx git && sudo pipx install --global git-remote-codecommit
sudo chmod 700 /usr/local/bin/backup-repos.sh
# 매주 일요일 03:00 KST (= 토요일 18:00 UTC)
echo '0 18 * * 6 root /usr/local/bin/backup-repos.sh >> /var/log/backup-repos.log 2>&1' \
  | sudo tee /etc/cron.d/sgb-backup-repos
sudo /usr/local/bin/backup-repos.sh        # 지금 한 번 실행
```

> v1.1 보정 — v1.1 §18-5 의 cron `0 18 * * 0` 은 UTC 일요일 18:00, 즉 **한국 월요일 03:00** 입니다. 일요일 03:00 KST 를 원하면 요일 칸을 `6` 으로 둡니다. 서버 시간대가 UTC 라는 전제이며, `timedatectl` 로 확인하십시오.

> `sudo pipx install --global` 은 pipx 1.5 이상에서 동작합니다. 안 되면 `sudo pip3 install --break-system-packages git-remote-codecommit` 로 대신합니다.

### 10-5. 자동화 서버가 아직 없을 때 (임시)

대표 PC 에서 주 1회 수동으로 미러합니다. PC 에는 GitHub 로그인이 Git 자격 증명 관리자에 저장되어 있다고 가정합니다.

```powershell
$repos = "sgb-core","sgb-adx","sgb-infra","sgb-docs"
foreach ($r in $repos) {
  git clone --mirror "https://git-codecommit.ap-northeast-2.amazonaws.com/v1/repos/$r" "$env:TEMP\$r.git"
  git -C "$env:TEMP\$r.git" push --mirror "https://github.com/<GitHub 계정>/$r.git"
  Remove-Item -Recurse -Force "$env:TEMP\$r.git"
}
```

`[확인]` S3 `repos/sgb-core/` 에 날짜별 `.bundle` 파일, GitHub 리포지토리에 같은 브랜치·태그가 보이면 완료. 분기 1회 `git clone sgb-core-<날짜>.bundle restored` 로 복원 연습을 합니다.

## 11. 방식 비교표

**사람 PC 는 HTTPS Git 자격 증명, 서버는 git-remote-codecommit 으로 나누는 것을 권합니다.**

### 11-1. CodeCommit 연결 방식

| 방식 | 인증 수단 | 맞는 곳 | 장점 | 단점 |
| --- | --- | --- | --- | --- |
| **HTTPS Git 자격 증명 (권장: PC)** | IAM 사용자별 Git 아이디·암호 | 대표·개발자 Windows PC | 설치 없음, Git 기본 기능만으로 동작 | 고정 암호라 유출 시 직접 폐기해야 함 |
| **git-remote-codecommit (권장: 서버)** | IAM 역할·임시 자격 증명 | EC2, 자동화 서버, CloudShell | 서버에 암호 저장 없음 | 파이썬 도구 설치 필요 |
| SSH 키 | IAM 사용자에 공개키 등록 | SSH 에 익숙한 개발자 | 암호 입력 없음 | 키 관리·Windows 설정이 번거로움 |

루트 계정은 Git 자격 증명과 SSH 키를 쓸 수 없고, git-remote-codecommit 이나 CLI 자격 증명 도우미로만 Git 을 쓸 수 있습니다. AWS 는 루트로 CodeCommit 을 쓰지 말라고 권합니다 ([AWS 문서](https://docs.aws.amazon.com/codecommit/latest/userguide/auth-and-access-control.html)).

### 11-2. GitHub 백업 방식

| 방식 | PR 병합 내용 반영 | 사람 손 | 권장 |
| --- | --- | --- | --- |
| 자동화 서버 cron 미러 (STEP 9) | 반영됨 (서버 쪽 전체 복사) | 없음 | **1순위** |
| 대표 PC 수동 미러 (10-5) | 반영됨 | 주 1회 | 자동화 서버 전 임시 |
| PC 에 푸시 주소 2개 등록 (이중 push) | **빠짐** — 콘솔에서 병합한 커밋은 PC 를 거치지 않음 | 매번 | 권하지 않음 |

> 주의 — 미러(`--mirror`)는 CodeCommit 에서 지운 브랜치를 GitHub 에서도 지웁니다. 실수로 지운 것을 되살리는 용도는 S3 날짜별 번들이 맡습니다.

## 12. 발생할 수 있는 문제와 해결

**대부분의 실패는 "잘못된 암호 종류" 와 "정책의 계정 ID·리전 오타" 두 가지입니다.**

| # | 증상 | 원인 | 해결 |
| --- | --- | --- | --- |
| 1 | 루트로 로그인했는데 "HTTPS Git 자격 증명" 메뉴가 없음 | 루트에는 Git 자격 증명을 만들 수 없음 | STEP 1 로 `seho-admin` 을 만들고 그 사용자에서 발급 |
| 2 | `git clone` 이 `403` | Git 자격 증명 대신 콘솔 암호 입력, 또는 예전 암호가 저장됨 | Windows 자격 증명 관리자에서 `git:https://git-codecommit…` 삭제 후 재입력 |
| 3 | 개발자가 main 에 push 하면 `403` | STEP 3 정책이 정상 동작 중 | 작업 브랜치로 push → PR |
| 4 | 대표가 첫 push 도 `403` | `seho-admin` 이 `sgb-developers` 에도 들어가 있음 | 대표는 `sgb-admins` 에만 둠 |
| 5 | PR 병합 버튼이 비활성 | 승인 규칙 미충족 | 승인 풀 사용자가 승인. 긴급 시 관리자 Override + 댓글로 사유 |
| 6 | 알림 메일이 안 옴 | SNS 구독 미확인, 또는 주제 정책에 알림 서비스 허용 없음 | 구독 확인 메일 클릭 / 알림 규칙 화면에서 주제를 새로 만들어 연결 |
| 7 | EC2 에서 `codecommit::` 복제 실패 | 역할 미부착, 정책 리소스 오타, 도구 경로 미등록 | `aws sts get-caller-identity` → 정책 ARN 확인 → `pipx ensurepath` |
| 8 | 비밀값(.env)을 올려 버림 | `.gitignore` 누락 | **그 키·암호를 즉시 교체**가 먼저. 이력 삭제는 그다음 |
| 9 | 활성 사용자 요금이 예상보다 많음 | IAM 역할도 활성 사용자로 계산 | 1-1 표로 신원 수 점검, 안 쓰는 역할의 CodeCommit 권한 회수 |
| 10 | GitHub 미러가 `403` | 토큰 만료 또는 리포지토리 범위 밖 | 토큰 재발급 후 Parameter Store 값 교체 |
| 11 | 백업이 월요일 새벽에 돔 | cron 요일을 UTC 로 계산하지 않음 | 10-4 의 `0 18 * * 6` 사용 |

## 13. 현장 체크리스트

**아래를 모두 체크하면 CodeCommit 적용이 끝납니다.**

### 13-1. 설정 완료 확인

- [ ] `seho-admin` 로그인 · MFA 동작, 루트는 금고 보관
- [ ] 리전 서울에 리포지토리 4개 (`sgb-core` · `sgb-adx` · `sgb-infra` · `sgb-docs`)
- [ ] 그룹 3개, `sgb-developers` 에 `sgb-protect-main-tags` 연결
- [ ] 대표 PC 에서 4개 모두 복제 성공
- [ ] 4개 모두 `.gitignore` · `.gitattributes` 포함 첫 커밋, 비밀값 없음
- [ ] 승인 규칙 템플릿이 4개 리포지토리에 연결
- [ ] 알림 규칙 4개 → `sgb-alerts` → 대표 메일 수신 확인
- [ ] `sgb-ec2-role` 에 읽기 전용 정책, sgb-web 에서 `codecommit::` 복제 성공
- [ ] 백업 1회 실행: S3 번들 + GitHub 미러 확인

### 13-2. 보안 확인

- [ ] Git 자격 증명 CSV 파일 삭제, 암호 관리자에만 보관
- [ ] 개발자 계정은 콘솔 액세스 없음
- [ ] 운영 서버 역할에 `GitPush` 없음
- [ ] GitHub 리포지토리 4개 모두 Private, 토큰은 4개 한정·1년 이하

### 13-3. 운영 점검 (주기)

| 주기 | 볼 것 |
| --- | --- |
| 매주 | 7일 넘은 열린 PR · 병합 끝난 브랜치 정리 · `/var/log/backup-repos.log` 성공 여부 |
| 매월 | 활성 사용자 수와 청구액 · 안 쓰는 IAM 사용자 비활성화 |
| 분기 | 번들 복원 연습 · CloudTrail 에서 `DeleteBranch` · `DeleteRepository` 0건 확인 · GitHub 토큰 만료일 |

## 14. 다음에 바로 할 일 · 근거 자료

**오늘은 STEP 1\~4 (약 1시간 30분)까지 끝내는 것을 목표로 합니다.**

1. 루트로 `sgb-admins` 그룹과 `seho-admin` 사용자 생성 → MFA 등록 → 루트 로그아웃.
2. `seho-admin` 으로 리포지토리 4개와 그룹 3개, `sgb-protect-main-tags` 정책 생성.
3. `seho-admin` Git 자격 증명 발급 → 대표 PC 에서 4개 복제.
4. 내일: STEP 5\~7 (코드 올리기 · 승인 규칙 · 알림). STEP 8 은 sgb-web 6부 설치 때, STEP 9 는 자동화 서버 구축 때 진행.
5. 스테이징 EC2 가 생기면 CI/CD 절차서 v1.1 STEP 4 부터 이어서 자동 배포를 붙입니다.

### 확인이 필요한 항목

| # | 항목 | 확인 방법 |
| --- | --- | --- |
| 1 | 2025-07 이후 가입 계정에 CodeCommit 상시 무료(5명·50 GB) 적용 여부 | 요금 페이지 · 결제 콘솔 |
| 2 | 승인 풀에 IAM 그룹 ARN 인식 여부, PR 작성자 본인 승인 가능 여부 | 첫 테스트 PR |
| 3 | 첫 운영 배포 날짜 (태그 `v1.0.0` 시점) | 대표 결정 |
| 4 | 자동화 서버 구축 일정 (STEP 9 시점) | 자동화 서버 셋업 절차 v1.1 |

### 근거 자료 (2026-09-30 확인)

1. [AWS DevOps 블로그 — CodeCommit 정식 서비스 복귀](https://aws.amazon.com/blogs/devops/tag/aws-codecommit/feed/)
2. [AWS CodeCommit 사용자 가이드 문서 이력](https://docs.aws.amazon.com/codecommit/latest/userguide/history.html)
3. [AWS CodeCommit 인증과 접근 제어](https://docs.aws.amazon.com/codecommit/latest/userguide/auth-and-access-control.html)
4. [git-remote-codecommit 설정 절차](https://docs.aws.amazon.com/he_il/codecommit/latest/userguide/setting-up-git-remote-codecommit.md)
5. [Git 자격 증명 — 루트 불가·1인 2세트 제한](https://docs.aws.amazon.com/toolkit-for-visual-studio/latest/user-guide/using-aws-codecommit-with-team-explorer.html)
6. [AWS CLI create-approval-rule-template](https://docs.aws.amazon.com/en_us/cli/latest/reference/codecommit/create-approval-rule-template.html)
7. [AWS 뉴스 블로그 — CodeCommit 요금 구조](https://aws.amazon.com/blogs/aws/now-available-aws-codecommit/)
8. [InfoQ — CodeCommit 정식 복귀와 Git LFS 2026 초 예고](https://infoq.com/news/2025/12/aws-codecommit-ga)
9. 내부 문서: 소개뱅크 CI/CD 적용 절차서 v1.1 · 자동화 서버 셋업 절차 v1.1 · AWS 구축 진행 현황(09-30)
