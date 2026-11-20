#!/usr/bin/env bash
# 分片下载的真跑测试。
#
# ChunkPlan / ChunkedFetch 都不依赖 android.*，所以不需要模拟器：本地起一个
# HTTP 服务，把「支持 Range / 无视 Range / 302 / 限速 / 偶发 503」五种线路都
# 造一遍，用 md5 与并发峰值判定结果对不对。
#
#   bash scripts/test-chunked.sh
#
# 可选：再用真线路跑一整包（会真的下 20 MB）
#   bash scripts/test-chunked.sh --live
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ]; then
  JAVAC="$JAVA_HOME/bin/javac"
  JAVA="$JAVA_HOME/bin/java"
else
  JAVAC="$(command -v javac)"
  JAVA="$(command -v java)"
fi

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

"$JAVAC" -encoding UTF-8 -d "$OUT" \
  android/app/src/main/java/dev/zjkl/ghx/ChunkPlan.java \
  android/app/src/main/java/dev/zjkl/ghx/ChunkedFetch.java \
  android/test-jvm/dev/zjkl/ghx/ChunkTest.java

"$JAVA" -cp "$OUT" dev.zjkl.ghx.ChunkTest

if [ "${1:-}" = "--live" ]; then
  "$JAVAC" -encoding UTF-8 -d "$OUT" \
    android/app/src/main/java/dev/zjkl/ghx/ChunkPlan.java \
    android/app/src/main/java/dev/zjkl/ghx/ChunkedFetch.java \
    android/test-jvm/dev/zjkl/ghx/LiveFetch.java
  URL="https://gh.zjkl0330.dpdns.org/zjkl0330/ghx/releases/download/v0.9.0/ghx-0.9.0-debug.apk"
  echo
  echo "=== 真线路 · 4 路 ==="
  "$JAVA" -cp "$OUT" dev.zjkl.ghx.LiveFetch "$URL" "$OUT/a.part" 4
  echo
  echo "=== 真线路 · 单连接（对照） ==="
  "$JAVA" -cp "$OUT" dev.zjkl.ghx.LiveFetch "$URL" "$OUT/b.part" 1
  echo
  cmp "$OUT/a.part" "$OUT/b.part" && echo "cmp: 两种模式逐字节一致"
fi
