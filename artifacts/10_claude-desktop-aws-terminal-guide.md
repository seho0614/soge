# Claude 데스크톱 ↔ AWS 터미널 연결 가이드 (초보자용)

Oct 13, 2026 · @박세호

## 0. 이 가이드로 할 수 있는 것

이 가이드를 끝까지 따라 하면 AWS 서버에서 Claude Code가 24시간 실행됩니다. PC 터미널, 웹 브라우저, 휴대폰 중 어디에서든 **같은 대화를 그대로 이어서** 쓸 수 있습니다.

**이 가이드의 기준 조건** (다르면 해당 단계만 바꾸면 됩니다)

- 서버: AWS EC2, 서울 리전, Ubuntu 24.04
- 요금제: Claude Pro 또는 Max (개인)
- 프로젝트: 소개뱅크 (Java/Spring Boot), GitHub로 관리
- 내 PC: Windows 10/11 또는 Mac

**시작 전에 꼭 알아야 할 사실 1가지**

Claude 데스크톱의 **채팅(Chat) 탭 대화와 그 안의 프로젝트 기록은 터미널로 자동으로 넘어가지 않습니다.** 공식 문서에서 둘을 연결하는 기능은 확인되지 않았습니다. 그래서 이 가이드는 두 가지로 나눠서 해결합니다.

1. **지금까지의 대화**: 핵심을 요약해서 `CLAUDE.md`(프로젝트 기억 파일)에 한 번 옮깁니다. (STEP 6)
2. **앞으로의 대화**: 처음부터 AWS 서버의 Claude Code에서 시작합니다. 그러면 모든 기기에서 같은 대화를 공유합니다. (STEP 7\~9)

**전체 순서** (예상 소요 시간: 처음 1회 약 1\~2시간)

1. STEP 1: AWS에 서버(EC2) 만들기
2. STEP 2: 내 PC에서 서버에 접속하기
3. STEP 3: 서버에 기본 도구 설치하기
4. STEP 4: Claude Code 설치하고 로그인하기
5. STEP 5: 소개뱅크 코드를 서버로 가져오기
6. STEP 6: 데스크톱 대화 내용을 CLAUDE.md로 옮기기
7. STEP 7: 꺼지지 않는 세션 만들기 (tmux + 원격 제어)
8. STEP 8: 휴대폰·웹에서 접속하기
9. STEP 9: 매일 쓰는 방법 익히기

**완성 후 전체 구조**

&#91;embedded content: 완성 후 전체 구조 · 기기 3개, Anthropic 서버, AWS EC2\]

Claude는 AWS 서버의 tmux 작업방 안에서 계속 실행됩니다. 휴대폰과 웹은 Anthropic 서버를 거쳐 그 대화에 붙고, 내 PC는 설정·관리할 때만 SSH로 직접 들어갑니다.

## 1. 용어 사전

처음 보는 단어가 나오면 이 표를 다시 보세요.

| 용어 | 쉬운 설명 | 이 가이드에서 하는 일 |
| --- | --- | --- |
| AWS | 아마존의 인터넷 서버 대여 서비스 | 서버를 빌립니다 |
| EC2 | AWS에서 빌리는 가상 컴퓨터 1대 | Claude Code를 설치할 컴퓨터 |
| 리전 | 서버가 있는 지역 | 서울(ap-northeast-2)을 고릅니다 |
| 인스턴스 | EC2 서버 1대를 부르는 말 | "인스턴스 시작" = 서버 켜기 |
| 키 페어(.pem 파일) | 서버 문을 여는 열쇠 파일 | 잃어버리면 접속 불가, 절대 공유 금지 |
| 보안 그룹 | 서버 방화벽(출입 허용 목록) | 내 IP만 들어오게 막습니다 |
| 터미널 | 글자로 명령을 입력하는 검은 창 | Windows는 PowerShell, Mac은 터미널 앱 |
| SSH | 내 PC에서 서버 터미널로 원격 접속하는 방법 | `ssh` 명령으로 서버에 들어갑니다 |
| Ubuntu | 서버용 리눅스 운영체제 | 서버에 설치되는 운영체제 |
| `sudo` | "관리자 권한으로 실행"이라는 뜻 | 프로그램 설치할 때 앞에 붙입니다 |
| Claude Code | 터미널에서 쓰는 Claude 개발 도우미 | 서버에서 코드를 읽고 고치고 실행합니다 |
| 세션 | Claude와 나눈 대화 1개 묶음 | 이 세션을 여러 기기에서 공유합니다 |
| tmux | SSH가 끊겨도 터미널을 살려 두는 프로그램 | PC를 꺼도 Claude가 계속 돌게 합니다 |
| 원격 제어(Remote Control) | 서버의 Claude 세션을 휴대폰·웹에서 조작하는 기능 | 같은 대화를 어디서든 이어갑니다 |
| CLAUDE.md | 프로젝트 폴더에 두는 "기억 메모" 파일 | 데스크톱에서 정한 내용을 옮겨 둡니다 |
| GitHub | 코드를 저장·공유하는 인터넷 창고 | 소개뱅크 코드를 서버로 받아옵니다 |
| 스왑(swap) | 메모리가 부족할 때 디스크를 메모리처럼 쓰는 공간 | 설치 중 멈춤을 막습니다 |

## 2. 시작 전 준비물

아래 항목이 모두 준비되면 STEP 1로 넘어가세요.

