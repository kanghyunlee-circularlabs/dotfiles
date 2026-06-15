#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

for index in "$SCRIPT_DIR"/*/index.sh; do
  [ -f "$index" ] && source "$index"
done
