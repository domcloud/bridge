import {
    countOf,
    detectCanShareSSL,
    executeLock,
    getRevision,
    getVersion,
    isDebian,
    spawnSudoUtil,
    spawnSudoUtilAsync,
    splitLimit
} from "../util.js";
import {
    nftablesExec
} from "./nftables.js";
import {
    virtualminExec
} from "./virtualmin.js";
import { handleSshOutput, runConfigCodeFeatures } from "./runnercode.js";
import { runConfigSubdomain } from "./runnersub.js";
import path from "path";
import { dockerExec } from "./docker.js";

/**
 * Represents a payload object with body, domain, sandbox, and callback properties.
 */
export class RunnerPayload {
    /**
     * Creates a new Payload instance.
     * @param {Object} options - The payload options.
     * @param {any} options.body - The body content of the payload.
     * @param {string} options.domain - The domain associated with the payload.
     * @param {boolean} options.sandbox - Whether the payload is in sandbox mode.
     * @param {string} [options.callback] - Optional callback function to execute.
     */
    constructor({ body, domain, sandbox, callback }) {
        this.body = body || {};
        this.domain = domain;
        this.sandbox = sandbox;
        /** @type {string | undefined} */
        this.callback = callback;
        this.maxExecutionTime = 900000 // harcoded for now
        /**
         * @type {(log: string) => Promise<void>}
         */
        this.writer = async () => { }
        /**
         * @type {(payload: string) => Promise<void>}
         */
        this.sender = async () => { }
    }
}

/**
 * @param {RunnerPayload} payload
 */