- [ ] **Claude 요금제**: Pro, Max, Team, Enterprise 중 하나 (무료 요금제는 Claude Code 사용 불가)
- [ ] **Team/Enterprise라면**: 조직 소유자가 관리자 설정에서 Remote Control을 켰는지 확인
- [ ] **AWS 계정**: 가입 완료, 결제 카드 등록 완료
- [ ] **GitHub 계정**: 소개뱅크 저장소에 접근 가능
- [ ] **내 PC**: Windows 10(1809 이후)/11 또는 Mac, 인터넷 연결
- [ ] **휴대폰**: Claude 앱 설치, 같은 계정으로 로그인
- [ ] **메모장**: 서버 IP, 파일 위치 등을 적어 둘 곳

**미리 알아 둘 주의사항**

- 서버에서는 **claude.ai 계정으로 로그인**해야 합니다. API 키나 AWS Bedrock(아마존의 AI 서비스)으로 연결하면 원격 제어가 동작하지 않습니다.
- 서버 메모리는 최소 4GB가 필요합니다. Spring Boot 빌드까지 함께 돌리려면 8GB를 권장합니다.
- 이 가이드의 화면 문구(버튼 이름 등)는 AWS와 Claude 앱 업데이트로 조금씩 바뀔 수 있습니다. 비슷한 이름의 버튼을 찾으면 됩니다.

## STEP 1. AWS에 서버(EC2) 만들기

이 단계가 끝나면 서울에 있는 Ubuntu 서버 1대와 접속 열쇠(.pem 파일)가 생깁니다. 예상 시간은 15분입니다.

**1-1. 콘솔에 들어가기**

1. 브라우저에서 AWS 콘솔(console.aws.amazon.com)에 로그인합니다.
2. 화면 오른쪽 위의 지역 이름을 눌러 **아시아 태평양(서울) ap-northeast-2**를 고릅니다.
3. 맨 위 검색창에 `EC2`를 입력하고 EC2 서비스로 들어갑니다.
4. 주황색 **인스턴스 시작** 버튼을 누릅니다.

**1-2. 서버 설정 입력하기** (아래 표대로 입력)

| 항목 | 입력값 | 이유 |
| --- | --- | --- |
| 이름 | `sogae-claude` | 나중에 찾기 쉽게 |
| 애플리케이션 및 OS 이미지 | Ubuntu Server 24.04 LTS | Claude Code 지원 운영체제 (20.04 이상) |
| 인스턴스 유형 | t3.large (메모리 8GB) | Claude + Spring Boot 빌드에 넉넉함. 테스트만 하면 t3.medium(4GB) |
| 키 페어 | **새 키 페어 생성** → 이름 `sogae-key`, 유형 RSA, 형식 `.pem` | 서버 접속 열쇠 |
| 네트워크 설정 | "SSH 트래픽 허용" 체크, 소스는 **내 IP** | 나만 접속하도록 |
| 스토리지 | 30 GiB, gp3 | 코드·빌드 파일 공간 |

**1-3. 열쇠 파일 저장하기 (가장 중요)**

1. 키 페어를 만들면 `sogae-key.pem` 파일이 자동으로 다운로드됩니다.
2. 이 파일은 **다시 받을 수 없습니다.** 잃어버리면 서버에 들어갈 수 없습니다.
3. 다른 사람에게 보내거나 GitHub에 올리지 마세요.

**1-4. 서버 켜고 주소 적어 두기**

1. 오른쪽의 **인스턴스 시작** 버튼을 누릅니다.
2. 왼쪽 메뉴 **인스턴스**에서 `sogae-claude`가 "실행 중"이 될 때까지 1\~2분 기다립니다.
3. 서버를 클릭하고 **퍼블릭 IPv4 주소**(예: `3.35.xxx.xxx`)를 메모장에 적습니다.

**알아 두기**

- 서버를 "중지"했다가 다시 켜면 퍼블릭 IP가 바뀝니다. 고정하려면 "탄력적 IP"를 연결하세요. 탄력적 IP 요금은 AWS에서 추가 확인이 필요합니다.
- 카페나 다른 장소에서는 내 IP가 바뀌어 접속이 막힙니다. 그때는 보안 그룹의 SSH 규칙 소스를 다시 "내 IP"로 바꾸면 됩니다.

## STEP 2. 내 PC에서 서버에 접속하기

이 단계가 끝나면 내 PC의 터미널 창이 AWS 서버의 터미널이 됩니다. Windows와 Mac 중 내 PC에 맞는 쪽만 하세요.

**2-1. Windows (PowerShell 사용)**

1. 시작 메뉴에서 `PowerShell`을 검색해 엽니다. ("x86"이 붙지 않은 것)
2. 열쇠 파일을 정해진 폴더로 옮깁니다. 아래 명령을 한 줄씩 붙여 넣고 Enter를 누릅니다.

```powershell
mkdir $env:USERPROFILE\.ssh -Force
Move-Item $env:USERPROFILE\Downloads\sogae-key.pem $env:USERPROFILE\.ssh\
```

3. 열쇠 파일을 나만 읽을 수 있게 바꿉니다. (이 작업을 안 하면 접속이 거부됩니다)

```powershell
icacls $env:USERPROFILE\.ssh\sogae-key.pem /inheritance:r
icacls $env:USERPROFILE\.ssh\sogae-key.pem /grant:r "$($env:USERNAME):(R)"
```

4. 서버에 접속합니다. `3.35.xxx.xxx` 자리에 STEP 1에서 적은 IP를 넣습니다.

```powershell
ssh -i $env:USERPROFILE\.ssh\sogae-key.pem ubuntu@3.35.xxx.xxx
```

**2-2. Mac (터미널 앱 사용)**

