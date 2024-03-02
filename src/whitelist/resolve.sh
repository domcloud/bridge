#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
IPV4_ADDRESSES=""
IPV6_ADDRESSES=""
HOST_ADDRESSES=""

for RECORD_TYPE in A AAAA; do
  while read -r p; do
    if [[ $p != "#"* ]]; then
      printf '\r%s Fetching NS %s of %s' "$(tput el)" $RECORD_TYPE $p
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

printf '\n'

echo "$IPV4_ADDRESSES" > ipv4_adresses.txt
echo "$IPV6_ADDRESSES" > ipv6_adresses.txt
echo "$HOST_ADDRESSES" > host_adresses.txt
