#!/bin/bash
# 작업 폴더(/home/claude/qa)의 시험 스크립트를 킷의 qa/ 로 옮깁니다 — **이름을 준 파일만**.
#   킷의 qa/ 에는 경로를 환경 값으로 바꾼 판이 들어 있는 파일이 있어(forms.py · capture.py 등) 「다른 것 전부」를 옮기면 그것을 덮어씁니다.
#   사용: bash qa_sync.sh srv_ptn.py build_xlsx.py ps_fake/fakecli …
Q=/home/claude/qa; K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/qa
n=0
for f in "$@"; do
  [ -f "$Q/$f" ] || { echo "없음 $f"; continue; }
  mkdir -p "$K/$(dirname "$f")"
  cmp -s "$Q/$f" "$K/$f" 2>/dev/null || { cp "$Q/$f" "$K/$f"; echo "옮김 $f"; n=$((n+1)); }
done
echo "qa 동기화 $n건"
