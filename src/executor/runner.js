import {
    Client
} from 'ssh2';

import {
    escapeShell,
    getDbName,
    getVersion,
    spawnSudoUtil
} from "../util.js";
import {
    iptablesExec
} from "./iptables.js";
import {
    namedExec
} from "./named.js";
import {
    nginxExec
} from "./nginx.js";
import {
    virtualminExec
} from "./virtualmin.js";
const maxExecutionTime = 300000;

/**
 * @param {any} config
 * @param {string} domain
 * @param {(log: string) => Promise<void>} writer
 */
export default async function runConfig(config, domain, writer, sandbox = false) {
    let starttime = Date.now();
    const writeLog = async ( /** @type {string} */ s) => {
        await writer(s + "\n");
        if (Date.now() > starttime + maxExecutionTime)
            throw new Error("Execution has timed out");
    }
    const writeExec = async ( /** @type {{ stdout: string; stderr: string; code: string; }} */ s) => {
        await writeLog(s.stdout);
        if (s.stderr) {
            await writeLog(s.stderr.split('\n').map(x => '! ' + x).join('\n'));
        }
        if (s.code !== null)
            await writeLog("Exit status: " + s.code);
    }
    await writeLog(`DOM Cloud runner v${getVersion()} in ${domain} at ${new Date(starttime).toISOString()}`);
    if (Array.isArray(config.features) && config.features.length > 0 && config.features[0].create && !sandbox) {
        // create new domain
        await writeLog("$> virtualmin create-domain");
        await writeExec(await virtualminExec.execFormatted("create-domain", config.features[0].create, {
            domain,
            dir: true,
            webmin: true,
            unix: true,
            'limits-from-plan': true,
            'virtualmin-nginx': true,
            'virtualmin-nginx-ssl': true,
        }));
        // sometimes we need to wait for the domain to be created
        await new Promise((resolve, reject) => {
            setTimeout(resolve, 5000);
        });
        await new Promise((resolve, reject) => {
            let tries = 0;
            const check = () => {
                virtualminExec.execFormatted("list-domains", {
                    domain
                }).then(async (s) => {
                    if (s.code === 0) {
                        resolve();
                    } else {
                        if (++tries < 10) {
                            setTimeout(check, 3000);
                        } else {
                            reject("Domain not found after 10 tries");
                        }
                    }
                }).catch(reject);
            }
            check();
        });
        // FOR SOME REASON IN MY SERVER, NGINX SUDDENLY STOPPED WORKING
        console.log('start emerg nginx ', await spawnSudoUtil('NGINX_START'));
    }
    let domaindata = await virtualminExec.getDomainInfo(domain);
    if (!domaindata) {
        await writeLog("Server is not exist. Finishing execution");
        return;
    }
    /**
     * @type {Client}
     */
    let ssh;
    let sshExec;
    if (process.env.NODE_ENV === 'development') {
        sshExec = async (cmd) => {
            await writeLog(cmd);
        }
    } else {
        ssh = new Client();
        // connect
        await new Promise((resolve, reject) => {
            ssh.on('ready', resolve);
            ssh.on('error', reject);
            ssh.connect({
                host: 'localhost',
                username: domaindata['Username'],
                password: domaindata['Password'],
                readyTimeout: 10000
            });
        });
        // stream
        /**
         * @type {import('ssh2').Channel}
         */
        const sshStream = await new Promise((resolve, reject) => {
            ssh.shell((err, stream) => {
                if (err)
                    reject(err);
                else
                    resolve(stream);
            });
        });
        sshStream.on('close', () => ssh.end());
        let cb = null;
        sshStream.on('data', function (chunk) {
            if (cb)
                cb(chunk.toString());
        })
        sshExec = ( /** @type {string} */ cmd) => {
            // SSH prone to wait indefinitely, so we need to set a timeout
            return Promise.race([
                new Promise((resolve, reject) => {
                    setTimeout(reject, Math.max(0, maxExecutionTime - (Date.now() - starttime)),
                        "Execution has timed out");
                }),
                new Promise((resolve, reject) => {
                    if (Date.now() > starttime + maxExecutionTime)
                        return reject("Execution has timed out");
                    let res = '';
                    cb = ( /** @type {string} */ chunk) => {
                        res += chunk;
                        if (chunk.match(/\[.+?\@.+? .+?\]\$/)) {
                            cb = null;
                            res = res.replace(/\[.+?\@.+? .+?\]\$/, '');
                            res = res.replace(/\0/g, '');
                            resolve('$> ' + res.trim());
                        }
                    };
                    if (cmd)
                        sshStream.write(cmd + "\n");
                })
            ]);
        }
        await sshExec(''); // drop initial message
    }
    try {
        if (config.root) {
            // moved to config.features
            config.features = (config.features || []).concat([{
                root: config.root
            }]);
            delete config.root;
        }
        if (Array.isArray(config.features)) {
            for (const feature of config.features) {
                const key = typeof feature === 'string' ? feature.split(' ', 2)[0] : Object.keys(feature)[0];
                const value = typeof feature === 'string' ? feature.substring(key.length + 1) : feature[key];
                const isFeatureEnabled = ( /** @type {string} */ f) => {
                    return domaindata['Features'].includes(f);
                }
                let enabled;
                if (!sandbox) {
                    switch (key) {
                        case 'modify':
                            await writeLog("$> virtualmin modify-domain");
                            await writeExec(await virtualminExec.execFormatted("modify-domain", value, {
                                domain,
                            }));
                            // in case if we change domain name
                            if (value && value.newdomain)
                                domain = value.newdomain;
                            domaindata = await virtualminExec.getDomainInfo(domain);
                            break;
                        case 'disable':
                            await writeLog("$> virtualmin disable-domain");
                            await writeExec(await virtualminExec.execFormatted("disable-domain", value, {
                                domain,
                            }));
                            break;
                        case 'enable':
                            await writeLog("$> virtualmin enable-domain");
                            await writeExec(await virtualminExec.execFormatted("enable-domain", value, {
                                domain,
                            }));
                            break;
                        case 'delete':
                            await writeLog("$> virtualmin delete-domain");
                            await writeExec(await virtualminExec.execFormatted("delete-domain", value, {
                                domain,
                            }));
                            // no need to do other stuff
                            return;
                        default:
                            break;
                    }
                }
                switch (key) {
                    case 'mysql':
                        enabled = isFeatureEnabled('mysql');
                        if (value === "off") {
                            await writeLog("$> Disabling MySQL");
                            if (enabled) {
                                await writeExec(await virtualminExec.execFormatted("disable-feature", value, {
                                    domain,
                                    mysql: true,
                                }));
                            } else {
                                await writeLog("Already disabled");
                            }
                        } else {
                            let dbname = null;
                            if (!enabled) {
                                await writeLog("$> Enabling MySQL");
                                await writeExec(await virtualminExec.execFormatted("enable-feature", value, {
                                    domain,
                                    mysql: true,
                                }));
                                dbname = config.subdomain || "db";
                            }
                            if (value.startsWith("create ")) {
                                dbname = value.substr("create ".length);
                            }
                            if (!dbname) {
                                break;
                            }
                            dbname = getDbName(domaindata['Username'], dbname);
                            await writeLog(`$> Creating db instance ${dbname} on MySQL`);
                            await writeExec(await virtualminExec.execFormatted("create-database", {
                                domain,
                                name: dbname,
                                type: 'mysql',
                            }));
                        }
                        break;
                    case 'postgres':
                    case 'postgresql':
                        enabled = isFeatureEnabled('postgres');
                        if (value === "off") {
                            await writeLog("$> Disabling PostgreSQL");
                            if (enabled) {
                                await writeExec(await virtualminExec.execFormatted("disable-feature", value, {
                                    domain,
                                    postgres: true,
                                }));
                            } else {
                                await writeLog("Already disabled");
                            }
                        } else {
                            let dbname = null;
                            if (!enabled) {
                                await writeLog("$> Enabling PostgreSQL");
                                await writeExec(await virtualminExec.execFormatted("enable-feature", value, {
                                    domain,
                                    postgres: true,
                                }));
                                dbname = config.subdomain || "db";
                            }
                            if (value.startsWith("create ")) {
                                dbname = value.substr("create ".length);
                            }
                            if (!dbname) {
                                break;
                            }
                            dbname = getDbName(domaindata['Username'], dbname);
                            await writeLog(`$> Creating db instance ${dbname} on PostgreSQL`);
                            await writeExec(await virtualminExec.execFormatted("create-database", {
                                domain,
                                name: dbname,
                                type: 'postgres',
                            }));
                        }
                        break;
                    case 'dns':
                        enabled = isFeatureEnabled('dns');
                        if (value === "off") {
                            await writeLog("$> Disabling DNS");
                            if (enabled) {
                                await writeExec(await virtualminExec.execFormatted("disable-feature", value, {
                                    domain,
                                    dns: true,
                                }));
                            } else {
                                await writeLog("Already disabled");
                            }
                        } else if (value === 'sync') {
                            await writeLog("$> Syncing Slave DNS");
                            namedExec.resync(domain);
                        } else {
                            if (!enabled) {
                                await writeLog("$> Enabling DNS");
                                await writeExec(await virtualminExec.execFormatted("enable-feature", value, {
                                    domain,
                                    dns: true,
                                }));
                            }
                            if (Array.isArray(value)) {
                                for (const obj of value) {
                                    if (obj.add) {
                                        var o = ('' + obj.add).split(' ', 3);
                                        if (o.length < 3) continue;
                                        await writeLog(`$> Adding DNS Record of type ${o[1].toUpperCase()}`);
                                        // @ts-ignore
                                        await writeExec(await namedExec.add(domain, ...o));
                                    }
                                    if (obj.del) {
                                        var o = ('' + obj.del).split(' ', 3);
                                        if (o.length < 3) continue;
                                        await writeLog(`$> Removing DNS Record of type ${o[1].toUpperCase()}`);
                                        // @ts-ignore
                                        await writeExec(await namedExec.del(domain, ...o));
                                    }
                                }
                            }
                        }
                        break;
                    case 'firewall':
                        if (value === '' || value === 'on') {
                            await writeLog("$> changing firewall protection to " + value);
                            await writeLog(await iptablesExec.setAddUser(domaindata['Username']));
                        } else if (value === 'off') {
                            await writeLog("$> changing firewall protection to " + value);
                            await writeLog(await iptablesExec.setDelUser(domaindata['Username']));
                        }
                        break;
                    case 'python':
                        await writeLog("$> changing Python engine to " + value);
                        await writeLog(await sshExec("curl -sS https://webinstall.dev/pyenv | bash"));
                        await writeLog(await sshExec("pyenv install -v"));
                        await writeLog(await sshExec("pyenv global " + value));
                        await writeLog(await sshExec("python --version"));
                        break;
                    case 'node':
                        await writeLog("$> changing Node engine to " + value);
                        await writeLog(await sshExec(`curl -sS https://webinstall.dev/node@${value} | bash`));
                        await writeLog(await sshExec("node --version"));
                        break;
                    case 'ruby':
                        await writeLog("$> changing Ruby engine to " + value);
                        await writeLog(await sshExec(`curl -sSL https://rvm.io/mpapis.asc | gpg --import -`));
                        await writeLog(await sshExec(`curl -sSL https://rvm.io/pkuczynski.asc | gpg --import -`));
                        await writeLog(await sshExec(`curl -sSL https://get.rvm.io | bash -s ${value}`));
                        await writeLog(await sshExec("ruby --version"));
                        break;
                    default:
                        break;
                }
            }
        }
        await sshExec('unset HISTFILE'); // https://stackoverflow.com/a/9039154/3908409
        await writeLog(await sshExec(`mkdir -p ${domaindata['Home directory']}/public_html && cd "$_"`));
        if (config.source) {
            if (typeof config.source === 'string') {
                config.source = {
                    url: config.source,
                };
            }
            const source = config.source;
            if (source.url !== '*' && !source.url.match(/^(?:(?:https?|ftp):\/\/)?([^\/]+)/)) {
                throw new Error("Invalid source URL");
            }
            if (config.directory && !source.directory) {
                source.directory = config.directory;
                delete config.directory;
            }
            var url = new URL(source.url);
            if (!source.type || !['clone', 'extract'].includes(source.type)) {
                if (url.pathname.endsWith('.git') || url.hostname.match(/^(www\.)?(github|gitlab)\.com$/)) {
                    source.type = 'clone';
                } else {
                    source.type = 'extract';
                }
            }
            let executedCMD = [`rm -rf * .* 2>/dev/null`];
            let executedCMDNote = '';
            let firewallStatus = !!iptablesExec.getByUsers(await iptablesExec.getParsed(), domaindata['Username'])[0];
            if (source.url === '*') {
                // we just delete them all
                executedCMDNote = 'Clearing files';
            } else if (source.type === 'clone') {
                if (!source.branch && source.directory) {
                    source.branch = source.directory;
                } else if (!source.branch && url.hash) {
                    source.branch = url.hash.substr(1);
                    url.hash = '';
                }
                if (source.shallow !== false) {
                    source.shallow = true;
                }
                executedCMD.push(`git clone ${escapeShell(url.toString())}` +
                    `${source.branch ? ` -b ${escapeShell(source.branch)}`  : ''}` +
                    `${source.shallow ? ` --depth 1`  : ''}` +
                    `${source.submodules ? ` --recurse-submodules` : ''}` + ' .');
                executedCMDNote = 'Cloning files';
            } else if (source.type === 'extract') {
                executedCMD.push(`wget -O _.zip ` + escapeShell(url.toString()));
                executedCMD.push(`unzip -q -o _.zip ; rm _.zip ; chmod -R 0750 * .*`);
                if (source.directory) {
                    executedCMD.push(`mv ${escapeShell(source.directory)}/{.,}* .`);
                    executedCMD.push(`rm -rf ${escapeShell(source.directory)}`);
                }
                executedCMDNote = 'Downloading files';
            }
            if (firewallStatus) {
                await iptablesExec.setDelUser(domaindata['Username']);
            }
            await writeLog("$> " + executedCMDNote);
            for (const exec of executedCMD) {
                await writeLog(await sshExec(exec));
            }
            if (firewallStatus) {
                await iptablesExec.setAddUser(domaindata['Username']);
            }
        }
        if (config.subdomain) {
            await runConfigSubdomain(config, domaindata, [config.subdomain, domain].join('.'), sshExec, writeLog, writeExec);
        } else {
            await runConfigSubdomain(config, domaindata, domain, sshExec, writeLog, writeExec, true);
            if (config.subdomains) {
                for (const sub of config.subdomains) {
                    await runConfigSubdomain(sub, domaindata, [sub.subdomain, domain].join('.'), sshExec, writeLog, writeExec);
                }
            }
        }
    } catch (err) {
        throw err;
    } finally {
        if (ssh && ssh.destroy) {
            ssh.destroy();
        }
    }
}

