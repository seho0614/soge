#!/bin/bash
# 작업본(킷)을 Docker 시험 폴더(/tmp/dock_kit)로 옮깁니다 — .env · 시험 환경 전용 override · 결과 파일은 그대로 둡니다.
K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002; D=/tmp/dock_kit
mkdir -p $D
find $D -mindepth 1 -maxdepth 1 ! -name .env ! -name docker-compose.override.yml ! -name 'realcheck_*.txt' -exec rm -rf {} +
( cd $K && tar cf - --exclude=node_modules --exclude=.next --exclude=dist --exclude=__pycache__ --exclude=./sgb/uploads --exclude=tsconfig.tsbuildinfo --exclude='*.bak' --exclude=.env --exclude=./.git . ) | ( cd $D && tar xf - )
[ -f $D/.env ] || cp /tmp/dock_env.keep $D/.env
[ -f $D/docker-compose.override.yml ] || cp /tmp/dock_override.keep $D/docker-compose.override.yml
echo "synced: $(ls $D | tr '\n' ' ')"
