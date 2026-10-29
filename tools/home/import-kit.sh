#!/usr/bin/env bash
# 최종본 kit을 CodeCommit 저장소 3개에 올림
#   빈 저장소 → main 에 첫 커밋 / 내용이 있는 저장소 → import/kit-버전 갈래에만
set -u
command -v rsync >/dev/null || { echo "rsync 없음: ssh sgb-ops 에서 sudo apt-get install -y rsync 후 다시 실행"; exit 1; }
K=~/sgb-kit
V=$(tr -d '[:space:]' < "$K/sgb/VERSION")
EX=(--exclude .git --exclude node_modules --exclude .env --exclude '*.pem' --exclude '*.key' --exclude dist --exclude .next)
defbr(){ git ls-remote --symref origin HEAD 2>/dev/null | sed -n 's@^ref: refs/heads/\([^[:space:]]*\).*@\1@p'; }
declare -A BR
prep(){ cd ~/sogaebank/"$1" || exit 1; git fetch -q origin 2>/dev/null; B=""; git ls-remote --exit-code --heads origin >/dev/null 2>&1 && B=$(defbr)
  if [ -z "$B" ]; then BR[$1]=main; git symbolic-ref HEAD refs/heads/main
  else BR[$1]="import/kit-$V"
    if git ls-remote --exit-code --heads origin "${BR[$1]}" >/dev/null 2>&1; then git checkout -q -B "${BR[$1]}" "origin/${BR[$1]}"
    else git checkout -q -B "${BR[$1]}" "origin/$B"; fi
  fi
  echo; echo "===== $1  → ${BR[$1]}  (기준: ${B:-빈 저장소})"; }
gone(){ rsync -a --delete --dry-run --itemize-changes "${EX[@]}" "$1" "$2" 2>/dev/null | sed -n 's/^\*deleting */   [kit에 없음 - 그대로 둠] /p' | head -20; }
prep sgb-core;  gone "$K/sgb/" ./;     rsync -a "${EX[@]}" "$K/sgb/" ./
prep sgb-adx;   gone "$K/sgb-ads/" ./; rsync -a "${EX[@]}" "$K/sgb-ads/" ./
prep sgb-infra
for d in docker qa; do mkdir -p "$d"; gone "$K/$d/" "./$d/"; rsync -a "${EX[@]}" "$K/$d/" "./$d/"; done
for f in docker-compose.yml dev.sh dev.ps1 .env.example; do cp -p "$K/$f" ./; done
if [ -f README.md ] && ! cmp -s README.md "$K/README.md"; then cp -p "$K/README.md" ./KIT_README.md; else cp -p "$K/README.md" ./; fi
touch .gitignore; while IFS= read -r l; do [ -n "$l" ] && { grep -qxF "$l" .gitignore || echo "$l" >> .gitignore; }; done < "$K/.gitignore"
for p in /sgb /sgb-ads; do grep -qxF "$p" .gitignore || echo "$p" >> .gitignore; done
for r in sgb-core sgb-adx sgb-infra; do
  cd ~/sogaebank/$r
  grep -qx '.env' .gitignore 2>/dev/null || echo '.env' >> .gitignore
  git add -A
  if git diff --cached --name-only | grep -Eq '(^|/)\.env$|(^|/)\.env\.(local|prod|production)$|\.pem$|\.key$|id_rsa'; then
    echo "[중단] $r : 비밀 파일 포함 - 올리지 않음"; git reset -q; continue; fi
  if git diff --cached | grep -E 'AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY' | grep -v 'AKIAIOSFODNN7EXAMPLE' | grep -q .; then
    echo "[중단] $r : 키 문자열 포함 - 올리지 않음"; git reset -q; continue; fi
  if git diff --cached --quiet; then echo "[변경 없음] $r"; continue; fi
  echo "[$r] $(git diff --cached --shortstat)"
  git commit -q -m "import: 소개뱅크 최종본 kit $V 가져오기" && git push -q -u origin "${BR[$r]}" && echo "[올림] $r → ${BR[$r]}"
done
