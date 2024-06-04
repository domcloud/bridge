#!/bin/bash

# deletes orphan linux users
rm -rf /var/lib/sss/db/*
getent passwd | sort -t: -k6 | while IFS=: read -r u _ _ _ _ d _
do
  if [[ "$d" =~ ^/home/ ]] && ! [[ -d "$d" ]]; then 
    printf 'Directory %q missing for user: %q\n' "$d" "$u"
    userdel -r $u
  fi
done
