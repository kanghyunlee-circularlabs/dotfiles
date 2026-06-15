#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

source "$SCRIPT_DIR/worktree.sh"
source "$SCRIPT_DIR/github.sh"