export default async function runConfig(payload) {
    let { body: config, domain, writer, sandbox, maxExecutionTime } = payload;
    const writeLog = async ( /** @type {string} */ s) => {
        await writer(s + "\n");
    }
    const debug = !!config.debug;
    const virtExec = (program, ...opts) => {
        const corePromise = () => new Promise((resolve, reject) => {
            var args = virtualminExec.formatExec(program, ...opts);
            if (debug) {
                writeLog('$> virtualmin ' + args.join(' ') + '\n');
            }
            var virt = virtualminExec.execAsync(...args);
            virt.stdout.on('data', function (chunk) {
                writeLog((chunk + '').split('\n').filter(x => x).join('\n').toString());
            });
            virt.stderr.on('data', function (chunk) {
                writeLog((chunk + '').toString().split('\n').filter(x => x).map(x => '! ' + x).join('\n'));
            })
            virt.on('error', async function (err) {
                await writeLog("Exit status: " + (err) + "\n");
                reject(1);
            })
            virt.on('close', async function (code) {
                await writeLog("Exit status: " + (code) + "\n");
                (code === 0 ? resolve : reject)(code);
            });
        });
        const optIdx = opts.findIndex(x => !!(x && x.domain))
        if (optIdx >= 0) {
            const lockPath = 'virtualmin-' + opts[optIdx].domain;
            return executeLock(lockPath, corePromise)
        } else {
            return corePromise();
        }
    }
    await writeLog(`DOM Cloud runner v${getVersion()} ref ${getRevision()} in ${domain} at ${new Date().toISOString()}`);
    if (typeof config.features === 'string') {
        config.features = [config.features];
    }
    if (Array.isArray(config.features) && config.features.length > 0 && config.features[0].create && !sandbox) {
        const createValues = config.features[0].create;
        if (createValues.source) {
            // restore domain from now
            await writeLog("$> virtualmin restore-domain");
            await writeLog("Creating virtual domain from backup. This will take a moment...");

            await virtExec("restore-domain", createValues,
                {
                    'all-domains': true,
                    'all-features': true,
                    'reuid': true,
                    [createValues['delete-existing'] ? 'delete-existing' : 'only-missing']: true,
                    'skip-warnings': true,
                });
        } else {
            // create new domain
            await writeLog("$> virtualmin create-domain");
            await writeLog("Creating virtual domain. This will take a moment...");
            await virtExec("create-domain", config.features[0].create,
                {
                    dir: true,
                    'virtualmin-nginx': true,
                    'virtualmin-nginx-ssl': true,
                    webmin: !config.features[0].create.parent,
                    unix: !config.features[0].create.parent,
                });
        }
        // we need to wait for disks and caches to get flushed
        await writeLog("$> virtualmin list-domains");
        await new Promise(r => setTimeout(r, 1000));
        await new Promise((resolve, reject) => {
            let tries = 0;
            const check = () => {
                virtExec("list-domains", {
                    domain
                }).then(resolve)
                    .catch(x => {
                        if (++tries < 10) {
                            setTimeout(check, 3000);
                        } else {
                            reject("Domain not found after 10 tries");
                        }
                    });
            }
            check();
        });
        // in old configuration, virtualmin uses "systemctl restart nginx" every reload, 
        // which refuse to start if config got bad. just that case we need start nginx again
        // since in theory they should revert it already. (maybe this is no longer necessary)
        console.log('start emerg nginx ', await spawnSudoUtil('NGINX_START'));
    }
    /**
     * @type {Record<string, string>}
     */
    let domaindata
    try {
        // @ts-ignore
        domaindata = await virtualminExec.getDomainInfo(domain);
    } catch {
        await writeLog("\n$> Server is not exist. Finishing execution");
        return;
    }
    /**
     * @type {import('child_process').ChildProcessWithoutNullStreams}
     */
    let ssh;
    let sshExec;
    let cb = null;
    if (process.env.NODE_ENV === 'development') {
        sshExec = async (cmd) => {
            await writeLog(cmd);
        }
    } else {
        ssh = spawnSudoUtilAsync('SHELL_INTERACTIVE', [domaindata['Username']]);
        ssh.stdout.on('data', function (chunk) {
            if (cb) {
                cb(chunk.toString())
            }
        });
        ssh.stderr.on('data', function (chunk) {
            if (cb) {
                cb(chunk.toString().split('\n').map(x => '! ' + x).join('\n'))
            }
        })
        ssh.on('close', async function (code) {
            ssh = null;
            if (cb) {
                cb('', code);
            }
        });
        /** @type {string|undefined} */
        let sshPs1Header = undefined;
        sshExec = ( /** @type {string} */ cmd, write = true) => {
            return new Promise(function (resolve, reject) {
                if (!ssh) return reject("shell has terminated already");
                cmd = cmd.trimEnd() + "\n";
                const context = {
                    lastChunkIncomplete: false,
                    skipLineLen: countOf(cmd, "\n"),
                    sshPs1Header,
                    writer,
                    debug,
                    write,
                };
                cb = async (/** @type {string} */ chunk, /** @type {number} */ code) => {
                    if (!ssh) {
                        if (code) {
                            await writeLog("Exit status: " + (code) + "\n")
                            return reject(`shell has terminated.`);
                        } else {
                            return resolve();
                        }
                    }
                    let match = await handleSshOutput(chunk, context);
                    if (match) {
                        sshPs1Header = context.sshPs1Header;
                        cb = null;
                        resolve();
                    }
                    return match;
                };
                if (write || debug) {
                    writer('$> ' + cmd.trimEnd().replace(/\n/g, '\n$> ') + '\n');
                }
                ssh.stdin.write(cmd);
            })
        }
        await sshExec(``, false); // drop initial packet
        await sshExec([
            // enforce ps1 header
            isDebian() ? " PS1='\\u@\\h:\\W\\$ '" : " PS1='[\\u@\\h \\W]\\$ '",
            // unset history file
            " unset HISTFILE TERM",
            // early exit on error
            " set -e",
            // when do *, also match .*
            " shopt -s dotglob",
        ].join(';'), false); // drop initial packet
        payload.sender = async (s) => {
            if (!ssh) return;
            if (s == "!ABORT!") {
                await writeLog(`\n$> Execution aborted by user, exiting SSH session gracefully.`);
                await writeLog(`kill ${ssh.pid}: Exit code ` + (await spawnSudoUtil('SHELL_KILL', [ssh.pid + ""])).code);
                ssh = null;
            } else {
                ssh.stdin.write(s);
            }
        }
    }
    try {
        let firewallStatusCache = undefined;
        /**
         * 
         * @returns {Promise<boolean>}
         */
        let firewallStatus = async () => {
            if (firewallStatusCache === undefined) {
                try {
                    firewallStatusCache = !!nftablesExec.getByUser(await nftablesExec.getParsed(), domaindata['Username'], domaindata['User ID']);
                } catch (error) {
                    firewallStatusCache = false;
                }
            }
            return firewallStatusCache;
        };
        for (const feature of Array.isArray(config.features) && !config.subdomain ? config.features : []) {
            const key = typeof feature === 'string' ? splitLimit(feature, / /g, 2)[0] : Object.keys(feature)[0];
            const value = typeof feature === 'string' ? feature.substring(key.length + 1) : feature[key];
            const user = domaindata['Username'];
            switch (key) {
                case 'modify':
                    if (sandbox) {
                        await writeLog("Can't perform " + key + " feature because it is denied");
                        break;
                    }
                    await writeLog("$> virtualmin modify-domain");
                    await virtExec("modify-domain", value, {
                        domain,
                    });
                    if (!value.pass) {
                        break;
                    }
                    if (domaindata['Password for mysql'] == domaindata['Password']) {
                        if (domaindata['Features']?.includes('mysql')) {
                            await writeLog("$> virtualmin modify-database-pass mysql");
                            await virtExec("modify-database-pass", {
                                domain,
                                pass: value.pass,
                                type: 'mysql',
                            });
                            domaindata['Password for mysql'] = value.pass;
                        }
                    }
                    if (domaindata['Password for postgres'] == domaindata['Password']) {
                        if (domaindata['Features']?.includes('postgres')) {
                            await writeLog("$> virtualmin modify-database-pass postgres");
                            await virtExec("modify-database-pass", {
                                domain,
                                pass: value.pass,
                                type: 'postgres',
                            });
                            domaindata['Password for postgres'] = value.pass;
                        }
                    }
                    break;
                case 'rename':
                    if (sandbox) {
                        await writeLog("Can't perform " + key + " feature because it is denied");
                        break;
                    }
                    if (value && value["new-user"] && await firewallStatus()) {
                        await nftablesExec.setDelUser(domaindata['Username'], domaindata['User ID']);
                    }
                    await writeLog("$> virtualmin rename-domain");
                    await virtExec("rename-domain", value, {
                        domain,
                    });
                    // in case if we change domain name
                    if (value && value["new-domain"])
                        domain = value["new-domain"];
                    await new Promise(r => setTimeout(r, 1000));
                    if (value && value["new-user"] && await firewallStatus()) {
                        await nftablesExec.setAddUser(value["new-user"], domaindata['User ID']);
                    }
                    // @ts-ignore
                    domaindata = await virtualminExec.getDomainInfo(domain);
                    break;
                case 'disable':
                    if (sandbox) {
                        await writeLog("Can't perform " + key + " feature because it is denied");
                        break;
                    }
                    await sshExec(`mkdir -p '${domaindata['Home directory']}'`);
                    await writeLog("$> virtualmin disable-domain");
                    await virtExec("disable-domain", value, {
                        domain,
                    });
                    break;
                case 'enable':
                    if (sandbox) {
                        await writeLog("Can't perform " + key + " feature because it is denied");
                        break;
                    }
                    await writeLog("$> virtualmin enable-domain");
                    await virtExec("enable-domain", value, {
                        domain,
                    });
                    await spawnSudoUtil("SHELL_SUDO", ["root",
                        "rm", "-f", path.join(domaindata['Home directory'], `disabled_by_virtualmin.html`)
                    ]);
                    break;
                case 'backup':
                    if (sandbox) {
                        await writeLog("Can't perform " + key + " feature because it is denied");
                        break;
                    }
                    await writeLog("$> virtualmin backup-domain");
                    await virtExec("backup-domain", value, {
                        user,
                        'all-features': true,
                        'ignore-errors': true,
                    });
                    break;
                case 'restore':
                    if (sandbox) {
                        await writeLog("Can't perform " + key + " feature because it is denied");
                        break;
                    }
                    await writeLog("$> virtualmin restore-domain");
                    if (!value.feature) {
                        value.feature = ['dir', 'dns', 'mysql', 'virtualmin-nginx'];
                    }
                    await virtExec("restore-domain", value, {
                        option: [['dir', 'delete', '1']],
                        'all-domains': true,
                        'only-existing': true,
                        'reuid': true,
                        'skip-warnings': true,
                    });
                    break;
                case 'delete':
                    if (sandbox) {
                        await writeLog("Can't perform " + key + " feature because it is denied");
                        break;
                    }
                    await writeLog("$> virtualmin delete-domain");
                    const sharedSSL = detectCanShareSSL(domain);
                    if (sharedSSL && !domaindata['SSL shared with']) {
                        // OMG!
                        await writeLog("$> Applying SSL links with global domain before deleting");
                        await writeLog(await virtualminExec.pushVirtualServerConfig(domaindata['ID'], {
                            'ssl_same': sharedSSL.id,
                            'ssl_key': path.join(sharedSSL.path, 'ssl.key'),
                            'ssl_cert': path.join(sharedSSL.path, 'ssl.cert'),
                            'ssl_chain': path.join(sharedSSL.path, 'ssl.ca'),
                            'ssl_combined': path.join(sharedSSL.path, 'ssl.combined'),
                            'ssl_everything': path.join(sharedSSL.path, 'ssl.everything'),
                        }));
                    }
                    await spawnSudoUtil('SHELL_SUDO', [user, 'killall', '-u', user]);
                    await virtExec("delete-domain", value, {
                        domain,
                    });
                    if (await firewallStatus()) {
                        await nftablesExec.setDelUser(domaindata['Username'], domaindata['User ID']);
                    }
                    await spawnSudoUtil('CLEAN_DOMAIN', ["rm", domaindata['ID'], domain]);
                    // no need to do other stuff
                    return;
                case 'firewall':
                    if (sandbox) {
                        await writeLog("Can't perform " + key + " feature because it is denied");
                        break;
                    }
                    if (value === '' || value === 'on') {
                        await writeLog("$> Changing firewall protection to " + (value || 'on'));
                        await writeLog(await nftablesExec.setAddUser(domaindata['Username'], domaindata['User ID']));
                        firewallStatusCache = true;
                    } else if (value === 'off') {
                        await writeLog("$> Changing firewall protection to " + value);
                        await writeLog(await nftablesExec.setDelUser(domaindata['Username'], domaindata['User ID']));
                        firewallStatusCache = false;
                    }
                    break;
                case 'create-user':
                    if (sandbox) {
                        await writeLog("Can't perform " + key + " feature because it is denied");
                        break;
                    }
                    await virtExec("create-user", {
                        ...value,
                        noemail: typeof value.noemail == 'boolean' ? value.noemail : true,
                        shell: typeof value.shell == 'string' ? value.shell : '/bin/bash',
                        domain,
                    });
                    break;
                case 'delete-user':
                    if (sandbox) {
                        await writeLog("Can't perform " + key + " feature because it is denied");
                        break;
                    }
                    await virtExec("delete-user", {
                        ...value,
                        domain,
                    });
                    break;
                case 'ssh':
                case 'sshpass':
                    if (sandbox) {
                        await writeLog("Can't perform " + key + " feature because it is denied");
                        break;
                    }
                    if (value === '' || value === 'on' || value == 'allow') {
                        await writeLog("$> Changing ssh password login policy to allow");
                        await virtExec("modify-users", {
                            domain,
                            'all-users': true,
                            'enable': true,
                        });
                    } else if (value === 'off' || value == 'disallow') {
                        await writeLog("$> Changing ssh password login policy to disallow");
                        await virtExec("modify-users", {
                            domain,
                            'all-users': true,
                            'disable': true,
                        });
                    }
                    break;
                case 'fix':
                case 'fixperm':
                    await writeLog("$> Fixing domain permissions");
                    // this fixes chown
                    await virtExec("fix-domain-permissions", {
                        domain,
                        'subservers': true,
                    }); 
                    await writeLog((await spawnSudoUtil("SHELL_SUDO", [user,
                        "chmod", "-R", "750", domaindata['Home directory']
                    ])).stdout);
                    break;
                case 'lock':
                case 'lockmod':
                    if (sandbox) {
                        await writeLog("Can't perform " + key + " feature because it is denied");
                        break;
                    }
                    const lpath = path.normalize(value.trim() || 'public_html');
                    if (/\.\./.test(lpath)) {
                        break;
                    }
                    await writeLog("$> Changing owner of " + lpath + " to make it read-only");
                    await writeLog((await spawnSudoUtil("SHELL_SUDO", ["root",
                        "chown", "-hR", "nobody:" + user, path.join(domaindata['Home directory'], lpath)
                    ])).stdout);
                    break;
                case 'unlock':
                case 'unlockmod':
                    if (sandbox) {
                        await writeLog("Can't perform " + key + " feature because it is denied");
                        break;
                    }
                    const upath = path.normalize(value.trim() || 'public_html');
                    if (/\.\./.test(upath)) {
                        break;
                    }
                    await writeLog("$> Changing owner of " + upath + " to make it read-write");
                    await writeLog((await spawnSudoUtil("SHELL_SUDO", ["root",
                        "chown", "-hR", user + ":" + user, path.join(domaindata['Home directory'], upath)
                    ])).stdout);
                    break;
                case 'docker':
                    if (value === '' || value === 'on') {
                        await writeLog("$> Enabling docker features");
                        await writeLog(await dockerExec.enableDocker(domaindata['Username']));
                        await sshExec(`mkdir -p ~/.config/docker  ~/.config/systemd/user/docker.service.d`, false);
                        await sshExec(`[[ -z $DOCKER_HOST ]] && echo "export DOCKER_HOST=unix:///run/user/\\$(id -u)/docker.sock" >>  ~/.bashrc`);
                        await sshExec(`printf '{\\n\\t"exec-opts": ["native.cgroupdriver=cgroupfs"],\\n\\t"host-gateway-ip": "10.0.2.2"\\n}\\n' > ~/.config/docker/daemon.json`);
                        await sshExec(`printf '[Service]\\nEnvironment="DOCKERD_ROOTLESS_ROOTLESSKIT_NET=pasta"\\nEnvironment="DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=implicit"\\nEnvironment="DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=false"\\n' > ~/.config/systemd/user/docker.service.d/override.conf`);
                        await sshExec(`dockerd-rootless-setuptool.sh install --skip-iptables`);
                        await sshExec(`[[ -z $DOCKER_HOST ]] || (systemctl daemon-reload --user; systemctl restart docker --user)`);
                        await sshExec(`export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock`, false);
                    } else if (sandbox) {
                        await writeLog("Can't perform " + key + " feature because it is denied");
                        break;
                    } else if (value === 'off') {
                        await writeLog("$> Disabling docker features");
                        await sshExec(`dockerd-rootless-setuptool.sh uninstall --skip-iptables`);
                        await sshExec(`sed -i '/DOCKER_HOST=/d' ~/.bashrc`);
                        await sshExec(`rm -rf ~/.config/docker`);
                        await sshExec(`rootlesskit rm -rf ~/.local/share/docker`);
                        await writeLog(await dockerExec.disableDocker(domaindata['Username']));
                    }
                    break;
                default:
                    await runConfigCodeFeatures(key, value, writeLog, domaindata, sshExec)
            }
        }

        setTimeout(async () => {
            if (ssh == null) return;
            // SSH prone to wait indefinitely, so we need to set a timeout
            await writeLog(`\n$> Execution took more than ${maxExecutionTime / 1000}s, exiting SSH session gracefully.`);
            await writeLog(`kill ${ssh.pid}: Exit code ` + (await spawnSudoUtil('SHELL_KILL', [ssh.pid + ""])).code);
            ssh = null;
            if (cb) cb('', 124);
        }, maxExecutionTime).unref();

        await sshExec(`export CI=true CONTINUOUS_INTEGRATION=true BUILDKIT_PROGRESS=plain PIP_PROGRESS_BAR=off`, false);
        const passwds = [
            ` USERNAME='${domaindata['Username']}'`,
        ];
        if (domaindata['Password']) {
            passwds.push(` PASSWORD='${domaindata['Password']}'`);
        }
        if (domaindata['Password for mysql']) {
            passwds.push(` MYPASSWD='${domaindata['Password for mysql']}'`);
        }
        if (domaindata['Password for postgres']) {
            passwds.push(` PGPASSWD='${domaindata['Password for postgres']}'`);
        }
        const stillroot = !config.subdomain;
        const domainname = stillroot ? domain : [config.subdomain, domain].join('.');
        passwds.push(` DOMAIN='${domainname}'`);
        await sshExec(` ` + passwds.join('; '), false);
        await runConfigSubdomain(config, domaindata, domainname, sshExec, writeLog, virtExec, firewallStatus, stillroot, sandbox);
        if (stillroot && Array.isArray(config.subdomains)) {
            for (const sub of config.subdomains) {
                const subdomain = [sub.subdomain, domain].join('.');
                await sshExec(` DOMAIN='${subdomain}'`, false);
                if (sub.subdomain) {
                    await runConfigSubdomain(sub, domaindata, subdomain, sshExec, writeLog, virtExec, firewallStatus, false, sandbox);
                } else {
                    await writeLog(`\nERROR: subdomains require subdomain on each item.`);
                }
            }
        }
        if (!ssh) throw "shell has terminated already";
    } catch (err) {
        throw err;
    } finally {
        if (ssh) {
            ssh.stdin.write('exit\n');
        }
    }
}
