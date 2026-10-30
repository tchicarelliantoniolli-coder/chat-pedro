#!/bin/bash
# Roda os testes do Chat Pedro.
#   tests/run.sh            -> todos os testes de navegador + os de poker e truco
#   tests/run.sh 05 07      -> so os testes que comecam com esses numeros
#   tests/run.sh fuzz       -> so os testes de poker e truco (sem navegador)
# Cada teste de navegador sobe um Supabase falso (porta 3330) e o site (porta 3331) do zero,
# porque as contas criadas ficam guardadas enquanto o Supabase falso estiver ligado.
# As fotos de tela ficam em tests/out/. Precisa do Playwright com Chromium instalado.
cd "$(dirname "$0")/.." || exit 1
ROOT=$(pwd)
OUT="$ROOT/tests/out"
mkdir -p "$OUT"

FAKE_PID="" SITE_PID=""
stop() {
  [ -n "$SITE_PID" ] && kill "$SITE_PID" 2>/dev/null
  [ -n "$FAKE_PID" ] && kill "$FAKE_PID" 2>/dev/null
  wait 2>/dev/null
  FAKE_PID="" SITE_PID=""
}
trap stop EXIT

start() {
  stop
  node tests/fake-supabase.js 3330 > "$OUT/fake-supabase.log" 2>&1 &
  FAKE_PID=$!
  sleep 0.5
  EMBED_ALLOW_LOCAL=1 SUPABASE_URL=http://localhost:3330 SUPABASE_PUBLISHABLE_KEY=sb_publishable_teste \
    SUPABASE_SECRET_KEY=sb_secret_teste ADMIN_PASSWORD=senha-de-teste PORT=3331 node server.js > "$OUT/site.log" 2>&1 &
  SITE_PID=$!
  for _ in $(seq 1 30); do curl -s -o /dev/null http://localhost:3331/ && return 0; sleep 0.2; done
  echo "O site nao subiu. Veja $OUT/site.log"; return 1
}

FAILED=0
run_fuzz() {
  echo "== poker (4 e 9 jogadores)"
  timeout 120 node tests/fuzz-poker.js "$ROOT" 4 | tail -2
  timeout 120 node tests/fuzz-poker.js "$ROOT" 9 | tail -2
  echo "== truco (4 e 6 jogadores)"
  timeout 180 node tests/fuzz-truco.js "$ROOT" 4 20 | tail -3
  timeout 180 node tests/fuzz-truco.js "$ROOT" 6 20 | tail -3
}

WANT=("$@")
if [ ${#WANT[@]} -eq 1 ] && [ "${WANT[0]}" = "fuzz" ]; then run_fuzz; exit 0; fi

for t in tests/[0-9][0-9]-*.js; do
  name=$(basename "$t" .js)
  if [ ${#WANT[@]} -gt 0 ]; then
    hit=0; for w in "${WANT[@]}"; do [[ "$name" == "$w"* ]] && hit=1; done
    [ $hit -eq 0 ] && continue
  fi
  echo "== $name"
  start || { FAILED=1; continue; }
  out=$(timeout 300 node "$t" "$OUT" 2>&1)
  echo "$out" | grep -v "^OK"
  if echo "$out" | grep -qE "^(FALHA|ERRO)" || ! echo "$out" | grep -q "^erros: \[\]"; then FAILED=1; fi
done
stop

[ ${#WANT[@]} -eq 0 ] && run_fuzz
if [ $FAILED -eq 0 ]; then echo "TUDO OK"; else echo "TEM FALHA (veja acima)"; exit 1; fi