1. Spotlight(⌘ + Space)에서 `터미널`을 검색해 엽니다.
2. 아래 명령을 차례로 입력합니다.

```bash
mkdir -p ~/.ssh
mv ~/Downloads/sogae-key.pem ~/.ssh/
chmod 400 ~/.ssh/sogae-key.pem
ssh -i ~/.ssh/sogae-key.pem ubuntu@3.35.xxx.xxx
```

**2-3. 처음 접속할 때 나오는 질문**

- `Are you sure you want to continue connecting (yes/no)?` → `yes`를 입력하고 Enter
- 접속에 성공하면 맨 아래 줄이 `ubuntu@ip-172-xx-xx-xx:~$` 모양으로 바뀝니다. 이제부터 입력하는 명령은 **서버에서** 실행됩니다.
- 나갈 때는 `exit`를 입력합니다.

**2-4. 접속 단축키 만들기 (추천)**

매번 긴 명령을 치지 않도록 내 PC에 별명을 등록합니다. 이 설정은 나중에 데스크톱 앱 SSH 연결에도 그대로 씁니다.

1. 내 PC에서 메모장(Windows) 또는 `nano ~/.ssh/config`(Mac)로 `.ssh` 폴더 안에 `config`라는 파일(확장자 없음)을 만듭니다.
2. 아래 내용을 넣고 저장합니다. Windows는 IdentityFile 경로를 `C:/Users/내이름/.ssh/sogae-key.pem` 형식으로 씁니다.

```
Host sogae
    HostName 3.35.xxx.xxx
    User ubuntu
    IdentityFile ~/.ssh/sogae-key.pem
    ServerAliveInterval 60
```

3. 이제 `ssh sogae`만 입력하면 접속됩니다. `ServerAliveInterval`은 접속이 자동으로 끊기는 것을 줄여 줍니다.

## STEP 3. 서버에 기본 도구 설치하기

이 단계가 끝나면 서버에 git, tmux, Java가 설치되고 메모리 부족 대비가 됩니다. 아래 명령은 모두 **서버에 접속한 상태**에서 입력합니다.

**3-1. 한 번에 설치하기** (복사해서 통째로 붙여 넣어도 됩니다)

```bash
# 1) 설치 목록 최신화 + 기존 프로그램 업데이트
sudo apt update && sudo apt upgrade -y

# 2) git(코드 관리), tmux(세션 유지), Java 21(소개뱅크 실행), curl(다운로드)
sudo apt install -y git tmux openjdk-21-jdk curl

# 3) 서버 시간을 한국 시간으로
sudo timedatectl set-timezone Asia/Seoul
```

- 중간에 보라색 화면이 뜨며 무언가를 물으면 **Enter**를 누르면 됩니다.
- Java 버전은 소개뱅크 `build.gradle`(또는 `pom.xml`)에 적힌 버전에 맞추세요. 17이라면 `openjdk-17-jdk`로 바꿉니다.

**3-2. 스왑(보조 메모리) 2GB 만들기**

설치나 빌드 중 메모리가 부족하면 프로그램이 `Killed`라는 말과 함께 멈춥니다. 이를 막는 설정입니다.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**3-3. 잘 설치됐는지 확인하기**

```bash
git --version      # git version 2.x 가 나오면 성공
tmux -V            # tmux 3.x 가 나오면 성공
java -version      # openjdk version "21..." 이 나오면 성공
free -h            # Swap 줄에 2.0Gi 가 보이면 성공
```

## STEP 4. Claude Code 설치하고 로그인하기

이 단계가 끝나면 서버에서 `claude` 명령이 동작하고 내 Claude 계정으로 로그인됩니다. 서버에는 화면(브라우저)이 없기 때문에 **로그인만 내 PC 브라우저에서** 합니다.

**4-1. 설치하기**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

