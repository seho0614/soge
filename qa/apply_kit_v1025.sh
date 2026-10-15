#!/bin/bash
# v10.25 — 시안을 킷에 반영합니다(서버 · 실제 웹은 킷 작업본에서 바로 고쳤습니다 — 10/8 확정 뒤).
#   바탕은 킷의 v10.24 시안(_proto_v1024_base.html). 같은 도구(apply_proto_v1025.py)를 킷을 향해 돌리고 판 이름을 올립니다. 여러 번 돌려도 같습니다.
set -euo pipefail
K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002; Q=/home/claude/qa
cp $Q/_proto_ids_v1024_base.json $K/sgb/spec/proto_ids.json
BASE=$Q/_proto_v1024_base.html OUT=$K/sgb/spec/proto.html CSS=$K/sgb/site/src/styles/shop.css python3 $Q/apply_proto_v1025.py
python3 $Q/bump_1025.py
cmp -s /home/claude/pv1025/proto_v1025.html $K/sgb/spec/proto.html && echo "시안 = 미리보기 시안과 같은 파일" || echo "시안 ≠ 미리보기 시안"
md5sum $K/sgb/spec/proto.html $K/SGB_Prototype_v10_25.html $K/sgb/site/public/proto/SGB_Prototype_v10_25.html | cut -c1-33 | sort -u | wc -l
