# DOM Cloud Bridge

The core script runner to control any server which has [Virtualmin](https://www.virtualmin.com/) and [Phusion Passenger](https://www.phusionpassenger.com/docs/tutorials/what_is_passenger/) boot together. 

This service is used to control a server booted with DOM Cloud Instance. It's actually installed for each DOM Cloud servers.

## Architecture details

To understand DOM Cloud servers architecture, read it on [DOM Cloud docs](https://domcloud.co/docs/features/).

To setup a VM from stratch and set up this service in that VM, see [Container](https://github.com/domcloud/container/) which contains a link to pre-made OS image.

## Environment Variables

All environment variables are saved to `.env` file. Please note "Portal" below means my.domcloud.co.

| KEY | DESCRIPTION |
|---|---|
| `SECRET` | The secret keys to communicate to portal |
| `SSL_WILDCARDS` | A comma separated lists of domains available for wildcard SSL sharing |
| `NGINX_FREE_DOMAIN` | Which domain need to be added banner |
| `ALLOW_IP` | IPs to allow API communication |

When adding a self-hosted instance to DOM Cloud portal, you'll want to set a strong `SECRET` and an allow list IP like below

```sh
SECRET="<your strong secret here>"
SSL_WILDCARDS=yoursite.com
NGINX_FREE_DOMAIN=
ALLOW_IP=159.89.198.103,2400:6180:0:d0::e08:a001
```