설치가 끝나면 실행 경로를 다시 불러오고 확인합니다.

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
claude --version   # 예: 2.1.xxx (Claude Code) 가 나오면 성공
claude doctor      # 설치 상태 자동 진단. 경고가 있으면 안내대로 처리
```

- 이 방식으로 설치하면 **자동 업데이트**됩니다. 따로 관리할 필요가 없습니다.
- `claude: command not found`가 나오면 `exit`로 나갔다가 다시 접속해 보세요.

**4-2. 로그인하기**

1. 서버에서 `claude`를 입력합니다.
2. 화면 테마(색상)를 고르라고 하면 화살표로 고르고 Enter를 누릅니다.
3. 로그인 방법은 \*\*Claude 계정(구독)\*\*으로 로그인하는 항목을 고릅니다. (API 키 항목이 아님)
4. 터미널에 긴 로그인 주소가 나옵니다. 키보드의 **`c`를 누르면 주소가 복사**됩니다.
5. 내 PC 브라우저 주소창에 붙여 넣고 Claude 계정으로 로그인한 뒤 **승인**합니다.
6. 브라우저 화면에 **코드**가 나타납니다. 이 코드를 복사합니다.
7. 서버 터미널의 `Paste code here if prompted` 칸에 붙여 넣고 Enter를 누릅니다.
8. "이 폴더를 신뢰하겠습니까?" 같은 질문이 나오면 내 폴더일 때만 **Yes**를 고릅니다.

**4-3. 로그인 확인하기**

Claude Code 입력창에 `/status`를 입력합니다. 로그인 방식이 Claude 계정(Pro/Max 등)으로 표시되면 성공입니다. 확인 후 `/exit`로 나옵니다.

**붙여 넣기가 안 될 때**

- Windows 터미널은 **마우스 오른쪽 클릭** 또는 **Shift + Insert**로 붙여 넣어 보세요.
- 그래도 안 되면 `claude auth login`을 입력해 같은 과정을 다시 진행합니다.

**하면 안 되는 것**

- `ANTHROPIC_API_KEY`(API 키 환경 변수)를 서버에 설정하지 마세요. 설정돼 있으면 계정 로그인 대신 API 키가 쓰여 **원격 제어가 막힙니다.**
- `claude setup-token`으로 만든 장기 토큰도 원격 제어에는 쓸 수 없습니다.

## STEP 5. 소개뱅크 코드를 서버로 가져오기

이 단계가 끝나면 서버의 `~/sogaebank` 폴더에 소개뱅크 코드가 생깁니다. 서버가 GitHub에 접속할 수 있도록 서버 전용 열쇠를 등록합니다.

**5-1. 서버 전용 GitHub 열쇠 만들기**

```bash
ssh-keygen -t ed25519 -C "sogae-ec2"
```

- 저장 위치와 암호를 물으면 세 번 모두 **Enter**만 누릅니다.

```bash
cat ~/.ssh/id_ed25519.pub
```

- `ssh-ed25519 AAAA... sogae-ec2`로 시작하는 한 줄이 나옵니다. 이 줄 전체를 복사합니다. (`.pub`이 붙은 공개 열쇠만 복사합니다)

**5-2. GitHub에 등록하기** (둘 중 하나)

| 방법 | 위치 | 언제 쓰나 |
| --- | --- | --- |
| 저장소 전용 키 (추천) | GitHub 저장소 → Settings → Deploy keys → Add deploy key, "Allow write access" 체크 | 이 서버가 소개뱅크 저장소에만 접근 |
| 계정 전체 키 | GitHub 오른쪽 위 프로필 → Settings → SSH and GPG keys → New SSH key | 여러 저장소를 다룰 때 |

**5-3. 연결 확인하고 코드 받기**

```bash
ssh -T git@github.com
# "Hi ...! You've successfully authenticated" 가 나오면 성공 (처음엔 yes 입력)

cd ~
git clone git@github.com:<내계정>/<저장소이름>.git sogaebank
cd sogaebank

# 커밋에 남길 내 이름과 이메일
git config --global user.name "박세호"
git config --global user.email "<내 이메일>"
```

**저장소가 아직 없다면**

```bash
mkdir -p ~/sogaebank && cd ~/sogaebank && git init
```

나중에 GitHub에 빈 저장소를 만들고 `git remote add origin git@github.com:<내계정>/<저장소이름>.git`으로 연결합니다.

## STEP 6. 데스크톱 대화 내용을 CLAUDE.md로 옮기기

이 단계가 끝나면 서버의 Claude가 데스크톱에서 정한 내용을 알고 시작합니다. Claude Code는 프로젝트 폴더의 `CLAUDE.md`를 **매 세션 시작 때 자동으로 읽습니다.** 한 번만 하면 됩니다.

**6-1. 데스크톱에서 요약 받기**

1. Claude 데스크톱 앱 → 채팅 탭 → 소개뱅크 프로젝트의 대화를 엽니다.
2. 아래 문장을 그대로 복사해 보냅니다.

```
지금까지 이 프로젝트에서 나눈 대화와 프로젝트 자료를 바탕으로,
개발용 CLAUDE.md 파일을 마크다운으로 작성해 줘.
항목: 1) 프로젝트 목표 2) 대상 사용자 3) 기술 스택과 버전
4) 확정된 설계와 결정사항(이유 포함) 5) 금지사항과 코딩 규칙
6) 진행 중인 작업과 다음 할 일 7) 자주 쓰는 명령어.
확정되지 않은 내용은 '미정'으로 표시하고, 200줄 이내로 써 줘.
```

3. 결과를 읽어 보고 틀린 내용은 직접 고칩니다. **이 파일이 앞으로 Claude의 기준이 되므로** 꼭 검토하세요.

**6-2. 서버에 CLAUDE.md 만들기**

```bash
cd ~/sogaebank
nano CLAUDE.md
```

1. 열린 편집 화면에 요약 내용을 붙여 넣습니다. (Windows는 마우스 오른쪽 클릭)
2. **Ctrl + O** → Enter로 저장, **Ctrl + X**로 나옵니다.

**6-3. CLAUDE.md 기본 뼈대** (요약이 비어 있는 항목은 이 형식에 맞춰 채우세요)

```markdown
# 소개뱅크 (SoGaeBaenk)

## 목표
- 일자리 창출형 소개 경제 플랫폼

## 기술 스택
- Java 21, Spring Boot 3.x, (DB 이름), (빌드 도구)

## 확정된 결정
- (데스크톱 요약 붙여넣기)

## 규칙
- 빌드: ./gradlew build / 테스트: ./gradlew test
- .env 파일과 운영 DB에는 접근 금지
- 큰 변경은 먼저 계획을 보여 주고 승인 후 진행

