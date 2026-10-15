#!/bin/bash
# v10.31 포장 — 작업본을 옮겨 zip · tar.gz 두 개를 만들고, 두 묶음의 파일 목록 · 내용이 옮긴 것과 같은지 봅니다.
#   10/9 지시 「zip/tar 에 문서는 필수 문서만」 · 답 「설계 · 절차 + 이번 판」 (v10.29 의 pack_1029.sh 와 같은 규칙):
#     넣음 — 설계 · 정의서(00 ~ 33) · 통합 매트릭스(39 · matrix/) · 설치 · 배포 · 오픈 · AWS 적용 · 결제 확인 절차(25 · 26 · 31 · 60 · 62) · 바탕 판(78 — v10.29 · 글만) · 이번 판(79)
#            문서 목록 · 인수인계 · 접속 정보(개발용) · 로컬 테스트 · AWS 구축 절차 · 결정 기록(D005 · D019) · 스크립트가 읽는 폴더(terms · design · matrix · openapi)
#            시험 도구(qa/*.py · *.sh) · 이번 판 시험 결과(qa/results_v10_36)
#     뺌   — 묶음 크기 한도(30MiB) 때문에:
#            · v10.29 의 대조표(78_시안반영_대조표 … .html · 5.9MB) · v10.29 시험 결과(qa/results_v10_29) · v10.27 그림(qa/g137) — 모두 v10.29 묶음에 그대로 있습니다
#            · 받은 그림 원본(sgb/docs/design/money_main_20261009.webp · 3.3MB) — 따로 드립니다. 넣어 두면 대조 도구가 원본으로 직접 견주고, 없으면 적어 둔 지문 · 잰 값으로 견줍니다
#            · 다시 만들 수 있는 것(qa/money_cut — python3 qa/cut_money.py) · 견줌용 옛 시안(qa/_proto_v1028_base.html — v10.28 · v10.29 묶음의 SGB_Prototype_v10_28.html 과 같은 파일) · 로그 · 화면 그림
#     시안에 그림 53장이 들어가 시안 한 벌이 2.9MB 커졌습니다(킷에는 세 벌).
set -uo pipefail
K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002; N=SGB_DevDocker_Integrated_20261002_v10_36; O=${O:-/mnt/user-data/outputs}; S=${STAGE:-/tmp/stage_1036}; T=${CHK:-/tmp}
mkdir -p $O; rm -rf $S; mkdir -p $S/$N
( cd $K && tar cf - --exclude=node_modules --exclude=.next --exclude=dist --exclude=__pycache__ --exclude=./sgb/uploads --exclude=tsconfig.tsbuildinfo --exclude='*.bak' --exclude=.env --exclude=./.git . ) | ( cd $S/$N && tar xf - )

# ── 뺄 것 ──
DD=$S/$N/sgb/docs; OUTL=$DD/00_묶음에서_뺀_문서.txt
: > $T/dropped_1036.txt
drop() { [ -e "$S/$N/$1" ] && { echo "$1" >> $T/dropped_1036.txt; rm -rf "$S/$N/$1"; }; }
drop "sgb/docs/78_시안반영_대조표_v10.29_20261009.html"
drop "sgb/docs/design/money_main_20261009.webp"
drop "qa/g137"
# v10.31 — PC 로 옮길 때 파일 하나 30MB 한도: 최상위 시안 사본은 묶음 밖(같은 폴더의 SGB_Prototype_v10_31.html)으로 — 킷 안 sgb/site/public/proto · sgb/spec/proto.html 은 같은 파일
drop "SGB_Prototype_v10_36.html"
# v10.36 — 시안 SGB_Prototype_v10_36.html(내용은 v10.33 과 같음 · 제목 줄) · v10.35 결과(qa/results_v10_35)는 v10.35 묶음에 — 킷 안 sgb/spec/proto.html · sgb/site/public/proto/ 두 벌 · v10.32 대조표는 킷 밖
# v10.31.1 — 디자인 원본 그림 3장은 킷 밖 「디자인 원본 묶음」(SGB_Design_Originals_20261011.zip)으로 — 검사는 qa/design_fingerprints.json 지문으로(sgb/docs/design/README_디자인원본.md)
drop "sgb/docs/design/plaza_design_20261007.png"
drop "sgb/docs/design/mall_design_from_chat_89332263.jpeg"
drop "sgb/spec/design/hero_page_20261002.png"
for d in $(cd $S/$N/qa && ls -d results_v10_* 2>/dev/null | grep -v -E '^results_v10_3[46]$'); do drop "qa/$d"; done
for f in $(cd $DD && ls -1); do
  case "$f" in
    3[4-8]_*|4[0-9]_*|5[0-9]_*|61_*|6[3-9]_*|7[0-7]_*) drop "sgb/docs/$f" ;;
    SGB_Matrix_Verification_*.xlsx) drop "sgb/docs/$f" ;;
  esac
