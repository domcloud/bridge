import {
  cat,
  executeLock,
  spawnSudoUtil,
  splitLimit,
} from '../util.js';
import { existsSync } from 'fs';
import { nginxExec } from './nginx.js';
import path from 'path';
import * as yaml from 'yaml';
import { ShellString } from 'shelljs';
import { exec } from 'child_process';

const composeTmpFile = path.join(process.cwd(), '/.tmp/compose')
const portsTmpFile = path.join(process.cwd(), '/.tmp/ports')
const standardPortRegex = /^(\$\{?\w+\}?|\d+):(\$\{?\w+\}?|\d+)$/;
const complexPortRegex = /^127\.0\.0\.1:(\$\{?\w+\}?|\d+):(\$\{?\w+\}?|\d+)$/;

class DockerExecutor {
  LOGINLINGERDIR = '/var/lib/systemd/linger';
  constructor() {
    if (process.env.LOGINLINGERDIR) {
      this.LOGINLINGERDIR = process.env.LOGINLINGERDIR;
    }
  }
  /**
   * @param {string} user
   * @returns {Promise<string>}
   */
  async getUid(user) {
    return await new Promise((resolve, reject) => {
      exec(`id -u ${user}`, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.toString().trim());
      });
    });
  }
  async listPorts() {
    let result = await spawnSudoUtil("PORTS_LIST");
    return result.stdout
      .trim()
      .split("\n")
      .filter(x => x)
      .map((x) => splitLimit(x, ":", 2));
  }
  /**
   * @param {string} uid
   * @param {number[]} ports
   */
  async writePorts(uid, ports) {
    return await executeLock("ports", async () => {
      await spawnSudoUtil("PORTS_GET", []);
      var lines = cat(portsTmpFile).trim().split("\n");
      let changed = false;
      for (const port of ports) {
        const findLine = uid + ":" + port;
        if (lines.findIndex(x => x == findLine) == -1) {
          lines.push(findLine);
          changed = true;
        }
      }
      if (changed) {
        ShellString(lines.join("\n") + "\n").to(portsTmpFile);
        await spawnSudoUtil("PORTS_SET", []);
        return "Ports allocation added";
      } else {
        return "Ports allocation unchanged";
      }
    });
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
  /**
   * 
   * @param {any} services 
   * @param {string} domain 
   * @param {number | null} hint 
   */
  async rewriteServices(services, domain, username, hint) {
    // get IP data from nginx
    const nginxNode = await nginxExec.get(domain);
    const nginx = nginxExec.extractInfo(nginxNode, domain);
    let nginxChanged = false;
    let portsChanged = false;
    let ports = await this.listPorts();
    let uid = await this.getUid(username);
    let availablePorts = ports.filter(x => x[0] == uid).map(x => x[1]);
    /**
     * @type {number[]}
     */
    var exposedPorts = [];
    // rewrite all ips
    for (const [name, service] of Object.entries(services)) {
      if (typeof service !== 'object' || !service.ports) continue;
      if (!Array.isArray(service.ports) || service.ports.length == 0) throw new Error("Invalid ports format in service: " + name);
      for (let i = 0; i < service.ports.length; i++) {
        var port = service.ports[i];
        var conf = {
          target: '',
          protocol: 'tcp',
          published: "",
        }
        if (typeof port === 'string') {
          if (port.endsWith('/tcp') || port.endsWith('/udp')) {
            conf.protocol = port.substring(port.length - 3, port.length);
            port = port.substring(0, port.length - 4);
          }
          if (/^\d+$/.test(port)) {
            // Simple port number
            conf.target = port;
            conf.published = port;
          } else if (standardPortRegex.test(port)) {
            // Format: <published>:<target>
            const match = port.match(standardPortRegex);
            conf.published = match[1];
            conf.target = match[2];
          } else if (complexPortRegex.test(port)) {
            // Format: 127.0.0.1:<published>:<target>
            const match = port.match(complexPortRegex);
            conf.published = match[1];
            conf.target = match[2];
          } else {
            throw new Error(`Unknown ports format in service ${name}: ${port}`);
          }
        } else if (typeof port === 'object' && port.target && port.published) {
          conf.published = port.published;
          conf.target = port.target;
          if (port.protocol) {
            conf.protocol = port.protocol;
          }
        }
        if (/^\d+$/.test(conf.published) && /^\d+$/.test(conf.target)) {
          if (availablePorts.includes(conf.published)) {
            availablePorts = availablePorts.filter(x => x != conf.published);
          } else if (ports.length >= 20000 * 0.9) {
            throw new Error('Docker ports allocation has been exhausted, please contact server maintainer');
          } else {
            let candidate = parseInt(conf.published);
            while (isNaN(candidate) || candidate <= 10000 || candidate >= 65535 || ports.findIndex(x => x[1] == candidate + "") != -1) {
              candidate = Math.trunc(Math.random() * 20000) + 10000
            }
            conf.published = candidate + "";
            ports.push([uid, candidate + ""]);
            portsChanged = true;
          }
          exposedPorts.push(parseInt(conf.published));
        }
        service.ports[i] = `${conf.published}:${conf.target}/tcp`;
      }
    }
    // make sure to handle .well-known
    let wellKnownConf = nginx.config.locations?.find(x => x.match.endsWith('/.well-known/'));
    if (!wellKnownConf) {
      if (!nginx.config.locations)
        nginx.config.locations = [];
      nginx.config.locations.push({
        match: '/.well-known/',
        alias: nginx.root + '/.well-known/',
      });
      nginxChanged = true;
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
    const proxyPrefix = 'http://127.0.0.1:';
    let proxyPassMatched = proxyPass.startsWith(proxyPrefix) && exposedPorts.includes(parseInt(proxyPass.replace(proxyPrefix, '')));
    var matchingProxy = proxyPass;
    if (hint && exposedPorts.includes(hint)) {
      matchingProxy = proxyPrefix + hint;
    } else if (proxyPassMatched) {
      matchingProxy = proxyPass;
    } else {
      if (exposedPorts.length == 0) {
        throw new Error("There are no exposed ports can be detected! Please tell use the port like `service: docker-compose.yml#8000`");
      }
      matchingProxy = proxyPrefix + exposedPorts[0];
    }
    if (matchingProxy != proxyPass) {
      matchedConf.proxy_pass = matchingProxy;
      nginxChanged = true;
    }
    let nginxStatus = '';
    if (nginxChanged) {
      nginxStatus = await nginxExec.setDirect(domain, nginx);
    } else {
      nginxStatus = "Done unchanged";
    }
    if (portsChanged) {
      await this.writePorts(uid, exposedPorts.filter(x => x < 30000));
    }
    return [services, nginxStatus];
  }
  /**
   * 
   * @param {any} services 
   * @param {string} home 
   * @param {string} domain 
   * @param {string} username 
   * @param {(arg0: string) => Promise<void>} logWriter 
   * @return {Promise<string>}
   */
  async executeServices(services, home, domain, username, logWriter) {
    let filename = path.join(home, 'docker-compose.yml');
    let composeObject = {};
    let hint = null;
    if (typeof services === 'string') {
      let sepIdx = services.indexOf('#');
      if (sepIdx > 0) {
        hint = parseInt(services.substring(sepIdx + 1));
        if (Number.isNaN(hint) || hint > 65535 || hint < 0) {
          hint = null;
        }
        services = services.substring(0, sepIdx);
      }
      filename = path.join(home, services);
      // cat from file
      composeObject = yaml.parse(await executeLock('compose', () => {
        return new Promise((resolve, reject) => {
          spawnSudoUtil('COMPOSE_GET', [filename]).then(() => {
            resolve(cat(composeTmpFile));
          }).catch(reject);
        });
      }));
    } else {
      composeObject.services = services;
    }
    let [composeServices, nginxStatus] = await this.rewriteServices(composeObject.services, domain, username, hint);
    if (!composeServices) {
      throw new Error('The compose file is either invalid or not found');
    } else {
      composeObject.services = composeServices;
    }
    if (logWriter) {
      await logWriter(nginxStatus)
    }
    if (composeObject.version) {
      delete composeObject.version;
    }
    let composeFile = yaml.stringify(composeObject);
    await executeLock('compose', () => {
      return new Promise((resolve, reject) => {
        ShellString(composeFile).to(composeTmpFile)
        spawnSudoUtil('COMPOSE_SET', [filename]).then(resolve).catch(reject);
      });
    });
    return composeFile;
  }
}

export const dockerExec = new DockerExecutor();