## 참고 문서
@docs/brand-guide.md
@docs/launch-strategy.md
```

- 맨 아래 `@docs/파일명`은 "이 파일도 같이 읽어라"라는 뜻입니다. 긴 자료는 CLAUDE.md에 다 넣지 말고 `docs/` 폴더에 따로 두세요.

**6-4. 데스크톱 프로젝트 자료 파일을 서버로 보내기**

프로젝트에 올려 둔 문서 파일이 있다면 **내 PC에서** 아래 명령으로 서버에 보냅니다. (STEP 2-4에서 `sogae` 별명을 만든 경우)

```bash
ssh sogae "mkdir -p ~/sogaebank/docs"
scp ./brand-guide.md sogae:~/sogaebank/docs/
```

**6-5. 저장하고 확인하기**

```bash
cd ~/sogaebank
git add CLAUDE.md docs/
git commit -m "Add CLAUDE.md project memory"
git push
```

서버에서 `claude`를 실행한 뒤 "CLAUDE.md 읽고 이 프로젝트를 5줄로 요약해 줘"라고 물어보세요. 내용이 맞게 나오면 성공입니다. 세션 안에서 `/memory`를 입력하면 불러온 기억 파일을 보고 고칠 수 있습니다.

## STEP 7. 꺼지지 않는 세션 만들기 (tmux + 원격 제어)

이 단계가 이 가이드의 핵심입니다. 끝나면 SSH를 끊거나 PC를 꺼도 서버의 Claude 대화가 계속 살아 있고, 휴대폰과 웹에서 같은 대화를 볼 수 있습니다.

**7-1. tmux 사용법 3가지만 기억하기**

| 하고 싶은 일 | 입력 |
| --- | --- |
| 새 작업방 만들기 | `tmux new -s sogae` |
| 작업방에서 잠깐 나오기 (계속 실행됨) | **Ctrl + b**를 누르고 손을 뗀 뒤 **d** |
| 작업방으로 다시 들어가기 | `tmux attach -t sogae` |

그 밖에 `tmux ls`는 작업방 목록, 작업방 안에서 `exit`는 작업방을 완전히 닫습니다.

**7-2. 원격 제어 세션 시작하기**

```bash
tmux new -s sogae
cd ~/sogaebank
claude --remote-control "소개뱅크"
```

1. 처음이면 `Enable Remote Control? (y/n)` 질문이 나옵니다. `y`를 누릅니다.
2. 폴더 신뢰 질문이 나오면 `y`를 누릅니다.
3. 화면 아래쪽에 **`/rc active`** 표시가 보이면 연결된 것입니다. (창이 좁으면 안 보일 수 있습니다)
4. Claude 입력창에 `/remote-control`을 입력하면 **세션 주소와 QR 코드**가 나옵니다.
5. 이제 **Ctrl + b → d**로 작업방에서 나옵니다. Claude는 서버에서 계속 실행됩니다.
6. SSH 창을 닫아도, PC를 꺼도 괜찮습니다.

**7-3. 원클릭 실행 스크립트 만들기 (추천)**

매번 위 명령을 치지 않도록 스크립트를 만들어 둡니다.

```bash
nano ~/start-claude.sh
```

아래 내용을 붙여 넣고 저장(Ctrl + O, Enter, Ctrl + X)합니다.

```bash
#!/usr/bin/env bash
# 작업방이 있으면 들어가고, 없으면 새로 만들어 Claude를 원격 제어로 실행
cd ~/sogaebank
if tmux has-session -t sogae 2>/dev/null; then
  tmux attach -t sogae
else
  tmux new -s sogae "claude --remote-control '소개뱅크'; bash"
