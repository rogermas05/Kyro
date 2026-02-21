#!/usr/bin/env bash
# deploy-testnet.sh — Deploy all Kyro contracts to ADI testnet and write .env.local
#
# Required env vars (set before running, or place in packages/foundry/.env):
#   PRIVATE_KEY        — Funded testnet deployer private key (0x...)
#   ORACLE_PRIVATE_KEY — Oracle signing key; its derived address becomes ZK_ORACLE_ADDRESS
#
# Optional:
#   SPONSOR_SIGNER_ADDRESS — Paymaster sponsor signer (defaults to deployer address)
#   PAYMASTER_DEPOSIT_ETH  — Initial paymaster deposit in wei (default: 0.1 ether = 100000000000000000)
#
# Usage:
#   export PRIVATE_KEY=0x...
#   export ORACLE_PRIVATE_KEY=0x...
#   bash scripts/deploy-testnet.sh

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC_URL="https://rpc.ab.testnet.adifoundation.ai/"

# ── Load .env from foundry dir if present ─────────────────────────────────────
FOUNDRY_ENV="$ROOT/packages/foundry/.env"
if [[ -f "$FOUNDRY_ENV" ]]; then
  echo "Loading env from $FOUNDRY_ENV"
  set -a
  # shellcheck disable=SC1090
  source "$FOUNDRY_ENV"
  set +a
fi

# ── Validate required keys ─────────────────────────────────────────────────────
if [[ -z "$PRIVATE_KEY" ]]; then
  echo "ERROR: PRIVATE_KEY is not set. Export it or add it to packages/foundry/.env"
  exit 1
fi

# Ensure keys have 0x prefix
[[ "$PRIVATE_KEY" != 0x* ]] && PRIVATE_KEY="0x$PRIVATE_KEY"

# Default oracle key to deployer key for testing
if [[ -z "$ORACLE_PRIVATE_KEY" ]]; then
  ORACLE_PRIVATE_KEY="$PRIVATE_KEY"
  echo "ORACLE_PRIVATE_KEY not set — using deployer key as oracle (fine for testing)"
else
  [[ "$ORACLE_PRIVATE_KEY" != 0x* ]] && ORACLE_PRIVATE_KEY="0x$ORACLE_PRIVATE_KEY"
fi

# ── Derive addresses from keys ─────────────────────────────────────────────────
export ZK_ORACLE_ADDRESS
ZK_ORACLE_ADDRESS=$(cast wallet address --private-key "$ORACLE_PRIVATE_KEY")
echo "Deployer:    $(cast wallet address --private-key "$PRIVATE_KEY")"
echo "ZK Oracle:   $ZK_ORACLE_ADDRESS"

# Default sponsor signer to deployer if not set
if [[ -z "$SPONSOR_SIGNER_ADDRESS" ]]; then
  export SPONSOR_SIGNER_ADDRESS
  SPONSOR_SIGNER_ADDRESS=$(cast wallet address --private-key "$PRIVATE_KEY")
  echo "Sponsor:     $SPONSOR_SIGNER_ADDRESS (defaulting to deployer)"
fi

export ADI_RPC_URL="$RPC_URL"
export CHAIN_ID=99999

# Skip paymaster native-token deposit (not needed for core invoice flow)
export PAYMASTER_DEPOSIT_ETH=0

# ── Helper: run one forge script, stream output, export address vars ───────────
run_phase() {
  local label="$1"
  local script="$2"
  local tmpfile
  tmpfile=$(mktemp)
  echo ""
  echo "========================================"
  echo " $label"
  echo "========================================"
  pushd "$ROOT/packages/foundry" > /dev/null
  forge script "$script" \
    --rpc-url "$RPC_URL" \
    --broadcast 2>&1 | tee "$tmpfile"
  local forge_exit=${PIPESTATUS[0]}
  popd > /dev/null
  if [[ $forge_exit -ne 0 ]]; then
    echo ""
    echo "ERROR: '$label' failed — see output above."
    rm -f "$tmpfile"
    exit 1
  fi
  # Parse and export any `export VAR=address` lines printed by the script
  while IFS= read -r line; do
    trimmed="${line#"${line%%[! ]*}"}"
    if [[ "$trimmed" == export\ *=* ]]; then
      eval "$trimmed"
    fi
  done < "$tmpfile"
  rm -f "$tmpfile"
}

# ── Deploy all phases ──────────────────────────────────────────────────────────
run_phase "Phase 01 — Identity Layer"   "script/01_DeployIdentity.s.sol"
run_phase "Phase 02 — Asset Layer"      "script/02_DeployAssetLayer.s.sol"
run_phase "Phase 03 — Vault"            "script/03_DeployVault.s.sol"
run_phase "Phase 04 — AA Stack"         "script/04_DeployAA.s.sol"
run_phase "Phase 05 — Merchant"         "script/05_DeployMerchant.s.sol"
run_phase "Phase 06 — Configure"        "script/06_Configure.s.sol"

# ── Write frontend .env.local ──────────────────────────────────────────────────
ENV_FILE="$ROOT/packages/nextjs/.env.local"
cat > "$ENV_FILE" <<EOF
# ── Network ───────────────────────────────────────────────────────────────────
NEXT_PUBLIC_USE_LOCAL=false

# ── Contract Addresses (ADI Testnet) ──────────────────────────────────────────
NEXT_PUBLIC_ORCHESTRATOR_ADDRESS=$ORCHESTRATOR_ADDRESS
NEXT_PUBLIC_VAULT_ADDRESS=$VAULT_ADDRESS
NEXT_PUBLIC_DDSC_ADDRESS=$DDSC_ADDRESS
NEXT_PUBLIC_MADI_ADDRESS=$MADI_ADDRESS
NEXT_PUBLIC_ORACLE_ADDRESS=$PRICE_ORACLE_ADDRESS
NEXT_PUBLIC_ROUTER_ADDRESS=$PAY_ROUTER_ADDRESS
NEXT_PUBLIC_JUNIOR_TOKEN_ADDRESS=$JUNIOR_TOKEN_ADDRESS
NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS=$IDENTITY_REGISTRY_ADDRESS

# ── Server-side keys ──────────────────────────────────────────────────────────
ORACLE_PRIVATE_KEY=$ORACLE_PRIVATE_KEY
FAUCET_PRIVATE_KEY=$PRIVATE_KEY
IDENTITY_REGISTRY_ADDRESS=$IDENTITY_REGISTRY_ADDRESS
EOF

echo ""
echo "========================================"
echo " Deployment complete!"
echo "========================================"
echo "Written: $ENV_FILE"
echo ""
echo "Start the frontend:"
echo "  yarn workspace @adi/nextjs dev"
