#!/usr/bin/env bash
# =====================================================================
# DB 볼륨이 처음 만들어질 때 한 번만 돕니다 (postgres 이미지 규칙).
#
#   sgb        본체 — 화면에서 쓰는 개발 데이터
#   sgb_ads    광고 플랫폼 — 본체와 분리된 DB (FK 로 본체를 걸지 않음)
#   sgb_check  검정 전용 — fixture.sql 이 비우고 시작하므로 sgb 와 나눕니다
#
# ★ 검정을 sgb 에서 돌리면 화면에서 넣은 데이터가 전부 지워집니다.
# =====================================================================
set -euo pipefail
for db in sgb_ads sgb_check; do
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
    -c "CREATE DATABASE $db OWNER $POSTGRES_USER"
done
echo "initdb: sgb · sgb_ads · sgb_check 준비"