fi
```

```bash
chmod +x ~/start-claude.sh
```

이제부터는 서버에 접속해서 `~/start-claude.sh` 한 줄만 입력하면 됩니다.

**왜 tmux가 꼭 필요한가요?**

원격 제어는 서버의 `claude` 프로그램이 켜져 있어야 동작합니다. tmux 없이 실행하면 SSH가 끊기는 순간 `claude`도 꺼지고 휴대폰 연결도 끊깁니다. 공식 문서도 원격 서버에서는 tmux 안에서 실행하라고 안내합니다.

## STEP 8. 휴대폰·웹에서 접속하기

이 단계가 끝나면 서버의 같은 대화를 휴대폰과 웹 브라우저에서 이어서 쓸 수 있습니다. 어느 기기에서 보낸 메시지든 모든 기기에 바로 똑같이 보입니다.

**8-1. 휴대폰 (Claude 앱)**

1. Claude 앱을 서버와 **같은 계정**으로 로그인합니다.
2. 앱 메뉴에서 **Code**를 누릅니다.
3. 목록에서 **"소개뱅크"** 세션을 찾습니다. 컴퓨터 아이콘과 **초록색 점**이 있으면 연결된 상태입니다.
4. 눌러서 들어가 메시지를 보내면 서버의 Claude가 작업합니다.

가장 빠른 방법: STEP 7-2에서 `/remote-control`로 띄운 **QR 코드를 휴대폰 카메라로 찍으면** 바로 열립니다.

**8-2. PC 웹 브라우저**

1. 브라우저에서 `claude.ai/code`에 들어갑니다.
2. 세션 목록에서 "소개뱅크"를 고릅니다. 또는 STEP 7-2에서 본 세션 주소를 직접 엽니다.

**8-3. 휴대폰·웹에서 할 수 있는 것**

- 메시지 보내기, 작업 지시, Claude의 질문에 답하기
- 파일 수정·명령 실행 **승인/거절**
- 사진이나 파일 첨부 (서버로 내려받아 Claude가 읽습니다)
- `/compact`(대화 압축), `/clear`(새로 시작), `/model sonnet`(모델 변경) 같은 일부 명령

**8-4. 휴대폰·웹에서 안 되는 것**

- `/resume`(다른 대화로 전환), `/plugin` 같은 일부 명령은 서버 터미널에서만 됩니다.
- Claude 데스크톱 앱의 **채팅 탭**에는 이 세션이 나타나지 않습니다. PC에서는 웹 브라우저(`claude.ai/code`)를 쓰세요. 데스크톱 앱 안에서 원격 제어 세션을 여는 정확한 방법은 추가 확인이 필요합니다.

## STEP 9. 매일 쓰는 방법

설정이 끝난 뒤에는 아래 표의 상황별 명령만 알면 됩니다.

| 상황 | 할 일 |
| --- | --- |
| 아침에 PC에서 작업 시작 | `ssh sogae` → `~/start-claude.sh` |
| 외출할 때 | 터미널에서 **Ctrl + b → d** 후 창 닫기. 이후 휴대폰 앱으로 계속 |
| 이동 중 | 휴대폰 Claude 앱 → Code → 소개뱅크 |
| 서버가 재부팅됐거나 Claude가 꺼졌을 때 | `ssh sogae` → `tmux new -s sogae` → `cd ~/sogaebank` → `claude --continue` → 입력창에 `/remote-control` |
| 예전 대화 중 골라서 이어가기 | `claude --resume` → 화살표로 고르고 Enter |
| 새 주제로 대화 시작 | Claude 안에서 `/clear` (이전 대화는 저장되어 `/resume`으로 다시 열 수 있음) |
| 대화에 이름 붙이기 | Claude 안에서 `/rename 결제기능` |
| 대화가 너무 길어져 느릴 때 | `/compact` (요약해서 공간 확보) |
| 오늘 쓴 사용량 보기 | `/usage` |
| 서버 비용 아끼기 | AWS 콘솔에서 인스턴스 **중지**. 다시 켜면 IP가 바뀌니 `~/.ssh/config`의 HostName 수정 |

**좋은 사용 습관**

1. 주제마다 대화를 나누고 `/rename`으로 이름을 붙이세요. 나중에 찾기 쉽습니다.
2. 중요한 결정이 나오면 "이 결정을 CLAUDE.md에 추가해 줘"라고 요청하세요. 다음 대화에서도 기억합니다.
3. 큰 작업은 먼저 "계획만 세워 줘"라고 해서 계획을 확인한 뒤 진행하세요. **Shift + Tab**을 눌러 계획 모드로 바꿀 수도 있습니다.
4. 하루 작업이 끝나면 `git commit`과 `git push`로 코드를 GitHub에 저장하세요.

## 선택 설정 (편의 기능)

필수는 아니지만 해 두면 편한 설정 3가지입니다.

**A. 데스크톱 앱 화면으로 서버의 Claude 쓰기 (SSH 연결)**

터미널 대신 데스크톱 앱의 그래픽 화면으로 서버에서 작업하는 방법입니다. 변경 내용 비교 화면과 파일 첨부를 쓸 수 있습니다.

1. Claude 데스크톱 앱 → **Code** 탭으로 갑니다.
2. 입력창 근처의 환경 선택(Local/Cloud) 메뉴 → **+ Add SSH connection**을 누릅니다.
3. 아래처럼 입력합니다.

| 칸 | 입력값 |
| --- | --- |
| Name | 소개뱅크 AWS |
| SSH Host | `sogae` (STEP 2-4 별명) 또는 `ubuntu@3.35.xxx.xxx` |
| SSH Port | 비워 두기 (기본 22) |
| Identity File | `~/.ssh/sogae-key.pem` (별명을 쓰면 비워도 됨) |

4. 환경에서 "소개뱅크 AWS"를 고르고 폴더는 `/home/ubuntu/sogaebank`를 선택합니다.

주의: 이 방식의 세션 목록은 데스크톱 앱이 따로 관리합니다. STEP 7의 tmux 세션과 자동으로 합쳐지지 않지만, 같은 `CLAUDE.md`를 읽으므로 기억은 공유됩니다. 데스크톱 앱을 닫았을 때 이 세션이 계속 실행되는지는 추가 확인이 필요합니다.

**B. Claude를 켤 때마다 원격 제어 자동 연결**

서버의 Claude 입력창에서 `/config` → **Enable Remote Control for all sessions**를 `true`로 바꿉니다. 이후에는 `claude`만 실행해도 휴대폰에서 보입니다.

**C. 휴대폰 알림 받기**

1. 휴대폰 Claude 앱에서 알림을 허용합니다.
2. 서버의 Claude 입력창에서 `/config` → **Push when actions required**(승인이 필요할 때)와 **Push when Claude decides**(작업 완료 등)를 켭니다.
3. 알림이 안 오면 휴대폰에서 Claude 앱을 한 번 열어 주세요.

**설정 파일로 한 번에 하기** (B + 비밀 파일 보호)

서버에서 `nano ~/.claude/settings.json`을 열고 아래 내용을 넣습니다. 파일이 이미 있으면 내용을 합쳐 주세요.

```json
{
  "remoteControlAtStartup": true,
  "permissions": {
    "deny": ["Read(./.env)", "Read(./**/*.pem)"]
  }
}
```

- `remoteControlAtStartup`: 원격 제어 자동 연결
- `deny`: Claude가 `.env`(비밀번호 파일)와 `.pem`(열쇠 파일)을 읽지 못하게 막음

## 비용과 필요한 자원

고정 비용은 Claude 요금제와 EC2 서버 두 가지입니다. 요금은 수시로 바뀌므로 **아래 금액은 반드시 공식 페이지에서 다시 확인**하세요.

| 항목 | 내용 | 확인 방법 |
| --- | --- | --- |
| Claude 요금제 | Pro 또는 Max. 터미널 사용량도 같은 요금제 한도에서 차감 | claude.ai 설정의 요금제 화면 |
| EC2 서버 (t3.large, 24시간) | 대략 월 수만 원대. 정확한 금액은 추가 확인 필요 | AWS 요금 계산기(calculator.aws), 서울 리전 선택 |
| 디스크 (EBS 30GB) | 소액 | AWS 요금 계산기 |
| 탄력적 IP (선택) | 사용 조건에 따라 과금 | AWS 요금 페이지 |
| 데이터 전송 | 일반 사용은 소량 | AWS 청구서 |

**비용 줄이는 방법**

1. 밤이나 주말처럼 안 쓰는 시간에는 인스턴스를 **중지**하세요. 중지 중에는 서버 요금이 거의 나가지 않습니다(디스크 요금은 계속 나감).
2. 처음에는 t3.medium(4GB)으로 시작하고, 빌드가 느리면 t3.large로 올리세요. 유형은 중지한 상태에서 바꿀 수 있습니다.
3. AWS 콘솔의 \*\*결제 → 예산(Budgets)\*\*에서 월 예산 알림을 걸어 두세요.

**필요한 시간**: 처음 설정 1\~2시간, 이후 매일 접속 1분.

## 문제 해결표

오류가 나면 화면에 나온 영어 문장의 앞부분을 이 표에서 찾으세요. 표에 없으면 서버에서 `claude doctor`를 실행해 진단 결과를 확인합니다.

| 화면에 나온 문구 / 증상 | 원인 | 해결 방법 |
| --- | --- | --- |
| `Permission denied (publickey)` (SSH 접속 시) | 열쇠 파일 경로가 틀렸거나 권한 설정 안 됨 | STEP 2의 `icacls`(Windows) 또는 `chmod 400`(Mac) 다시 실행, 사용자 이름이 `ubuntu`인지 확인 |
| SSH가 한참 멈췄다가 `timed out` | 보안 그룹의 내 IP가 바뀜, 또는 서버 IP가 바뀜 | 보안 그룹 SSH 소스를 "내 IP"로 다시 설정, AWS 콘솔에서 새 IP 확인 |
| `WARNING: UNPROTECTED PRIVATE KEY FILE!` | 열쇠 파일을 다른 사람도 읽을 수 있음 | STEP 2의 권한 명령 실행 |
| 설치 중 `Killed` 또는 `exit code 137` | 메모리 부족 | STEP 3-2 스왑 만들기 후 재설치 |
| `claude: command not found` | 실행 경로가 아직 반영 안 됨 | `source ~/.bashrc` 또는 접속을 끊었다가 다시 접속 |
| 로그인 후 서버로 돌아오지 않음 | 서버에 브라우저가 없음 (정상) | 브라우저에 나온 **코드**를 터미널에 붙여 넣기 |
| `OAuth error: Invalid code` | 코드가 만료되었거나 일부만 복사됨 | Enter로 다시 시도하고 빨리 전체 코드 붙여 넣기 |
| `Remote Control requires a claude.ai subscription` | 로그인 안 됨, 또는 API 키가 우선 사용됨 | `claude auth login` 실행, `unset ANTHROPIC_API_KEY` 후 `~/.bashrc`에서 해당 줄 삭제 |
| `Remote Control requires a full-scope login token` | `setup-token` 장기 토큰 사용 중 | `claude auth login`으로 일반 로그인 |
| `only available when using Claude via api.anthropic.com` | Bedrock 연결 또는 `ANTHROPIC_BASE_URL` 설정됨 | 해당 환경 변수 삭제 후 Claude 계정으로 로그인 |
| `Remote Control is disabled by your organization's policy` | Team/Enterprise 조직에서 기능이 꺼져 있음 | 조직 소유자에게 관리자 설정에서 Remote Control 켜 달라고 요청 |
| `Remote Control isn't enabled for this account` | 요금제 변경 후 계정 정보가 오래됨 | `claude auth logout` → `claude auth login` |
| 휴대폰 목록에 세션이 안 보임 / 회색 | 서버의 `claude`가 꺼짐 | `ssh sogae` → `tmux attach -t sogae`로 확인, 꺼졌으면 STEP 9의 "재부팅됐을 때" 순서대로 |
| SSH를 끊으니 세션도 사라짐 | tmux 밖에서 실행함 | 반드시 STEP 7처럼 tmux 안에서 실행 |
| `Couldn't reconnect to your Remote Control session` | 일시적인 네트워크 문제 | Claude 입력창에서 `/remote-control` 다시 입력 |
| 휴대폰 알림이 안 옴 | 앱 알림 토큰 미갱신 | 휴대폰에서 Claude 앱 한 번 열기, 알림 권한 확인 |
| `git clone` 시 `Permission denied` | GitHub에 서버 열쇠 미등록 | STEP 5-1, 5-2 다시 확인, `ssh -T git@github.com`으로 점검 |

