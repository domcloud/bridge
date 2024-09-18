import {
    cat,
    executeLock,
    spawnSudoUtil,
} from '../util.js';
import { existsSync } from 'fs';
import { nginxExec } from './nginx.js';
import path from 'path';
import * as yaml from 'yaml';
import { ShellString } from 'shelljs';

const tmpFile = path.join(process.cwd(), '/.tmp/compose')

class DockerExecutor {
    LOGINLINGERDIR = '/var/lib/systemd/linger';
    constructor() {
        if (process.env.LOGINLINGERDIR) {
            this.LOGINLINGERDIR = process.env.LOGINLINGERDIR;
        }
    }
    /**
     * @param {string} user
     */
    checkDockerEnabled(user) {
        return existsSync(this.LOGINLINGERDIR + '/' + user);
    }
    /**
     * @param {string} user
     */
    async enableDocker(user) {
        if (this.checkDockerEnabled(user)) {
            return "Done unchanged";
        }
        return await executeLock('docker', async () => {
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "usermod", "--add-subuids", "100000-165535",
                "--add-subgids", "100000-165535", user]);
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "loginctl", "enable-linger", user]);
            return "Updated for docker";
        });
    }
    /**
     * @param {string} user
     */
    async disableDocker(user) {
        if (!this.checkDockerEnabled(user)) {
            return "Done unchanged";
        }
        return await executeLock('docker', async () => {
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "usermod", "--del-subuids", "100000-165535",
                "--del-subgids", "100000-165535", user]);
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "loginctl", "disable-linger", user]);
            return "Updated for docker";
        });
    }
    generateRandomIPv4() {
        // Generate random octets (numbers between 0 and 255)
        const octet1 = Math.trunc(Math.random() * 256);
        const octet2 = Math.trunc(Math.random() * 256);
        const octet3 = Math.trunc(Math.random() * 256);

        // Construct the address with the "10." prefix
        const ipAddress = `10.${octet1}.${octet2}.${octet3}`;
        return ipAddress;
    }
    /**
     * 
     * @param {any} services 
     * @param {string} domain 
     */
    async rewriteServices(services, domain) {
        // get IP data from nginx
        const nginxNode = await nginxExec.get(domain);
        const nginx = nginxExec.extractInfo(nginxNode, domain);
        let nginxChanged = false;
        if (!nginx.docker_ip) {
            nginx.docker_ip = this.generateRandomIPv4();
            nginxChanged = true;
        }
        var exposedPorts = [];
        // rewrite all ips
        for (const [name, service] of Object.entries(services)) {
            if (typeof service !== 'object' || !service.ports) continue;
            if (!Array.isArray(service.ports) || service.ports.length == 0) throw new Error("Invalid ports format in service: " + name);
            for (let i = 0; i < service.ports.length; i++) {
                var port = service.ports[i];
                var conf = {
                    target: 0,
                    host_ip: nginx.docker_ip,
                    protocol: 'tcp',
                    published: "" + Math.trunc(Math.random() * 30000 + 1025),
                }
                if (typeof port === 'string') {
                    if (/^\d+$/.test(port)) {
                        conf.target = parseInt(port);
                    } else if (/^\d+:\d+$/.test(port)) {
                        const [src, dst] = port.split(":");
                        conf.target = parseInt(dst);
                        conf.published = src;
                    } else if (/^127.0.0.1:\d+:\d+$/.test(port)) {
                        const [_, src, dst] = port.split(":");
                        conf.target = parseInt(dst);
                        conf.published = src;
                    } else {
                        throw new Error("Unknown ports format: " + name);
                    }
                }
                exposedPorts.push(conf.published);
                service.ports[i] = conf;
            }
        }
        // nginx replace port docker
        let matchedConf = nginx.config.locations?.find(x => x.match == '/');
        if (!matchedConf) {
            if (!nginx.config.locations)
                nginx.config.locations = [];
            matchedConf = { match: '/' }
            nginx.config.locations.push(matchedConf);
            nginxChanged = true;
        }
        let proxyPass = matchedConf.proxy_pass + "";
        if (!proxyPass || !proxyPass.startsWith('docker:') || exposedPorts.includes(proxyPass.replace(/^docker:/, ''))) {
            if (exposedPorts.length == 0) {
                throw new Error("There are no exposed ports! Need atleast one to forward it into NGINX");
            }
            matchedConf.proxy_pass = "docker:" + exposedPorts[exposedPorts.length - 1];
            nginxChanged = true;
        }
        if (nginxChanged) {
            await nginxExec.setDirect(domain, nginx);
        }
        return services;
    }
    /**
     * 
     * @param {any} services 
     * @param {string} home 
     * @param {string} domain 
     * @return {Promise<string>}
     */
    async executeServices(services, home, domain) {
        let filename = path.join(home, 'docker-compose.yml');
        let composeObject = {};
        if (typeof services === 'string') {
            filename = path.join(home, services);
            // cat from file
            composeObject = yaml.parse(await executeLock('compose', () => {
                return new Promise((resolve, reject) => {
                    spawnSudoUtil('COMPOSE_GET', [filename]).then(() => {
                        resolve(cat(tmpFile));
                    }).catch(reject);
                });
            }));
        } else {
            composeObject.services = services;
        }
        composeObject.services = this.rewriteServices(composeObject.services, domain);
        let composeFile = yaml.stringify(composeObject);
        await executeLock('compose', () => {
            return new Promise((resolve, reject) => {
                ShellString(composeFile).to(filename)
                spawnSudoUtil('COMPOSE_SET', [filename]).then(resolve).catch(reject);
            });
        });
        return composeFile;
    }
}

export const dockerExec = new DockerExecutor();
