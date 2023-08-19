# DOM Cloud Bridge

The core script runner to control any server which has [Virtualmin](https://www.virtualmin.com/) and [Phusion Passenger](https://www.phusionpassenger.com/docs/tutorials/what_is_passenger/) boot together. 

This service is used to control a server booted with DOM Cloud Instance. It's actually installed for each DOM Cloud servers.

## Architecture details

To understand DOM Cloud servers architecture, read it on [DOM Cloud docs](https://domcloud.co/docs/features/).

To setup a VM from stratch and set up this service in that VM, see [Self hosting](https://domcloud.co/docs/integration/self-host). You'll see that this service is need to run as a Systemd service.
