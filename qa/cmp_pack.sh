#!/bin/bash
# 첫 묶음(리허설에 쓴 것)과 마지막 묶음을 풀어 견줍니다 — 바뀐 파일 · 더해진 파일 · 없어진 파일. 사용: bash cmp_pack.sh 첫.zip 마지막.zip
A=/tmp/cmp_a; B=/tmp/cmp_b; rm -rf $A $B; mkdir -p $A $B
( cd $A && unzip -q "$1" ); ( cd $B && unzip -q "$2" )
a=$(ls $A); b=$(ls $B)
diff -rq $A/$a $B/$b > /tmp/cmp_pack.txt
echo "바뀐 파일 $(grep -c '^Files ' /tmp/cmp_pack.txt) · 더해진 파일 $(grep "^Only in $B" /tmp/cmp_pack.txt | while read -r _ _ d f; do p="${d%:}/$f"; if [ -d "$p" ]; then find "$p" -type f | wc -l; else echo 1; fi; done | paste -sd+ | bc) · 없어진 파일 $(grep -c "^Only in $A" /tmp/cmp_pack.txt)"
grep '^Files ' /tmp/cmp_pack.txt | sed "s#$A/$a/##; s# and .*##; s#^Files #  바뀜: #"
grep "^Only in $B" /tmp/cmp_pack.txt | sed "s#Only in $B/$b#  더해짐: #; s#: #/#" | head -20
echo "코드 쪽(sgb/src · sgb/site · sgb/web · sgb/prisma · sgb/deploy · sgb/scripts · sgb/spec · docker) 에서 다른 것: $(grep -E "/sgb/(src|site|web|prisma|deploy|scripts|spec)|/docker|/sgb-ads" /tmp/cmp_pack.txt | wc -l)"
