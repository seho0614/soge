#!/bin/bash
cd /home/claude/qa
bash site_up.sh > /tmp/site_up_1041.log 2>&1
curl -s -o /dev/null -w "proto %{http_code}\n" http://localhost:5174/proto/SGB_Prototype_v10_41.html >> /tmp/site_up_1041.log
bash run_1041.sh > /tmp/run_1041.out 2>&1
