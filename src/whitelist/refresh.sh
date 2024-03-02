#!/bin/bash
set -e 

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

bash "$SCRIPT_DIR/resolve.sh"

### Create Ipset
ipset -! create whitelist hash:ip
ipset -! create whitelist-v6 hash:ip family inet6
### Clear Ipset
ipset flush whitelist
ipset flush whitelist-v6

while read p; do
  if [[ $p != "" ]];
  then
    ipset -! add whitelist $q
done <"$SCRIPT_DIR/ipv4_addresses.txt"

while read p; do
  if [[ $p != "" ]];
  then
    ipset -! add whitelist_v6 $q
done <"$SCRIPT_DIR/ipv6_addresses.txt"

if [ ! -f "$SCRIPT_DIR/hosts.txt" ]; then
    cat /etc/hosts > "$SCRIPT_DIR/hosts.txt"
fi

cat "$SCRIPT_DIR/hosts.txt" > /etc/hosts
cat "$SCRIPT_DIR/host_addresses.txt" >> /etc/hosts
