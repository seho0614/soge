#!/bin/bash
# CodeCommit 저장소 4개 → GitHub seho0614/soge 한 저장소 (sgb-core docs/223 0절)
# 갈래는 저장소 이름을 앞에 붙여 보냄: sgb-core/main · sgb-docs/feature/… — 강제(--force) · 지우기(--prune) 쓰지 않음
# 예약: 매일 03:30 KST (crontab 30 18 * * *) · 결과 한 줄 ~/backup/github-last.txt
set -u
export PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
GH=gh-soge:seho0614/soge.git
M=$HOME/mirror
LOG=$HOME/backup/github-last.txt
mkdir -p $M $HOME/backup
exec 9>$M/.lock
flock -n 9 || { echo "$(date -u +%FT%TZ) 건너뜀 — 앞의 보내기가 아직 도는 중" >> $LOG; exit 0; }

rc=0; out=""
for r in sgb-core sgb-infra sgb-adx sgb-docs; do
  [ -d $M/$r.git ] || git clone -q --mirror codecommit::ap-northeast-2://$r $M/$r.git
  if ! git -C $M/$r.git fetch -q --prune origin; then
    out="$out $r=받기실패"; rc=1; continue
  fi
  if git -C $M/$r.git push -q $GH "refs/heads/*:refs/heads/$r/*" "refs/tags/*:refs/tags/$r/*" 2>$M/$r.err; then
    out="$out $r=$(git -C $M/$r.git rev-parse --short refs/heads/main)"
  else
    out="$out $r=보내기실패($(head -c 120 $M/$r.err | tr '\n' ' '))"; rc=1
  fi
done
echo "$(date -u +%FT%TZ) rc=$rc$out" | tee -a $LOG
exit $rc
