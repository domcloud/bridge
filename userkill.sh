#!/bin/bash

# Killing NGINX process as user provided 

if [ -z "$USER" ]; then
  echo "\$USER is not provided"
  exit 1
fi

if [ "$USER" == "root" ]; then
  echo "Don't call this on root!"
  exit 1
fi

# Get the list of processes for the user
user_procs=$(ps -u $USER --forest -o pid=,comm=)

# Loop through each process
while read -r pid comm; do
  # Skip if the command is subcommand or essential features
  if [[ "$comm" =~ ^(\\|\|).* || "$comm" == "sh" || "$comm" == "bash" || "$comm" == "docker" ||  "$comm" == "systemd" ]]; then
    continue
  fi

  # Kill the process
  echo "Killing process $pid ($comm)"
  pkill -P $pid
  kill -9 $pid

done <<< "$user_procs"

