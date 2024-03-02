#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
IPV4_ADDRESSES=""
IPV6_ADDRESSES=""
HOST_ADDRESSES=""

for RECORD_TYPE in A AAAA; do
  while read -r p; do
    if [[ $p != "#"* ]]; then
      if [[ -v TERMINFO ]]; then
        printf '\r%s Fetching NS %s of %s' "$(tput el)" $RECORD_TYPE $p
      fi
      FFI=$(dig +short $RECORD_TYPE $(echo "$p" | xargs) | grep -v '\.$' | tail -n1)
      while read -r q; do
        if [[ $q != "" ]]; then
          HOST_ADDRESSES+="$q $p"$'\n'
          if [[ $RECORD_TYPE == "A" ]]; then
            IPV4_ADDRESSES+="$q"$'\n'
          else
            IPV6_ADDRESSES+="$q"$'\n'
          fi
        fi
      done <<< "$FFI"
    fi
  done <"$SCRIPT_DIR/sites.conf"
done 

echo "$IPV4_ADDRESSES" > "$SCRIPT_DIR/ipv4_addresses.txt"
echo "$IPV6_ADDRESSES" > "$SCRIPT_DIR/ipv6_addresses.txt"
echo "$HOST_ADDRESSES" > "$SCRIPT_DIR/host_addresses.txt"
