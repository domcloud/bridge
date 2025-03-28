import {
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
import { runConfigCodeFeatures } from "./runnercode.js";
import { runConfigSubdomain } from "./runnersub.js";
import path from "path";

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
        this.domain = domain + "";
        this.sandbox = !!sandbox;
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
    const virtExec = (program, ...opts) => {
        const corePromise = () => new Promise((resolve, reject) => {
            var virt = virtualminExec.execFormattedAsync(program, ...opts);
            virt.stdout.on('data', function (chunk) {
                writeLog((chunk + '').split('\n').filter(x => x).join('\n').toString());
            });
            virt.stderr.on('data', function (chunk) {
                writeLog((chunk + '').toString().split('\n').filter(x => x).map(x => '! ' + x).join('\n'));
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
        // sometimes we need to wait for the domain to be created
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
        // FOR SOME REASON IN MY SERVER, NGINX SUDDENLY STOPPED WORKING
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
        const debug = !!config.debug;
        /** @type {string|undefined} */
        let sshPs1Header = undefined;
        sshExec = ( /** @type {string} */ cmd, write = true) => {
            return new Promise(function (resolve, reject) {
                if (!ssh) return reject("shell has terminated already");
                let first = true;
                let lastChunkIncomplete = false;
                cb = async (/** @type {string} */ chunk, /** @type {number} */ code) => {
                    if (!ssh) {
                        if (code) {
                            await writeLog("Exit status: " + (code) + "\n")
                            return reject(`shell has terminated.`);
                        } else {
                            return resolve();
                        }
                    }
                    debug && await (async function () {
                        const splits = chunk.split('\n');
                        if (lastChunkIncomplete) {
                            await writer("\n");
                            lastChunkIncomplete = false;
                        }
                        for (let i = 0; i < splits.length; i++) {
                            const el = splits[i] + (i == splits.length - 1 ? "" : "\n");
                            el && await writer("$< " + JSON.stringify(el) +
                                (i < splits.length - 1 ? " +\n" : "\n"));
                        }
                    })()
                    chunk = chunk.replace(/\0/g, '');
                    // TODO: Can't use sshPs1Header since cd dir can change it?
                    const match = chunk.match(isDebian() ? /.+?\@.+?:.+?\$ $/ : /\[.+?\@.+? .+?\]\$ $/);
                    if (first && write && chunk.endsWith(sshPs1Header || '')) {
                        // we try to strip "\r> ....\n" generated by overflowing stdin
                        let pos = chunk.indexOf('\n');
                        if (pos >= 0) {
                            chunk = chunk.substring(pos + 1);
                        } else {
                            chunk = '';
                        }
                    }
                    if (match) {
                        cb = null;
                        if (!sshPs1Header || !chunk.endsWith(sshPs1Header)) {
                            // first or cd dir
                            sshPs1Header = chunk;
                        } else if (write && chunk.length > sshPs1Header.length) {
                            const leftChunk = chunk.substring(0, chunk.length - sshPs1Header.length)
                            await writer(leftChunk);
                            lastChunkIncomplete = !leftChunk.endsWith('\n');
                        }
                        if (write && lastChunkIncomplete) {
                            // the last program doesn't write "\n", we add it for readability
                            await writer("\n");
                            lastChunkIncomplete = false;
                        }
                        resolve();
                        return true;
                    } else {
                        if (write && chunk) {
                            await writer(chunk);
                            lastChunkIncomplete = !chunk.endsWith('\n');
                        }
                        first = false;
                        return false;
                    }
                };
                if (cmd) {
                    if (write || debug) {
                        writer('$> ' + cmd + "\n");
                    }
                    ssh.stdin.write(cmd + "\n");
                } else if (write) {
                    resolve(); // nothing to do
                }
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
        ].join(';'), false); // drop initial packet
        payload.sender = async (s) => {
            if (!ssh) return;
            if (s == "!ABORT!") {
                await writeLog(`\n$> Execution aborted by user, exiting SSH session gracefully.`);
                await writeLog(`kill ${ssh.pid}: Exit code ` + (await spawnSudoUtil('SHELL_KILL', [ssh.pid + ""])).code);
            } else {
                ssh.stdin.write(s);
            }
        }
    }
    try {
        let firewallStatusCache = undefined;
        let firewallStatus = async () => {
            if (firewallStatusCache === undefined)
                firewallStatusCache = !!nftablesExec.getByUser(await nftablesExec.getParsed(), domaindata['Username'], domaindata['User ID']);
            return firewallStatusCache;
        };
        for (const feature of Array.isArray(config.features) && !config.subdomain ? config.features : []) {
            const key = typeof feature === 'string' ? splitLimit(feature, / /g, 2)[0] : Object.keys(feature)[0];
            const value = typeof feature === 'string' ? feature.substring(key.length + 1) : feature[key];
            const user = domaindata['Username'];
            if (!sandbox) {
                switch (key) {
                    case 'modify':
                        await writeLog("$> virtualmin modify-domain");
                        await virtExec("modify-domain", value, {
                            domain,
                        });
                        if (value.pass) {
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
                        }
                        break;
                    case 'rename':
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
                        await sshExec(`mkdir -p '${domaindata['Home directory']}'`);
                        await writeLog("$> virtualmin disable-domain");
                        await virtExec("disable-domain", value, {
                            domain,
                        });
                        break;
                    case 'enable':
                        await writeLog("$> virtualmin enable-domain");
                        await virtExec("enable-domain", value, {
                            domain,
                        });
                        await spawnSudoUtil("SHELL_SUDO", ["root",
                            "rm", "-f", path.join(domaindata['Home directory'], `disabled_by_virtualmin.html`)
                        ]);
                        break;
                    case 'backup':
                        await writeLog("$> virtualmin backup-domain");
                        await virtExec("backup-domain", value, {
                            user,
                            'all-features': true,
                            'ignore-errors': true,
                        });
                        break;
                    case 'restore':
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
                    default:
                        break;
                }
            }
            switch (key) {
                case 'firewall':
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
                case 'sshpass':
                    if (value === '' || value === 'on') {
                        await writeLog("$> Changing ssh password login to " + (value || 'on'));
                        await virtExec("modify-users", {
                            domain,
                            'all-users': true,
                            'enable': true,
                        });
                    } else if (value === 'off') {
                        await writeLog("$> Changing ssh password login to " + value);
                        await virtExec("modify-users", {
                            domain,
                            'all-users': true,
                            'disable': true,
                        });
                    }
                    break;
                default:
                    await runConfigCodeFeatures(key, value, writeLog, domaindata, sshExec);
                    break;
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

        await sshExec(`export CI=true CONTINUOUS_INTEGRATION=true LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 PIP_PROGRESS_BAR=off BUILDKIT_PROGRESS=plain`, false);
        const passwds = [
            ` USERNAME='${domaindata['Username']}'`,
        ];
        if (domaindata['Password']) {
            passwds.push(` PASSWORD='${domaindata['Password']}'`);
        }
        if (domaindata['Password for mysql']) {
            passwds.push(` MYPASSWD='${domaindata['Password for mysql']}'`);
        }
        if (domaindata['Password or postgres']) {
            passwds.push(` PGPASSWD='${domaindata['Password for postgres']}'`);
        }
        await sshExec(` ` + passwds.join('; '), false);
        const firewallOn = await firewallStatus();
        if (config.subdomain) {
            await runConfigSubdomain(config, domaindata, [config.subdomain, domain].join('.'), sshExec, writeLog, virtExec, firewallOn);
        } else {
            await runConfigSubdomain(config, domaindata, domain, sshExec, writeLog, virtExec, firewallOn, true);
            for (const sub of Array.isArray(config.subdomains) ? config.subdomains : []) {
                if (sub.subdomain) {
                    await runConfigSubdomain(sub, domaindata, [sub.subdomain, domain].join('.'), sshExec, writeLog, virtExec, firewallOn);
                } else {
                    await writeLog(`\nERROR: subdomains require subdomain on each item.`);
                }
            }
        }
    } catch (err) {
        throw err;
    } finally {
        if (ssh) {
            ssh.stdin.write('exit\n');
        }
    }
}
