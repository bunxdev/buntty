#!/bin/bash
API="http://localhost:3000/api"

case "$1" in
  status)       curl -s "$API/status" ;;
  take-control) curl -s -X POST "$API/take-control" ;;
  input)
    [ -z "$2" ] && echo "Usage: $0 input <data>" && exit 1
    curl -s -X POST "$API/input" -H "Content-Type: application/json" -d "{\"data\": \"$2\"}"
    ;;
  *)
    [ -z "$1" ] && echo "Usage: $0 <command|status|take-control>" && exit 1
    curl -s -X POST "$API/input" -H "Content-Type: application/json" -d "{\"data\": \"$(echo "$1" | sed 's/"/\\"/g')\n\"}"
    ;;
esac