/**
 * @param {{features: any;commands: any;nginx: any;}} config
 * @param {{[x: string]: any}} domaindata
 * @param {string} subdomain
 * @param {{(cmd: string): Promise<any>}} sshExec
 * @param {{(s: string): Promise<void>}} writeLog
 * @param {{ (s: { stdout: string; stderr: string; code: string; }): Promise<void> }} writeExec
 */
export async function runConfigSubdomain(config, domaindata, subdomain, sshExec, writeLog, writeExec, stillroot = false) {
    if (Array.isArray(config.features)) {
        await writeLog("$> Applying features");
        for (const feature of config.features) {
            const key = typeof feature === 'string' ? feature.split(' ', 2)[0] : Object.keys(feature)[0];
            const value = typeof feature === 'string' ? feature.substring(key.length + 1) : feature[key];
            switch (key) {
                case 'php':
                    await writeLog("$> changing PHP engine to " + value);
                    await writeExec(await virtualminExec.execFormatted("modify-web", {
                        domain: subdomain,
                        'php-version': value,
                    }));
                    break;
                case 'ssl':
                    await writeLog("$> getting let's encrypt");
                    await writeExec(await virtualminExec.execFormatted("generate-letsencrypt-cert", {
                        domain: subdomain,
                        'renew': 2,
                        'web': true,
                    }));
                    break;
                case 'root':
                    await writeLog("$> changing root folder");
                    await writeExec(await virtualminExec.execFormatted("modify-web", {
                        domain: subdomain,
                        'document-dir': value,
                    }));
                    break;
            }
        }
    }
    if (config.commands) {
        await sshExec(`DATABASE='${getDbName(domaindata['Username'])}' ; DOMAIN='${subdomain}' ; USERNAME='${domaindata['Username']}' PASSWORD='${domaindata['Password']}'`);
        await sshExec(`mkdir -p ${domaindata['Home directory']}${stillroot ? '' : `/domains/${subdomain}`}/public_html && cd "$_"`);
        for (const cmd of config.commands) {
            await writeLog(await sshExec(cmd));
        }
    }

    if (config.nginx) {
        await writeLog("$> Applying nginx config on " + subdomain);
        await writeLog(await nginxExec.set(subdomain, config.nginx));
    }
}