## 보안 수칙

서버는 인터넷에 연결된 컴퓨터라서 아래 7가지는 꼭 지켜 주세요.

1. **열쇠 파일(.pem) 보호**: 다른 사람에게 보내지 말고, GitHub·클라우드 드라이브·메신저에 올리지 마세요.
2. **SSH는 내 IP만 허용**: 보안 그룹에서 22번 포트 소스를 `0.0.0.0/0`(전 세계)으로 바꾸지 마세요.
3. **들어오는 포트를 더 열 필요 없음**: 원격 제어는 서버가 바깥으로만 연결합니다. 원격 제어를 위해 포트를 추가로 열지 마세요.
4. **비밀 정보는 대화에 넣지 않기**: 원격 제어를 켜 두면 대화 기록이 Anthropic 서버에도 저장됩니다. DB 비밀번호, 카드 정보 등은 붙여 넣지 마세요.
5. **`.env` 파일 차단**: 선택 설정의 `settings.json` 예시처럼 `deny` 규칙을 넣고, `.env`는 `.gitignore`에 추가하세요.
6. **"권한 우회 모드"는 쓰지 않기**: 모든 확인을 건너뛰는 모드(`--dangerously-skip-permissions`)는 격리된 테스트 서버에서만 쓰세요. 실제 데이터가 있는 서버에서는 Claude가 묻는 승인을 직접 확인하세요.
7. **운영 서버와 분리**: 이 서버는 개발용으로만 쓰고, 실제 고객이 쓰는 운영 서버·운영 DB 접속 정보는 두지 마세요.

