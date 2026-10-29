# 223. GitHub 백업 절차서 — CodeCommit 저장소 4개를 GitHub 비공개 저장소로 (2026-10-28)

> 대표 「CodeCommit 내용을 GitHub 에 백업하는 절차」 · 「백업을 GitHub 에 저장하려고 한다. 절차서 만들어줘」. 결정 기록 deploy-cicd #8(「GitHub 연동으로 작업 백업 — 미정」)을 채우는 안.
> **원본은 계속 CodeCommit.** GitHub 은 **읽기 전용 사본(백업)** — GitHub 에서 고치거나 풀 리퀘스트를 받지 않는다. 운영 배포 · 점검 흐름(docs/222 · CLAUDE.md)은 바뀌지 않는다.
> 저장소 백업만 다룬다. 서버 · DB · 개발 작업 · Claude 작업 백업은 docs/222.
> **2026-10-29 실제 설정은 0절 — 저장소 4개가 아니라 GitHub 비공개 저장소 하나(`seho0614/soge`)에 담음(대표 선택).** 0절과 2 ~ 6절이 다르면 0절을 따른다.

## 0. 실제 설정 (2026-10-29 · 한 저장소 방식)

| 항목 | 값 |
|---|---|
| GitHub 저장소 | `seho0614/soge` · 비공개(바깥에서 404) · 처음 만들 때 생긴 `main` 은 그대로 둠 |
| 담는 방식 | 갈래 이름 앞에 저장소 이름: `sgb-core/main` · `sgb-core/feature/…` · `sgb-infra/…` · `sgb-adx/main` · `sgb-docs/…` (태그도 `sgb-core/…` 처럼) |
| 열쇠 | 배포 키 1개 — 서버 `~/.ssh/gh_soge` · 별칭 `gh-soge` · 쓰기 허용 · GitHub 이름 `sgbdev-backup` |
| 보내는 사본 | `~/mirror/<저장소>.git` (CodeCommit `--mirror` · 작업 폴더와 따로) |
| 보내는 스크립트 | `~/mirror/push-github.sh` — 받아오기 → `refs/heads/*:refs/heads/<저장소>/*` 보내기 · 강제 · 지우기 없음 · 결과 한 줄 `~/mirror/last.txt` (4절 자동화 때 `sgb-infra/tools/` 로 옮김) |
| GitHub 설정 | Actions 끔 · 배포 키 쓰기 허용 (대표 확인 10/29) · 기본 갈래 `sgb-core/main` (대표 할 일) |

**평소 보내기 (손으로 · 자동화 전)**

```bash
~/mirror/push-github.sh          # 기대: 「<저장소> 보냄 · main <커밋>」 4줄
```

**대조**

```bash
export PATH=$HOME/.local/bin:$PATH; G=$(git ls-remote gh-soge:seho0614/soge.git)
for r in sgb-core sgb-infra sgb-adx sgb-docs; do
  a=$(git ls-remote codecommit::ap-northeast-2://$r refs/heads/main | cut -c1-7)
  b=$(echo "$G" | grep -P "\trefs/heads/$r/main$" | cut -c1-7)
  echo "$r CodeCommit $a · GitHub $b $([ "$a" = "$b" ] && echo 같음 || echo 다름)"
done
```

**되살리기 (한 저장소 방식)**

```bash
# 저장소 하나를 작업 폴더로
git clone -b sgb-core/main git@github.com:seho0614/soge.git sgb-core
# 저장소 하나의 모든 갈래를 새 CodeCommit 으로 (앞머리 떼고)
git init --bare sgb-core.git && cd sgb-core.git
git fetch git@github.com:seho0614/soge.git 'refs/heads/sgb-core/*:refs/heads/*' 'refs/tags/sgb-core/*:refs/tags/*'
git push codecommit::ap-northeast-2://sgb-core 'refs/heads/*:refs/heads/*' --tags
```

**2026-10-29 첫 보내기 기록**

| 저장소 | CodeCommit main | GitHub `<저장소>/main` | 갈래 CodeCommit / GitHub |
|---|---|---|---|
| sgb-core | `54feb67` | `54feb67` 같음 | 146 / 146 |
| sgb-infra | `489b7ec` | `489b7ec` 같음 | 109 / 109 |
| sgb-adx | `5363cf4` | `5363cf4` 같음 | 1 / 1 |
| sgb-docs | `e04390b` | `e04390b` 같음 | 84 / 84 |

