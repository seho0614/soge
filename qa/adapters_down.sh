#!/bin/bash
for f in /tmp/adp_*.pid; do [ -f "$f" ] && { pkill -P $(cat $f) 2>/dev/null; kill $(cat $f) 2>/dev/null; rm -f "$f"; }; done; echo adapters down
