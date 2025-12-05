#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
NFIP_ADDRESSES=""
HOST_ADDRESSES=""
DNS_SERVERS=("1.1.1.1")

for RECORD_TYPE in A AAAA; do
  while read -r line; do
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue  # skip comments and empty lines

    # Check for 4: prefix
    if [[ "$line" == 4:* ]]; then
      domain="${line#4:}"
      [[ "$RECORD_TYPE" != "A" ]] && continue  # skip AAAA if 4: prefix
    elif [[ "$line" == 6:* ]]; then
      domain="${line#6:}"
      [[ "$RECORD_TYPE" != "AAAA" ]] && continue  # skip A if 6: prefix
    else
      domain="$line"
    fi

    printf '\rFetching NS %s of %s ' "$RECORD_TYPE" "$domain"
    FFI=""
    for dns in "${DNS_SERVERS[@]}"; do
      TEMP_RESULT=$(dig +short "$RECORD_TYPE" "$domain" @"$dns" | grep -v '\.$')
      if [[ -n "$TEMP_RESULT" ]]; then
        FFI+=$'\n'"$TEMP_RESULT"
      fi
    done
    if [ -z "$FFI" ] && [ "$RECORD_TYPE" = "A" ]; then
      echo "No records found for $domain, exiting."
      exit 1
    fi
    while read -r q; do
      if [[ -n "$q" ]]; then
        HOST_ADDRESSES+="$q $domain"$'\n'
        if [[ $RECORD_TYPE == "A" ]]; then
          NFIP_ADDRESSES+="add element inet filter whitelist { $q }"$'\n'
        else
          NFIP_ADDRESSES+="add element inet filter whitelist-v6 { $q }"$'\n'
        fi
      fi
    done <<< "$FFI"
  done < "$SCRIPT_DIR/sites.conf"
done

echo ""
echo -n "$NFIP_ADDRESSES" > "$SCRIPT_DIR/nfip_addresses.txt"
echo -n "$HOST_ADDRESSES" > "$SCRIPT_DIR/host_addresses.txt"
