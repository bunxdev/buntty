# Shared helpers for lupa-* tools. Source it; don't run it.
# Every value that ends up in a JSON body or a JS snippet goes through jstr, so quotes,
# backslashes or newlines in page text / user args can't break out of the payload.
T="${LUPA_API_TOKEN:?set LUPA_API_TOKEN}"
L="${LUPA_URL:-http://127.0.0.1:3036}"
BUN="${BUN:-/root/.bun/bin/bun}"
H=(-H "Authorization: Bearer $T" -H "Content-Type: application/json")
jstr() { "$BUN" -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }
post() { local p="$1" d="$2"; shift 2; curl -s -X POST "${H[@]}" "$L/$p" --data-binary "$d" "$@"; }
ev()   { post "live/eval" "{\"script\":$(jstr "$1")}"; }
