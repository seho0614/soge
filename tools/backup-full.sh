#!/bin/bash
# 개발 서버 전체 백업 3개 (sgb-core docs/222 3-3 ~ 3-5 · docs/224)
#   full_<T>.tar.gz        저장소 4개 묶음(git bundle --all) · 서버 스크립트 · Claude 설정 · 기억
#   devhome_<T>.tar.gz     개발 작업 폴더(커밋 안 된 것 · 킷 · 산출물)
#   claude_work_<T>.tar.gz Claude 대화 · 기억 · 설정 · 작업 스크립트
# 넣지 않음: .env · *.pem · *.key · ~/.aws · ~/.ssh · ~/.claude.json · .bash_history
# 서버에는 최근 KEEP 벌만 남김(기본 2) · 집 PC 로는 대표가 받음(docs/222 3-6)
# 예약: 매주 일요일 04:00 KST (crontab 0 19 * * 6) · 결과 한 줄 ~/backup/last.txt
set -u
export PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
KEEP=${KEEP:-2}
BK=$HOME/backup
LOG=$BK/last.txt
mkdir -p $BK
exec 9>$BK/.lock
flock -n 9 || { echo "$(date -u +%FT%TZ) 건너뜀 — 앞의 백업이 아직 도는 중" >> $LOG; exit 0; }
fail() { echo "$(date -u +%FT%TZ) 실패 — $1" | tee -a $LOG; exit 1; }

avail=$(df -BM --output=avail $HOME | tail -1 | tr -dc 0-9)
[ "$avail" -gt 3000 ] || fail "디스크 여유 ${avail}MB (3GB 미만)"

T=$(date -u +%Y%m%d_%H%M)
B=$BK/full_$T
# Claude 대화 · 기억 폴더 이름은 작업 폴더 경로에서 나옴(/home/sgbdev/sogaebank → -home-sgbdev-sogaebank) — 계정을 바꿔도 맞게(docs/251 1-4)
CP=$(echo "$HOME/sogaebank" | sed 's#/#-#g')
mkdir -p $B/repos $B/claude $B/tools

# 1. 저장소 4개
heads=""
for r in sgb-core sgb-infra sgb-adx sgb-docs; do
  cd $HOME/sogaebank/$r || fail "$r 폴더 없음"
  git fetch -q --all || fail "$r 받아오기"
  git bundle create -q $B/repos/$r.bundle --all || fail "$r 묶기"
  git bundle verify -q $B/repos/$r.bundle >/dev/null 2>&1 || fail "$r 묶음 검사"
  heads="$heads $r=$(git rev-parse --short origin/main)"
done
cp $HOME/sgb-check.sh $HOME/make-kit.sh $HOME/import-kit.sh $HOME/start-claude.sh $HOME/step17.sh $B/tools/
cp $HOME/sogaebank/sgb-infra/tools/backup-*.sh $B/tools/ 2>/dev/null
cp $HOME/.claude/CLAUDE.md $HOME/.claude/settings.json $B/claude/
cp -r $HOME/.claude/projects/$CP/memory $B/claude/memory
cp $HOME/sogaebank/CLAUDE.md $B/claude/project-CLAUDE.md
cd $BK && tar -czf full_$T.tar.gz full_$T && rm -rf full_$T || fail "full 압축"

# 2. 개발 작업 폴더
cd $HOME && tar -czf $BK/devhome_$T.tar.gz --warning=no-file-changed \
  --exclude='sogaebank/*/node_modules' --exclude='kits/reh' --exclude='.env' --exclude='*.pem' --exclude='*.key' \
  sogaebank kits outputs inbox sgb-kit sgb-check.sh make-kit.sh import-kit.sh start-claude.sh step17.sh .bashrc .profile .gitconfig \
  || fail "devhome 압축"
n=$(tar -tzf $BK/devhome_$T.tar.gz | grep -cE '(^|/)\.env$|\.pem$|\.key$')
[ "$n" = 0 ] || { rm -f $BK/devhome_$T.tar.gz; fail "devhome 에 .env · 열쇠 $n 개 — 지움"; }

# 3. Claude 작업
W=$(mktemp -d -p $BK); O=$W/claude_work_$T; mkdir -p $O/scratchpad
SP=$(ls -td /tmp/claude-$(id -u)/$CP/*/scratchpad 2>/dev/null | head -1)
[ -n "$SP" ] && find $SP -maxdepth 1 -type f \( -name '*.sh' -o -name '*.py' -o -name '*.md' -o -name '*.sql' -o -name '*.txt' -o -name '*.json' \) -size -2M -exec cp {} $O/scratchpad/ \;
cd $HOME/.claude && tar -cf - --warning=no-file-changed $(ls -d CLAUDE.md settings.json history.jsonl skills file-history plugins projects 2>/dev/null) | tar -xf - -C $O/
cp $HOME/sogaebank/CLAUDE.md $O/project-CLAUDE.md
cd $W && tar -czf $BK/claude_work_$T.tar.gz claude_work_$T || fail "claude_work 압축"
cd $BK && rm -rf $W
n=$(tar -tzf $BK/claude_work_$T.tar.gz | grep -cE '\.claude\.json$|\.pem$|\.key$|(^|/)\.env$')
[ "$n" = 0 ] || { rm -f $BK/claude_work_$T.tar.gz; fail "claude_work 에 열쇠 $n 개 — 지움"; }

# 4. 대조 값 · 옛 벌 정리(최근 KEEP 벌만)
sha256sum full_$T.tar.gz devhome_$T.tar.gz claude_work_$T.tar.gz > SHA256SUMS_$T.txt
for old in $(ls -1 full_*.tar.gz | sed 's/^full_//; s/\.tar\.gz$//' | sort -r | tail -n +$((KEEP+1))); do
  rm -f full_$old.tar.gz devhome_$old.tar.gz claude_work_$old.tar.gz SHA256SUMS_$old.txt
done

size=$(du -ch full_$T.tar.gz devhome_$T.tar.gz claude_work_$T.tar.gz | tail -1 | cut -f1)
echo "$(date -u +%FT%TZ) 성공 $T $size$heads · 서버에 남은 벌 $(ls -1 full_*.tar.gz | wc -l)" | tee -a $LOG
