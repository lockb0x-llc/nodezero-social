#!/usr/bin/env bash

verify_sha256() {
  local expected="$1" file="$2"
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ -f "$file" ]] || return 1
  printf '%s  %s\n' "$expected" "$file" | sha256sum --check --status
}

install_stellar_cli() {
  local tools_dir="$1" url="$2" archive_sha256="$3" binary_sha256="$4"
  local archive="$tools_dir/stellar-cli.tar.gz" binary="$tools_dir/stellar"
  local extract_dir extracted_bin

  mkdir -p "$tools_dir"
  if verify_sha256 "$binary_sha256" "$binary"; then
    printf '%s\n' "$binary"
    return 0
  fi

  if ! verify_sha256 "$archive_sha256" "$archive"; then
    rm -f "$archive"
    curl --fail --silent --show-error --location \
      --proto '=https' --tlsv1.2 --max-time 120 \
      "$url" --output "$archive"
  fi
  if ! verify_sha256 "$archive_sha256" "$archive"; then
    rm -f "$archive" "$binary"
    return 1
  fi

  extract_dir="$(mktemp -d "$tools_dir/stellar-extract.XXXXXX")"
  if ! tar -xzf "$archive" -C "$extract_dir"; then
    rm -rf "$extract_dir" "$archive" "$binary"
    return 1
  fi
  extracted_bin="$(find "$extract_dir" -type f -name stellar -print -quit)"
  if ! verify_sha256 "$binary_sha256" "$extracted_bin"; then
    rm -rf "$extract_dir" "$archive" "$binary"
    return 1
  fi
  install -m 0755 "$extracted_bin" "$binary"
  rm -rf "$extract_dir"

  verify_sha256 "$binary_sha256" "$binary" || {
    rm -f "$binary"
    return 1
  }
  printf '%s\n' "$binary"
}