**서버 정리할 때**: 더 이상 쓰지 않으면 AWS 콘솔에서 인스턴스를 **종료**하세요. 종료하면 디스크까지 삭제되므로, 먼저 `git push`로 코드를 저장했는지 확인합니다.

## 터미널 모드(AWS)의 장점과 단점

24시간 작업과 자동화가 필요하면 터미널 모드가 유리하고, 화면으로 보며 작업하는 편안함은 데스크톱이 낫습니다.

| 구분 | AWS 터미널 모드 | 데스크톱 앱 (내 PC) |
| --- | --- | --- |
| PC를 꺼도 작업 계속 | 가능 | 불가 (클라우드 세션 제외) |
| 휴대폰에서 이어하기 | 원격 제어로 가능 | 원격 제어로 가능하나 PC가 켜져 있어야 함 |
| 실제 서비스와 같은 환경 (Linux, Java) | 같음 | PC 환경에 따라 다름 |
| 자동화 (`claude -p`, 정기 작업) | 가능 | 일부만 |
| 여러 Claude가 나눠 일하기 (에이전트 팀) | 가능 | 터미널 전용 기능 |
| 변경 내용 비교 화면, 앱 미리보기 | 없음 (선택 설정 A로 보완) | 있음 |
| 파일·사진 첨부 | 터미널에선 불가, 휴대폰·웹에서 가능 | 가능 |
| 데스크톱 채팅 기록 연동 | 안 됨 (CLAUDE.md로 옮김) | Code 탭도 채팅 기록과 별개 |
| 추가 비용 | EC2 요금 | 없음 |
| 관리 부담 | 서버 보안·키·비용 직접 관리 | 거의 없음 |
| 배우는 데 걸리는 시간 | 명령어 학습 필요 | 쉬움 |

**정리하면**

- **장점**: 24시간 실행, 운영과 같은 서버 환경, 자동화, 휴대폰으로 언제든 지시·승인, 들어오는 포트를 열지 않는 안전한 연결.
- **단점**: 채팅 기록 수동 이관, 화면 기능 부족, 서버 비용과 관리 부담, 사용량이 요금제 한도를 함께 씀, 대화 기록이 Anthropic 서버에도 저장됨.

## 최종 체크리스트와 명령어 카드

아래 항목이 모두 체크되면 설정이 끝난 것입니다.

**완료 체크리스트**

- [ ] EC2 서버가 서울 리전에서 "실행 중"이다
- [ ] `.pem` 열쇠 파일을 안전한 곳에 보관했다
- [ ] 보안 그룹 SSH가 "내 IP"로만 열려 있다
- [ ] `ssh sogae`로 접속된다
- [ ] `claude --version`과 `claude doctor`가 정상이다
- [ ] `/status`에서 Claude 계정(구독) 로그인으로 표시된다
- [ ] `~/sogaebank`에 코드가 있고 `git push`가 된다
- [ ] `CLAUDE.md`를 만들고 내용을 검토했다
- [ ] tmux 안에서 `/rc active`가 보인다
- [ ] 휴대폰 Claude 앱 Code 목록에 "소개뱅크"가 초록 점으로 보인다
- [ ] 휴대폰에서 보낸 메시지가 서버 터미널에도 보인다
- [ ] AWS 예산 알림을 설정했다

**명령어 카드** (이것만 외우면 됩니다)

| 어디서 | 명령 | 뜻 |
| --- | --- | --- |
| 내 PC | `ssh sogae` | 서버 접속 |
| 서버 | `~/start-claude.sh` | Claude 작업방 열기 (없으면 새로 만듦) |
| 서버 | **Ctrl + b → d** | 작업방에서 나오기 (계속 실행) |
| 서버 | `tmux attach -t sogae` | 작업방으로 돌아가기 |
| 서버 | `claude --continue` | 이 폴더의 마지막 대화 이어하기 |
| 서버 | `claude --resume` | 대화 목록에서 골라 이어하기 |
| Claude 안 | `/remote-control` | 원격 제어 연결 / 주소·QR 보기 |
| Claude 안 | `/status` | 로그인·상태 확인 |
| Claude 안 | `/rename 이름` | 대화 이름 붙이기 |
| Claude 안 | `/compact` | 긴 대화 압축 |
| Claude 안 | `/clear` | 새 대화 시작 |
| Claude 안 | `/memory` | CLAUDE.md 보기·수정 |
| Claude 안 | `/exit` | Claude 종료 |

**출처** (2026-10-13 확인, 공식 문서)

- [Remote Control (원격 제어)](https://code.claude.com/docs/en/remote-control)
- [Desktop application (데스크톱 앱, SSH 세션, CLI와 공유되는 설정)](https://code.claude.com/docs/en/desktop)
- [Manage sessions (세션 이어하기)](https://code.claude.com/docs/en/sessions)
- [Advanced setup (설치·시스템 요구사항)](https://code.claude.com/docs/en/setup)
- [Troubleshoot installation and login (설치·로그인 문제 해결)](https://code.claude.com/docs/en/troubleshoot-install)
