# dom-next-rootkit

The core script runner to control any server which has Virtualmin and Phusion Passenger boot together.

## Installation

Note: You can't put this service under Phusion Passenger because it will be killed during NginX reconfiguration so please use instruction below to run it under `pm2`.

1. `git clone https://github.com/domcloud/dom-next-rootkit/ .`
2. Run init script `sh ./tools-init.sh`
3. Paste the final message to root user (so sudoutil.js can be run as root)
4. `npx pm2 start app.js && npx pm2 save`
5. Paste the final message to root user (so the app.js can be run as daemon)
6. Put `tools-init.nginx.conf` to NGINX config. Adjust accordingly.
