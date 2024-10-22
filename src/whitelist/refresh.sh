#!/bin/bash
set -e 

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

bash "$SCRIPT_DIR/resolve.sh"

ipset -! create whitelist hash:ip
ipset -! create whitelist-v6 hash:ip family inet6

ipset flush whitelist
ipset restore -! <"$SCRIPT_DIR/ipv4_addresses.txt"
ipset save whitelist > /etc/ipset

ipset flush whitelist-v6
ipset restore -! <"$SCRIPT_DIR/ipv6_addresses.txt"
ipset save whitelist-v6 > /etc/ipset6

if [ ! -f "$SCRIPT_DIR/hosts.txt" ]; then
    cat /etc/hosts > "$SCRIPT_DIR/hosts.txt"
fi

cat "$SCRIPT_DIR/hosts.txt" > /etc/hosts
cat "$SCRIPT_DIR/host_addresses.txt" >> /etc/hosts
