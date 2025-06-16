#!/bin/bash
set -e 

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

bash "$SCRIPT_DIR/resolve.sh"

merge_files() {
    local original_file="$1"
    local backup_file="$2"
    local append_file="$3"

    if [ ! -f "$backup_file" ]; then
        cat "$original_file" > "$backup_file"
    fi

    cat "$backup_file" > "$original_file"
    cat "$append_file" >> "$original_file"
}

merge_files /etc/nftables-whitelist.conf \
    "$SCRIPT_DIR/nftables.txt" \
    "$SCRIPT_DIR/nfip_addresses.txt"

merge_files /etc/hosts \
    "$SCRIPT_DIR/hosts.txt" \
    "$SCRIPT_DIR/host_addresses.txt"

sync # just in case

/usr/sbin/nft -f "/etc/nftables-whitelist.conf" || { ec=$?; echo "err $(date): $ec" >> /etc/nftables-whitelist.err; }