- GitHub 전체 342개(갈래 340 + 처음 `main` + HEAD) · 100MB 넘는 파일 0(가장 큰 것 8.5MB) · 보내기 전 5절 비밀값 검사 결과 그대로(가짜 값 3곳뿐).
- 되살리기 시험(10/29): `clone -b sgb-core/main` → `54feb67` · 앞머리 떼고 받기(sgb-adx) → `main 5363cf4` — 둘 다 됨.
- 배포 키 하나가 네 저장소를 모두 담으므로, 서버를 잃으면 GitHub 화면에서 그 키 하나만 지운다.

## 1. 한눈에

| 항목 | 정한 것 |
|---|---|
| 대상 | sgb-core · sgb-infra · sgb-adx · sgb-docs — **모든 갈래 · 태그 · 전체 기록** |
| GitHub 저장소 | 4개 · **비공개(Private)** · 대표 계정(또는 회사 조직) 아래 · 이름은 같게 |
| 보내는 곳 | 개발 서버 sgbdev(이미 CodeCommit 을 읽을 수 있음) → GitHub |
| 열쇠 | 저장소마다 **배포 키(Deploy key) 1개 · 쓰기 허용** — 그 저장소 하나만 쓸 수 있음 · 만료 없음 · GitHub 화면에서 바로 끊을 수 있음 |
| 주기 | 처음 한 번(사람 + Claude) → **매일 03:30 KST 자동**(4절 · 승인 뒤) |
| 보내는 방식 | `git push --all` + `--tags` · **강제(--force) · 지우기(--prune) 쓰지 않음** — CodeCommit 에서 갈래가 지워지거나 기록이 바뀌어도 GitHub 사본은 남고, 기록이 바뀌면 보내기가 실패해 알 수 있음 |
| 비용 | 비공개 저장소 무료(용량 권장 1GB 안 — 지금 합계 약 250MB) · Actions 는 끔(2-4) |

### 미리 확인한 것 (2026-10-28 · 개발 서버)

| 저장소 | 커밋 | `.git` 크기 | 기록에 `.env` · 열쇠 파일 이름 | 기록에 키 모양 문자열 |
|---|---|---|---|---|
| sgb-core | 170 | 145MB | 0(`.env.example` 만) | 시험용 가짜 값 2곳 |
| sgb-infra | 131 | 19MB | 0 | 시험용 가짜 값 1곳 |
| sgb-adx | 1 | 0.3MB | 0 | 0 |
| sgb-docs | 90 | 79MB | 0 | 0 |

- GitHub 은 **파일 하나 100MB 넘으면 거절**한다 — 지금 저장소에 그런 파일 없음(가장 큰 것은 시안 html 약 8.5MB — sgb-core `spec/proto.html` · sgb-docs `deliverables/*/SGB_Prototype_*.html`).
- sgb-core 에 `.github/workflows/db-invariants.yml`(올릴 때마다 도는 점검)이 있다 — GitHub 에서 돌 필요가 없으므로 **Actions 를 끈다**(2-4).

## 2. 처음 설정 (한 번 · 약 30분)

> 명령은 **한 블록씩.** 2-1 · 2-3 · 2-4 는 GitHub 화면 · 2-2 · 2-5 는 개발 서버(sgbdev).
> **열쇠 만들기(2-2)는 사람이 한다** — Claude 는 `~/.ssh` 를 읽지 않는다(금지 규칙). 사람이 공개 키(`.pub`)만 GitHub 에 붙여 넣는다.

### 2-1. GitHub 저장소 4개 만들기 (대표 · GitHub 화면)

```
GitHub → 오른쪽 위 + → New repository
 → Owner: 대표 계정(또는 회사 조직) · Repository name: sgb-core
 → Private ✓
 → README · .gitignore · license 모두 「추가하지 않음」(빈 저장소여야 함)
 → Create repository
(sgb-infra · sgb-adx · sgb-docs 도 같게)
```

- [ ] 4개 모두 Private · [ ] 4개 모두 비어 있음 · [ ] 계정에 **2단계 인증(2FA) 켜짐**(Settings → Password and authentication)

### 2-2. 배포 키 4개 만들기 (사람 · 개발 서버 sgbdev)

```bash
for r in sgb-core sgb-infra sgb-adx sgb-docs; do
  ssh-keygen -t ed25519 -N "" -C "sgbdev-backup-$r" -f ~/.ssh/gh_$r
done
cat ~/.ssh/gh_sgb-core.pub     # 공개 키 — 2-3 에 붙여 넣음(4개 각각)
```

`~/.ssh/config` 끝에 더하기(GitHub 주소 별칭 — 저장소마다 다른 키를 쓰게):

