#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Anvil well-known test accounts ───────────────────────────────────────────
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export ADMIN_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# Account 1 — paymaster sponsor signer
export SPONSOR_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export SPONSOR_SIGNER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8

# Account 2 — ZK oracle (address only, no signing needed for local dev)
export ZK_ORACLE_ADDRESS=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC

export ADI_RPC_URL=http://127.0.0.1:8545
export CHAIN_ID=31337

# ── Helpers ───────────────────────────────────────────────────────────────────
run_phase() {
  local label="$1"
  local script="$2"
  echo ""
  echo "========================================"
  echo " $label"
  echo "========================================"
  local out
  out=$(cd "$ROOT/packages/foundry" && forge script "$script" \
    --rpc-url http://127.0.0.1:8545 \
    --broadcast 2>&1)
  echo "$out"
  # Parse and export any `export VAR=address` lines printed by the script
  # Trim leading whitespace before matching (forge indents console.log output)
  while IFS= read -r line; do
    trimmed="${line#"${line%%[! ]*}"}"
    if [[ "$trimmed" == export\ *=* ]]; then
      eval "$trimmed"
    fi
  done <<< "$out"
}

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$ANVIL_PID" 2>/dev/null || true
  kill "$NEXT_PID"  2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# ── 1. Start Anvil ────────────────────────────────────────────────────────────
# Kill any existing Anvil on port 8545
if lsof -ti :8545 &>/dev/null; then
  echo "Killing existing process on port 8545..."
  kill "$(lsof -ti :8545)" 2>/dev/null || true
  sleep 1
fi

echo "Starting Anvil on port 8545..."
anvil --port 8545 --accounts 10 --balance 10000 &
ANVIL_PID=$!

# Wait until Anvil is accepting connections
for i in $(seq 1 20); do
  if cast block-number --rpc-url http://127.0.0.1:8545 &>/dev/null; then
    echo "Anvil is ready."
    break
  fi
  sleep 0.5
done

# ── 2. Deploy all contract phases ─────────────────────────────────────────────
run_phase "Phase 01 — Identity Layer"   "script/01_DeployIdentity.s.sol"
run_phase "Phase 02 — Asset Layer"      "script/02_DeployAssetLayer.s.sol"
run_phase "Phase 03 — Vault"            "script/03_DeployVault.s.sol"
run_phase "Phase 04 — AA Stack"         "script/04_DeployAA.s.sol"
run_phase "Phase 05 — Merchant"         "script/05_DeployMerchant.s.sol"
run_phase "Phase 06 — Configure"        "script/06_Configure.s.sol"

# ── 3. Write frontend .env.local ─────────────────────────────────────────────
ENV_FILE="$ROOT/packages/nextjs/.env.local"
cat > "$ENV_FILE" <<EOF
NEXT_PUBLIC_ORCHESTRATOR_ADDRESS=$ORCHESTRATOR_ADDRESS
NEXT_PUBLIC_VAULT_ADDRESS=$VAULT_ADDRESS
NEXT_PUBLIC_DDSC_ADDRESS=$DDSC_ADDRESS
NEXT_PUBLIC_MADI_ADDRESS=$MADI_ADDRESS
NEXT_PUBLIC_ORACLE_ADDRESS=$PRICE_ORACLE_ADDRESS
NEXT_PUBLIC_ROUTER_ADDRESS=$PAY_ROUTER_ADDRESS
EOF
echo ""
echo "Written $ENV_FILE"

# ── 4. Start Next.js ──────────────────────────────────────────────────────────
echo ""
echo "Starting Next.js on http://localhost:3000 ..."
cd "$ROOT" && yarn workspace @adi/nextjs dev &
NEXT_PID=$!

echo ""
echo "All services running. Press Ctrl+C to stop."
wait
