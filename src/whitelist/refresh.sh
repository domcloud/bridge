#!/bin/bash
set -e 

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

bash "$SCRIPT_DIR/resolve.sh"

if [ ! -f "$SCRIPT_DIR/nftables.txt" ]; then
    cat /etc/nftables-whitelist.conf > "$SCRIPT_DIR/nftables.txt"
fi
cat "$SCRIPT_DIR/nftables.txt" > /etc/nftables-whitelist.conf
cat "$SCRIPT_DIR/nfip_addresses.txt" >> /etc/nftables-whitelist.conf

if [ ! -f "$SCRIPT_DIR/hosts.txt" ]; then
    cat /etc/hosts > "$SCRIPT_DIR/hosts.txt"
fi
cat "$SCRIPT_DIR/hosts.txt" > /etc/hosts
cat "$SCRIPT_DIR/host_addresses.txt" >> /etc/hosts

sync && sleep 0.5 # sometimes nft not picking up changes
nft -f "/etc/nftables-whitelist.conf" || { ec=$?; echo "err $(date): $ec" >> /etc/nftables-whitelist.err; }
