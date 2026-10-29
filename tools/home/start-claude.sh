#!/usr/bin/env bash
# 작업방이 있으면 들어가고, 없으면 저장소 4개를 최신화한 뒤 Claude를 원격 제어로 실행
if tmux has-session -t sgb 2>/dev/null; then
  tmux attach -t sgb
else
  echo 1000 > /proc/self/oom_score_adj 2>/dev/null   # 메모리 부족 시 운영 앱보다 먼저 꺼지게
  avail=$(free -m | awk '/^Mem:/ {print $7}')
  [ "${avail:-0}" -lt 400 ] && echo "[주의] 남은 메모리 ${avail}MB — 운영 서비스를 위해 잠시 뒤 다시 여는 것을 권합니다"
  cd ~/sogaebank
  for r in sgb-core sgb-adx sgb-infra sgb-docs; do
    (cd "$r" && git pull --ff-only -q) || echo "[확인 필요] $r 최신화 실패 (커밋 안 한 변경 확인)"
  done
  tmux new -s sgb -c ~/sogaebank "claude --remote-control '소개뱅크'; bash"
fi
