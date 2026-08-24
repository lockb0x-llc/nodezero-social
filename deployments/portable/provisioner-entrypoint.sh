#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${HOME:-/var/lib/nodezero}/.nodezero-provisioner"
TOOLS_DIR="$STATE_DIR/tools"
STELLAR_URL="https://github.com/stellar/stellar-cli/releases/download/v27.0.0/stellar-cli-27.0.0-x86_64-unknown-linux-gnu.tar.gz"
STELLAR_ARCHIVE_SHA256="357bf712f6353c28cd33c794402a3c87231757a5b305e6ef1604365af4fdd556"
STELLAR_BINARY_SHA256="14a71be83c2f31686b2b32a2d302fd226e6872c1b46a9c23daaa693a9bf98d80"

mkdir -p "$TOOLS_DIR" "${XDG_CONFIG_HOME:-$HOME/.config}/stellar/identity"
export PATH="$TOOLS_DIR:$PATH"

verify_sha256() {
  printf '%s  %s\n' "$1" "$2" | sha256sum --check --status
}

if ! verify_sha256 "$STELLAR_BINARY_SHA256" "$TOOLS_DIR/stellar" 2>/dev/null; then
  archive="$TOOLS_DIR/stellar-cli.tar.gz"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --max-time 120 "$STELLAR_URL" --output "$archive"
  verify_sha256 "$STELLAR_ARCHIVE_SHA256" "$archive"
  extract_dir="$(mktemp -d "$TOOLS_DIR/extract.XXXXXX")"
  tar -xzf "$archive" -C "$extract_dir"
  extracted_bin="$(find "$extract_dir" -type f -name stellar -print -quit)"
  verify_sha256 "$STELLAR_BINARY_SHA256" "$extracted_bin"
  install -m 0755 "$extracted_bin" "$TOOLS_DIR/stellar"
  rm -rf "$extract_dir"
fi

for alias_and_secret in \
  "${JSS_TREASURY_SOURCE_ACCOUNT:?JSS_TREASURY_SOURCE_ACCOUNT is required}|${JSS_TREASURY_SECRET:?JSS_TREASURY_SECRET is required}" \
  "${JSS_DEPLOYER_SOURCE_ACCOUNT:?JSS_DEPLOYER_SOURCE_ACCOUNT is required}|${JSS_DEPLOYER_SECRET:?JSS_DEPLOYER_SECRET is required}"; do
  alias="${alias_and_secret%%|*}"
  secret="${alias_and_secret#*|}"
  printf 'secret_key = "%s"\n' "$secret" > "${XDG_CONFIG_HOME:-$HOME/.config}/stellar/identity/${alias}.toml"
  chmod 600 "${XDG_CONFIG_HOME:-$HOME/.config}/stellar/identity/${alias}.toml"
done

export JSS_STELLAR_SOURCE_ACCOUNT="${JSS_STELLAR_SOURCE_ACCOUNT:-$JSS_DEPLOYER_SOURCE_ACCOUNT}"
export JSS_LOCKBOX_FACTORY_OPERATOR_ADDRESS="$(stellar keys public-key "$JSS_DEPLOYER_SOURCE_ACCOUNT")"
exec node dist/index.js
