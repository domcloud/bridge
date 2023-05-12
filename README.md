# DOM Cloud Bridge

The core script runner to control any server which has [Virtualmin](https://www.virtualmin.com/) and [Phusion Passenger](https://www.phusionpassenger.com/docs/tutorials/what_is_passenger/) boot together. 

This service is used to control a server booted with DOM Cloud Instance. It's actually installed for each DOM Cloud servers.

## Architecture details

To understand DOM Cloud servers architecture, read it on [DOM Cloud docs](https://domcloud.co/docs/features/).

To setup a VM from stratch and set up this service in that VM, see https://github.com/domcloud/container.

## Self Installation

1. `git clone https://github.com/domcloud/bridge/ .`
2. Run init script `sh ./tools-init.sh`
3. Paste the final message to root user (so `sudoutil.js` can be run as root)
4. `npx pm2 start app.js && npx pm2 save`
5. Paste the final message to root user (so the app.js can be run as system daemon)
6. Put `tools-init.nginx.conf` to NGINX config. Adjust accordingly.

Note: You can't put this service under Phusion Passenger because it will be killed during NginX reconfiguration so please use instruction above to run it under `pm2`.
