#!/bin/bash
set -e 

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

bash "$SCRIPT_DIR/resolve.sh"

echo -e "#!/usr/sbin/nft -f\n\n" > /etc/nftables-whitelist.conf
cat "$SCRIPT_DIR/nfip_addresses" >> /etc/nftables-whitelist.conf
nft -f "/etc/nftables-whitelist.conf"

if [ ! -f "$SCRIPT_DIR/hosts.txt" ]; then
    cat /etc/hosts > "$SCRIPT_DIR/hosts.txt"
fi

cat "$SCRIPT_DIR/hosts.txt" > /etc/hosts
cat "$SCRIPT_DIR/host_addresses.txt" >> /etc/hosts
