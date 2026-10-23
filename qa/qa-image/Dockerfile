# 기능 점검 시험 이미지 (v10.73) — qa/func_check.sh 가 sgb-qa:v1 로 만들어 씀
#   Playwright 이미지에는 파이썬 playwright 묶음이 없어 같은 판으로 넣고, 시험이 DB 를 보려고 psql · 결과 표용 openpyxl 을 넣습니다.
FROM mcr.microsoft.com/playwright/python:v1.49.1-noble
RUN pip3 install -q --break-system-packages playwright==1.49.1 openpyxl==3.1.5 \
 && apt-get update -qq && apt-get install -y -qq postgresql-client >/dev/null && rm -rf /var/lib/apt/lists/*
