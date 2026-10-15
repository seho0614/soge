#!/bin/bash
# v10.27 — G-130 · G-137 반영 뒤 시안 시험 다시(10/9)
cd /home/claude/qa
for t in proto_poll proto_bill proto_urg proto_detail proto_item proto_axis proto_lang; do timeout 1200 python3 $t.py > $t.log 2>&1; echo "$t (10/9 다시 · G-130 새 화면 7 · G-137 그림): $(tail -1 $t.log)" >> final_all_reruns_1027.txt; done
KIT=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb timeout 1200 python3 proto_fin.py > proto_fin.log 2>&1; echo "proto_fin (10/9 다시): $(tail -1 proto_fin.log)" >> final_all_reruns_1027.txt
timeout 1200 python3 proto_mall.py > proto_mall.log 2>&1; echo "proto_mall (10/9 다시 · 소개몰 22화면): $(tail -1 proto_mall.log)" >> final_all_reruns_1027.txt
timeout 1800 python3 sweep_proto.py > sweep_proto.log 2>&1; timeout 1800 python3 sweep_hlt_after.py > sweep_hlt.log 2>&1
echo "proto_report (10/9 다시 · 이미 열린 탭은 「지금 보고 있는」 안내): $(python3 build_proto_report.py 2>&1 | tail -2 | tr '\n' ' ' | cut -c1-220)" >> final_all_reruns_1027.txt
echo RERUN-D-DONE >> final_all_reruns_1027.txt