done
rm -rf $S/$N/qa/money_cut $S/$N/qa/_proto_v10*_base.html
{ echo "# v10.36 묶음에서 뺀 것 — 묶음 크기 한도(30MiB) · 10/9 「zip/tar 에 문서는 필수 문서만」(설계 · 절차 + 이번 판)."
  echo "#   · 78 대조표 · results_v10_29 · g137 → v10.29 묶음(SGB_DevDocker_Integrated_20261002_v10_29.zip · tar.gz)에 그대로 있습니다."
  echo "#   · v10.31 ~ v10.33 시험 결과(qa/results_v10_31 ~ 33) → 각 판 묶음에 그대로 있습니다. (v10.36 은 v10.34 바탕의 작은 고침이라 v10.34 전수 검정 결과 qa/results_v10_34 도 함께 넣습니다 · v10.35 결과는 v10.35 묶음에)"
  echo "#   · money_main_20261009.webp(받은 그림 원본) → 따로 드린 파일입니다. sgb/docs/design/ 에 넣으면 qa/cut_money.py --check · qa/measure_mny.py 가 원본으로 직접 견줍니다."
  cat $T/dropped_1036.txt
  echo
  echo "# ── 아래는 v10.29 묶음을 만들 때 적은 목록 그대로입니다 ──"
  [ -f "$K/sgb/docs/00_묶음에서_뺀_문서.txt" ] && grep -v '^# v10.3[12] \|^#   · \|^# ── 아래는' "$K/sgb/docs/00_묶음에서_뺀_문서.txt" | awk 'f||!/^$/{f=1;print}'; } > "$OUTL.new"
mv "$OUTL.new" "$OUTL"
echo "뺀 것 $(wc -l < $T/dropped_1036.txt)개 · 남은 docs $(ls $DD | wc -l)개"

rm -f $O/$N.zip $O/$N.tar.gz
( cd $S && zip -q -9 -r $O/$N.zip $N && tar cf - $N | gzip -9 > $O/$N.tar.gz )
rm -rf $T/chk_zip $T/chk_tar; mkdir -p $T/chk_zip $T/chk_tar
( cd $T/chk_zip && unzip -q $O/$N.zip ); ( cd $T/chk_tar && tar xzf $O/$N.tar.gz )
a=$(cd $S/$N && find . -type f | sort | wc -l); b=$(cd $T/chk_zip/$N && find . -type f | sort | wc -l); c=$(cd $T/chk_tar/$N && find . -type f | sort | wc -l)
d1=$(diff -rq $S/$N $T/chk_zip/$N | wc -l); d2=$(diff -rq $S/$N $T/chk_tar/$N | wc -l)
x1=$(cd $T/chk_zip/$N && find . -type f -perm -u+x | sort | md5sum | cut -c1-8); x2=$(cd $T/chk_tar/$N && find . -type f -perm -u+x | sort | md5sum | cut -c1-8); x0=$(cd $S/$N && find . -type f -perm -u+x | sort | md5sum | cut -c1-8)
echo "파일 수 — 옮긴 것 $a · zip $b · tar $c | 내용 다른 것 — zip $d1 · tar $d2 | 실행 권한 목록 — $x0 $x1 $x2"
ls -l $O/$N.zip $O/$N.tar.gz | awk '{printf "%s바이트 %.2fMiB %s %s\n", $5, $5/1048576, ($5 <= 31457280 ? "(한도 30MiB 안)" : "!! 한도 30MiB 넘음"), $9}'
( cd $T/chk_zip/$N && ls ; cat sgb/VERSION; echo "마이그레이션 $(ls sgb/prisma/migrations | wc -l) · aws $(ls sgb/deploy/aws | wc -l)"; ls -l dev.sh sgb/deploy/aws/apply.sh | awk '{print $1, $9}'; head -c 3 dev.ps1 | od -An -tx1; md5sum sgb/spec/proto.html sgb/site/public/proto/SGB_Prototype_v10_36.html | cut -c1-12 | tr '\n' ' '; echo )
# 스크립트가 읽는 문서 · 폴더가 남았는지(빼면 검정 · 약관 발행이 깨짐)
( cd $T/chk_zip/$N/sgb/docs && for f in 06_openapi.json _swagger_from_code.json 39_통합매트릭스.md matrix terms design design/README_디자인원본.md 60_로컬점검_AWS적용절차_v10.16_20261003.md 62_결제환불정합_v10.18_20261006.md 78_시안디자인반영_검색_v10.29_20261009.md 79_소개장터메인_제시디자인적용_v10.30_20261009.md 80_시안기준반영_v10.31_20261010.md 81_시안대로고칠것반영_v10.32_20261011.md 82_정액노출부가세_기간연장_분쟁권한_v10.33_20261011.md 83_전자세금계산서_수화오류_개발DB_v10.34_20261012.md 84_로컬점검_AWS적용절차_v10.35_20261012.md 85_소개장터개인등록_첫화면저장_v10.36_20261012.md 전자세금계산서_연동절차.md; do [ -e "$f" ] || echo "!! 없음 $f"; done; echo "필수 문서 확인 끝" )
( cd $T/chk_zip/$N/qa && for f in cut_money.py money_assets.json measure_mny.py measure_mny_design.json shot_mny.py site_mny.py proto_mny.py test_v1032_two.py ui_adm_v1032.py test_v1033_directory.py test_v1034_etax.py aws_rehearsal.py aws_rehearsal.sh test_v1036.py results_v10_34 results_v10_36; do [ -e "$f" ] || echo "!! 없음 qa/$f"; done; echo "이번 판 도구 확인 끝" )
# 비밀 값 · git 기록이 들어가지 않았는지
( cd $T/chk_zip/$N && echo ".env 파일 $(find . -name '.env' | wc -l)개 · .git 폴더 $(find . -name .git -type d | wc -l)개" )
