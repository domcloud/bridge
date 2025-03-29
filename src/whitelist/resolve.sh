#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
NFIP_ADDRESSES=""
HOST_ADDRESSES=""
DNS_SERVERS=("127.0.0.1" "1.1.1.1" "8.8.8.8")

for RECORD_TYPE in A AAAA; do
  while read -r p; do
    if [[ $p != "#"* ]]; then
      printf '\r%s Fetching NS %s of %s' "$(tput el 2> /dev/null)" $RECORD_TYPE $p
      FFI=""
      for dns in "${DNS_SERVERS[@]}"; do
        TEMP_RESULT=$(dig +short "$RECORD_TYPE" "$p" @"$dns" | grep -v '\.$')
        if [[ -n "$TEMP_RESULT" ]]; then
          FFI+=$'\n'"$TEMP_RESULT"
        fi
      done
      if [ -z "$FFI" ] && [ "$RECORD_TYPE" = "A" ]; then
        echo "No records found for $p, exiting."
        exit 1
      fi
      while read -r q; do
        if [[ $q != "" ]]; then
          HOST_ADDRESSES+="$q $p"$'\n'
          if [[ $RECORD_TYPE == "A" ]]; then
            NFIP_ADDRESSES+="add element inet filter whitelist { $q }"$'\n'
          else
            NFIP_ADDRESSES+="add element inet filter whitelist-v6 { $q }"$'\n'
          fi
        fi
      done <<< "$FFI"
    fi
  done <"$SCRIPT_DIR/sites.conf"
done 

echo ""
echo -n "$NFIP_ADDRESSES" > "$SCRIPT_DIR/nfip_addresses.txt"
echo -n "$HOST_ADDRESSES" > "$SCRIPT_DIR/host_addresses.txt"
