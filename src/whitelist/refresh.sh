#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

### Create Ipset
ipset -! create whitelist hash:ip
ipset -! create whitelist-v6 hash:ip family inet6
### Clear Ipset, not gonna use it because DNS IPs often changing
# ipset flush whitelist
# ipset flush whitelist-v6
while read p; do
  if [[ $p != "#"* ]];
  then
    FFI=`dig +short A $(echo $p | xargs) | grep -v '\.$'`
    while read -r q; do
      if [[ $q != "" ]];
      then
        ipset -! add whitelist $q
      fi
    done < <(echo $FFI| sed 's/ /\n/g')
    FFI6=`dig +short AAAA $(echo $p | xargs) | grep -v '\.$'`
    while read -r q; do
      if [[ $q != "" ]];
      then
        ipset -! add whitelist-v6 $q
      fi
    done < <(echo $FFI6| sed 's/ /\n/g')
  fi
done <"$SCRIPT_DIR/sites.conf"
