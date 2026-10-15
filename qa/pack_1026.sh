#!/bin/bash
# v10.26 포장 — 작업본을 그대로 옮겨 zip · tar.gz 두 개를 만들고, 두 묶음의 파일 목록 · 내용이 작업본과 같은지 봅니다.
set -uo pipefail
K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002; N=SGB_DevDocker_Integrated_20261002_v10_26; O=/mnt/user-data/outputs; S=/tmp/stage_1026
rm -rf $S; mkdir -p $S/$N
( cd $K && tar cf - --exclude=node_modules --exclude=.next --exclude=dist --exclude=__pycache__ --exclude=./sgb/uploads --exclude=tsconfig.tsbuildinfo --exclude='*.bak' --exclude=.env --exclude=./.git . ) | ( cd $S/$N && tar xf - )
rm -f $O/$N.zip $O/$N.tar.gz
( cd $S && zip -qr $O/$N.zip $N && tar czf $O/$N.tar.gz $N )
rm -rf /tmp/chk_zip /tmp/chk_tar; mkdir -p /tmp/chk_zip /tmp/chk_tar
( cd /tmp/chk_zip && unzip -q $O/$N.zip ); ( cd /tmp/chk_tar && tar xzf $O/$N.tar.gz )
a=$(cd $S/$N && find . -type f | sort | wc -l); b=$(cd /tmp/chk_zip/$N && find . -type f | sort | wc -l); c=$(cd /tmp/chk_tar/$N && find . -type f | sort | wc -l)
d1=$(diff -rq $S/$N /tmp/chk_zip/$N | wc -l); d2=$(diff -rq $S/$N /tmp/chk_tar/$N | wc -l)
x1=$(cd /tmp/chk_zip/$N && find . -type f -perm -u+x | sort | md5sum | cut -c1-8); x2=$(cd /tmp/chk_tar/$N && find . -type f -perm -u+x | sort | md5sum | cut -c1-8); x0=$(cd $S/$N && find . -type f -perm -u+x | sort | md5sum | cut -c1-8)
echo "파일 수 — 작업본 $a · zip $b · tar $c | 내용 다른 것 — zip $d1 · tar $d2 | 실행 권한 목록 — $x0 $x1 $x2"
ls -l $O/$N.zip $O/$N.tar.gz | awk '{printf "%s %.1fMiB %s\n", $5, $5/1048576, $9}'
( cd /tmp/chk_zip/$N && ls ; cat sgb/VERSION; ls sgb/prisma/migrations | wc -l; ls sgb/deploy/aws | wc -l; ls -l dev.sh sgb/deploy/aws/apply.sh | awk '{print $1, $9}'; head -c 3 dev.ps1 | od -An -tx1 )
# 비밀 값 · git 기록이 들어가지 않았는지
( cd /tmp/chk_zip/$N && echo ".env 파일 $(find . -name '.env' | wc -l)개 · .git 폴더 $(find . -name .git -type d | wc -l)개" )
