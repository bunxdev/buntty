#!/bin/bash
# BUNTTY_URL / BT_TOKEN are read from the environment. JSON is built with bun (always present; jq isn't)
# so quotes/backslashes in the input can't break the payload.
set -euo pipefail
API="${BUNTTY_URL:-http://localhost:3000}/api"
AUTH=()
[ -z "${BT_TOKEN:-}" ] && [ -r "${BT_TOKEN_FILE:-}" ] && BT_TOKEN=$(<"$BT_TOKEN_FILE")
[ -n "${BT_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $BT_TOKEN")

send() {
  /root/.bun/bin/bun -e 'console.log(JSON.stringify({data: process.argv[1]}))' "$1" \
    | curl -s -X POST "${AUTH[@]}" "$API/input" -H "Content-Type: application/json" --data-binary @-
}

case "${1:-}" in
  status)       curl -s "${AUTH[@]}" "$API/status" ;;
  take-control) curl -s -X POST "${AUTH[@]}" "$API/take-control" ;;
  input)
    [ -z "${2:-}" ] && echo "Usage: $0 input <data>" && exit 1
    send "$2"
    ;;
  "") echo "Usage: $0 <command|status|take-control|input <data>>"; exit 1 ;;
  *)  send "$1"$'\n' ;;
esac
