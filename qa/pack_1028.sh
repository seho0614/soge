#!/bin/bash
# v10.28 포장 — 작업본을 옮겨 zip · tar.gz 두 개를 만들고, 두 묶음의 파일 목록 · 내용이 옮긴 것과 같은지 봅니다.
#   10/9 지시 「zip/tar 에 문서는 필수 문서만」 · 답 「설계 · 절차 + 이번 판」:
#     넣음 — 설계 · 정의서(00 ~ 33) · 통합 매트릭스(39 · matrix/) · 설치 · 배포 · 오픈 · AWS 적용 · 결제 확인 절차(25 · 26 · 31 · 60 · 62) · 이번 판(77)
#            문서 목록 · 인수인계 · 접속 정보(개발용) · 로컬 테스트 · AWS 구축 절차 · 결정 기록(D005 · D019) · 스크립트가 읽는 폴더(terms · design · matrix · openapi)
#            시험 도구(qa/*.py · *.sh) · 이번 판 시험 결과(qa/results_v10_28)
#     뺌   — 판별 결과 보고서(34 ~ 38 · 40 ~ 59 · 61 · 63 ~ 76) · 옛 그림(57 · 58 png) · 옛 엑셀 · 지난 판 시험 결과(qa/results_v10_16 ~ 27)
#     뺀 문서는 git(v10.28 태그)에는 그대로 있습니다.
set -uo pipefail
K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002; N=SGB_DevDocker_Integrated_20261002_v10_28; O=/mnt/user-data/outputs; S=/tmp/stage_1028
rm -rf $S; mkdir -p $S/$N
( cd $K && tar cf - --exclude=node_modules --exclude=.next --exclude=dist --exclude=__pycache__ --exclude=./sgb/uploads --exclude=tsconfig.tsbuildinfo --exclude='*.bak' --exclude=.env --exclude=./.git . ) | ( cd $S/$N && tar xf - )

# ── 문서는 필수 문서만 ──
DD=$S/$N/sgb/docs; OUTL=$S/$N/sgb/docs/00_묶음에서_뺀_문서.txt
: > /tmp/dropped_1028.txt
for f in $(cd $DD && ls -1); do
  case "$f" in
    3[4-8]_*|4[0-9]_*|5[0-9]_*|61_*|6[3-9]_*|7[0-6]_*) echo "sgb/docs/$f" >> /tmp/dropped_1028.txt; rm -rf "$DD/$f" ;;
    SGB_Matrix_Verification_*.xlsx) echo "sgb/docs/$f" >> /tmp/dropped_1028.txt; rm -f "$DD/$f" ;;
  esac
done
for d in $(cd $S/$N/qa && ls -d results_v10_* 2>/dev/null | grep -v '^results_v10_28$'); do echo "qa/$d/" >> /tmp/dropped_1028.txt; rm -rf "$S/$N/qa/$d"; done
{ echo "# v10.28 묶음에서 뺀 문서 — 10/9 「zip/tar 에 문서는 필수 문서만」(설계 · 절차 + 이번 판). 모두 git(v10.28 태그)에 있습니다."
  echo "#   보는 법: git show v10.28:<경로>   또는   git checkout v10.28 -- <경로>"
  cat /tmp/dropped_1028.txt; } > "$OUTL"
echo "뺀 문서 $(wc -l < /tmp/dropped_1028.txt)개 · 남은 docs $(ls $DD | wc -l)개"

rm -f $O/$N.zip $O/$N.tar.gz
( cd $S && zip -qr $O/$N.zip $N && tar czf $O/$N.tar.gz $N )
rm -rf /tmp/chk_zip /tmp/chk_tar; mkdir -p /tmp/chk_zip /tmp/chk_tar
( cd /tmp/chk_zip && unzip -q $O/$N.zip ); ( cd /tmp/chk_tar && tar xzf $O/$N.tar.gz )
a=$(cd $S/$N && find . -type f | sort | wc -l); b=$(cd /tmp/chk_zip/$N && find . -type f | sort | wc -l); c=$(cd /tmp/chk_tar/$N && find . -type f | sort | wc -l)
d1=$(diff -rq $S/$N /tmp/chk_zip/$N | wc -l); d2=$(diff -rq $S/$N /tmp/chk_tar/$N | wc -l)
x1=$(cd /tmp/chk_zip/$N && find . -type f -perm -u+x | sort | md5sum | cut -c1-8); x2=$(cd /tmp/chk_tar/$N && find . -type f -perm -u+x | sort | md5sum | cut -c1-8); x0=$(cd $S/$N && find . -type f -perm -u+x | sort | md5sum | cut -c1-8)
echo "파일 수 — 옮긴 것 $a · zip $b · tar $c | 내용 다른 것 — zip $d1 · tar $d2 | 실행 권한 목록 — $x0 $x1 $x2"
ls -l $O/$N.zip $O/$N.tar.gz | awk '{printf "%s %.1fMiB %s\n", $5, $5/1048576, $9}'
( cd /tmp/chk_zip/$N && ls ; cat sgb/VERSION; ls sgb/prisma/migrations | wc -l; ls sgb/deploy/aws | wc -l; ls -l dev.sh sgb/deploy/aws/apply.sh | awk '{print $1, $9}'; head -c 3 dev.ps1 | od -An -tx1 )
# 스크립트가 읽는 문서 · 폴더가 남았는지(빼면 검정 · 약관 발행이 깨짐)
( cd /tmp/chk_zip/$N/sgb/docs && for f in 06_openapi.json _swagger_from_code.json 39_통합매트릭스.md matrix terms design 60_로컬점검_AWS적용절차_v10.16_20261003.md 62_결제환불정합_v10.18_20261006.md 77_소개몰배송_구매확정_리뷰문의_약관한벌_재동의_개인정산_v10.28_20261009.md; do [ -e "$f" ] || echo "!! 없음 $f"; done; echo "필수 문서 확인 끝" )
# 비밀 값 · git 기록이 들어가지 않았는지
( cd /tmp/chk_zip/$N && echo ".env 파일 $(find . -name '.env' | wc -l)개 · .git 폴더 $(find . -name .git -type d | wc -l)개" )
