#!/bin/sh

# Load .env file if it exists in the current directory
if [ -f .env ]; then
  # Export variables from .env file
  export $(grep -v '^#' .env | xargs)
fi

# Execute the given command with the loaded environment
exec "$@"