```
Host gh-sgb-core
  HostName github.com
  User git
  IdentityFile ~/.ssh/gh_sgb-core
  IdentitiesOnly yes
Host gh-sgb-infra
  HostName github.com
  User git
  IdentityFile ~/.ssh/gh_sgb-infra
  IdentitiesOnly yes
Host gh-sgb-adx
  HostName github.com
  User git
  IdentityFile ~/.ssh/gh_sgb-adx
  IdentitiesOnly yes
Host gh-sgb-docs
  HostName github.com
  User git
  IdentityFile ~/.ssh/gh_sgb-docs
  IdentitiesOnly yes
```

- 개인 키(`gh_sgb-*`, `.pub` 아닌 것)는 **어디에도 붙여 넣지 않는다.** 백업(docs/222)에도 넣지 않는다(잃으면 새로 만들어 2-3 을 다시 함).

### 2-3. 배포 키 등록 (대표 · GitHub 화면)

```
GitHub → sgb-core 저장소 → Settings → Deploy keys → Add deploy key
 → Title: sgbdev-backup
 → Key: gh_sgb-core.pub 내용 붙여 넣기
 → Allow write access ✓   (보내기에 필요)
 → Add key
(나머지 3개 저장소도 각자의 .pub 로)
```

### 2-4. GitHub 쪽 설정 (대표 · 저장소마다)

| 설정 | 값 | 까닭 |
|---|---|---|
| Settings → Actions → General | **Disable actions** | sgb-core 의 점검 작업이 GitHub 에서 돌지 않게 |
| Settings → General → Features | Issues · Wiki · Projects 끄기 | 백업 전용 — 여기서 일하지 않음 |
| Settings → Collaborators | 대표만 | 비공개 유지 |
| Settings → Code security → Secret scanning(보이면) | 켜기 | 비밀값이 섞여 들어오면 알림(비공개 저장소에서 쓸 수 있는지는 요금제에 따라 다름 — 확인 필요) |
| Settings → Branches → 보호 규칙 | **만들지 않음** | 보호 규칙이 있으면 백업 보내기가 막힐 수 있음 · 강제 보내기를 쓰지 않으므로 기록이 덮이지 않음 |

### 2-5. 첫 보내기 (Claude 또는 사람 · 개발 서버 sgbdev)

```bash
export PATH=$HOME/.local/bin:$PATH
OWNER=<GitHub 계정 또는 조직 이름>
for r in sgb-core sgb-infra sgb-adx sgb-docs; do
  ssh -T gh-$r 2>&1 | head -1          # 「Hi …! You've successfully authenticated」 — 키 확인
done
mkdir -p ~/mirror && cd ~/mirror
for r in sgb-core sgb-infra sgb-adx sgb-docs; do
  [ -d $r.git ] || git clone -q --mirror codecommit::ap-northeast-2://$r $r.git
  git -C $r.git remote add github gh-$r:$OWNER/$r.git 2>/dev/null || true
  git -C $r.git fetch -q --prune origin
  git -C $r.git push -q github 'refs/heads/*:refs/heads/*' && git -C $r.git push -q github --tags \
    && echo "$r 보냄 · main $(git -C $r.git rev-parse --short refs/heads/main)"
done
```

- `~/mirror/*.git` 은 보내기 전용 사본(작업 폴더 `~/sogaebank` 와 따로) — 작업 중인 갈래 · 고치는 중인 파일이 섞이지 않는다.
- 첫 보내기는 저장소 크기만큼 걸림(합계 약 250MB · 몇 분).

### 2-6. 확인

```bash
for r in sgb-core sgb-infra sgb-adx sgb-docs; do
  a=$(git ls-remote codecommit::ap-northeast-2://$r refs/heads/main | cut -c1-7)
  b=$(git ls-remote gh-$r:$OWNER/$r.git refs/heads/main | cut -c1-7)
  echo "$r CodeCommit $a · GitHub $b $([ "$a" = "$b" ] && echo 같음 || echo 다름)"
done
```

- [ ] 4줄 모두 「같음」 · [ ] GitHub 화면에서 커밋 수가 1절 표와 같음 · [ ] Actions 탭이 꺼져 있음

## 3. 평소 (매일 자동 · 4절 승인 전에는 손으로)

2-5 의 아래 반쪽(`fetch` → `push`)만 다시 돌린다. 바뀐 것만 보내므로 몇 초.

| 결과 | 뜻 | 할 일 |
|---|---|---|
| `보냄` 4줄 | 정상 | — |
| `rejected (non-fast-forward)` | CodeCommit 에서 **기록이 바뀜**(강제 보내기 · 되돌림) — 일어나면 안 되는 일 | **멈추고 대표에게 보고.** GitHub 사본이 바뀌기 전 기록을 지키고 있음 · 까닭 확인 뒤 사람이 결정 |
| `Permission denied (publickey)` | 배포 키가 지워졌거나 쓰기 허용이 꺼짐 | 2-3 확인 |
| `File … exceeds 100 MB` | 큰 파일이 커밋됨 | 그 커밋을 CodeCommit 에서 되돌리는 것은 사람이 결정 — 큰 파일은 Git 밖(`~/outputs` · S3)에 둔다 |

