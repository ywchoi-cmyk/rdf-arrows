#!/usr/bin/env bash
# 브라우저 테스트 전체 실행: tests/run_all.sh [결과 폴더]
# 필요: python3, playwright, rdflib, owlrl, 크롬 (CHROME 환경변수로 경로 지정 가능)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-/tmp/rdf-arrows-test}"; mkdir -p "$OUT"
fail=0
for t in "$ROOT"/tests/test_*.py; do
  name="$(basename "$t" .py)"; printf '%-14s ' "$name"
  if timeout 300 python3 -I "$t" "$ROOT" "$OUT" > "$OUT/$name.log" 2>&1 && tail -1 "$OUT/$name.log" | grep -q "ALL OK"; then echo "OK"
  else echo "실패 (로그: $OUT/$name.log)"; fail=1; fi
done
exit $fail
