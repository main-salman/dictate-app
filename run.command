#!/bin/bash

# Dictate App launcher for macOS (double-clickable in Finder).
# Delegates to run.sh so there is a single source of truth for startup logic.

cd "$(dirname "$0")"
chmod +x run.sh 2>/dev/null
exec ./run.sh