## 4. 자동화 (승인 뒤 · Claude)

| # | 할 일 |
|---|---|
| 1 | `sgb-infra/tools/backup-github.sh` — 0절 방식(한 저장소 · 앞머리) · 결과 한 줄을 `~/backup/github-last.txt` — **10/29 만듦 · 손으로 돌려 rc=0** |
| 2 | sgbdev 예약 작업(cron) 매일 03:30 KST — `30 18 * * * $HOME/bin/backup-github.sh` (등록 명령은 docs/222 4절 · 사람이 등록) |
| 3 | 실패하면 다음 대화 시작 점검에서 `github-last.txt` 를 먼저 봄 · 메일을 켠 뒤(docs/167)에는 실패 때 메일 |
| 4 | 결정 기록 deploy-cicd #8 을 「GitHub 비공개 저장소 하나(seho0614/soge) · 매일 · 배포 키」로 고침 |

## 5. 비밀값 미리 검사 (보내기 전에 한 번 · 2026-10-28 결과)

GitHub 으로 보내면 **기록 전체**가 나간다(지금 파일만이 아님). 그래서 처음 보내기 전에 전체 기록을 검사했다.

| 검사 | 결과 |
|---|---|
| 기록에 `.env` · `*.pem` · `*.key` · `id_rsa` 파일이 있었는지 | 4개 저장소 모두 **0**(`.env.example` 만 — 예시 값) |
| 기록에 키 모양 문자열(AWS `AKIA…` · Anthropic `sk-ant-…` · GitHub `ghp_…` · 개인 키 머리줄) | 3곳 — **모두 시험용 가짜 값**: sgb-core `scripts/test-s3-presign-offline.ts` 의 `AKIAIOSFODNN7EXAMPLE`(AWS 문서의 공식 예시 키) · `scripts/verify-invariants.sh` 의 `sk-ant-api03-…0123456789abcdefghij…`(키 저장 · 암호화 왕복 시험 값) · sgb-infra `qa/test_v1140.py` 의 `AKIATEST…`(메일 시험 값). 진짜 키 0 · sgb-adx · sgb-docs 0 |

- 하나라도 나오면 **보내지 않는다** — 그 키를 먼저 폐기 · 재발급하고, 기록에서 지울지는 대표가 정한다(기록을 고치면 CodeCommit · 백업 묶음 모두 영향).

## 6. GitHub 에서 되살리기

CodeCommit 을 쓸 수 없을 때(리전 사고 · 계정 문제):

```bash
git clone --mirror git@github.com:<OWNER>/sgb-core.git     # 대표 계정 열쇠로 · 4개 각각
# 새 CodeCommit 저장소(또는 다른 곳)로 옮길 때
git -C sgb-core.git push --mirror codecommit::ap-northeast-2://sgb-core
```

- 작업 폴더로 쓸 때는 `git clone git@github.com:<OWNER>/sgb-core.git sgb-core`.
- 되살린 뒤 `~/sgb-check.sh main realcheck` 한 번.

## 7. 주의

1. **GitHub 에서 커밋 · 풀 리퀘스트 · 갈래 만들기를 하지 않는다** — 다음 자동 보내기와 어긋난다(GitHub 은 사본).
2. 저장소를 **공개(Public)로 바꾸지 않는다** — 운영 설정 예시 · 업무 규칙 · 결정 기록이 들어 있다.
3. 배포 키는 저장소 하나에만 쓰인다. 개발 서버를 잃으면 GitHub 화면에서 4개를 지우고 새 서버에서 2-2 · 2-3 을 다시 한다.
4. 대표 계정 비밀번호 · 2FA 복구 코드는 회사 금고(오프라인)에 둔다 — 계정을 잃으면 백업도 잃는다.
5. 킷 zip · 디자인 원본 그림 · 대화 기록은 Git 밖이라 이 백업에 없다 — docs/222(S3 · 집 PC).

## 8. 확인하지 못한 것

| 무엇 | 까닭 |
|---|---|
| GitHub 요금제 | 계정 `seho0614` 는 10/29 정함 — 요금제는 GitHub 화면에서 확인 |
| 비공개 저장소 비밀값 검사(Secret scanning) 사용 가능 여부 · GitHub 요금 | 요금제 · 정책이 바뀔 수 있음 — 설정 때 GitHub 화면에서 확인 |
| ~~개발 서버에서 github.com 22번 포트로 나갈 수 있는지~~ | 10/29 확인 — `ssh -T gh-soge` 성공 · 22번 포트 나감 |
