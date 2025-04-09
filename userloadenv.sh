#!/bin/sh

ENV_FILES=""  # list of env files (empty by default)
VERBOSE=0

show_help() {
  cat <<EOF
Usage: $(basename "$0") [--env-file=FILE ...] [--verbose] [--help] [VAR=val ...] COMMAND [ARGS...]

Options:
  --env-file=FILE   Specify an env file to load (can be used multiple times)
  --verbose         Print each env file loaded
  --help            Show this help message

Load .env file as environment variables and execute a command
If no --env-file is given, defaults to loading ./.env
EOF
}

# Parse --env-file=... options
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file=*)
      FILE="${1#--env-file=}"
      case "$FILE" in
        /*) ;;               # absolute path, use as is
        ./*) ;;              # relative path, use as is
        ../*) ;;             # relative path, use as is
        \~/*) FILE="${HOME}/${FILE#\~\/}" ;;  # relative to home path
        *) FILE="./$FILE" ;; # make relative
      esac
      ENV_FILES="$ENV_FILES $FILE"
      shift
      ;;
    --verbose)
      VERBOSE=1
      shift
      ;;
    --help)
      show_help
      exit 0
      ;;
    --) shift; break ;;      # stop parsing options
    *) break ;;              # first non-option argument
  esac
done

# Fallback to .env only if no --env-file was specified
if [ -z "$ENV_FILES" ]; then
  ENV_FILES="./.env"
fi

set -a

# Source all env files
for f in $ENV_FILES; do
  if [ -f "$f" ]; then
    [ "$VERBOSE" -eq 1 ] && echo "Loading env from $f" >&2
    . "$f"
  else
    [ "$VERBOSE" -eq 1 ] && echo "Skipping missing env file: $f" >&2
  fi
done

# Execute command with optional inline env vars
exec env "$@"
