import {
    escapeShell,
    getDbName,
    getRevision,
    getVersion,
    spawnSudoUtil,
    spawnSudoUtilAsync
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

// TODO: Need to able to customize this
const maxExecutionTime = 600000;

/**
 * @param {any} config
 * @param {string} domain
 * @param {(log: string) => Promise<void>} writer
 */
export default async function runConfig(config, domain, writer, sandbox = false) {
    const writeLog = async ( /** @type {string} */ s) => {
        await writer(s + "\n");
    }
    const virtExec = (program, ...opts) => {
        return new Promise((resolve, reject) => {
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
    }
    await writeLog(`DOM Cloud runner v${getVersion()} ref ${getRevision()} in ${domain} at ${new Date().toISOString()}`);
    if (Array.isArray(config.features) && config.features.length > 0 && config.features[0].create && !sandbox) {
        // create new domain
        await writeLog("$> virtualmin create-domain");
        await writeLog("Creating virtual domain. This will take a moment...");
        await virtExec("create-domain", config.features[0].create, {
            dir: true,
            'virtualmin-nginx': true,
            'virtualmin-nginx-ssl': true,
            webmin: !config.features[0].create.parent,
            unix: !config.features[0].create.parent,
        });
        // sometimes we need to wait for the domain to be created
        await writeLog("$> virtualmin list-domains");
        await new Promise((resolve, reject) => {
            setTimeout(resolve, 3000);
        });
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
    let domaindata = await virtualminExec.getDomainInfo(domain);
    if (!domaindata) {
        await writeLog("\n$> Server is not exist. Finishing execution");
        return;
    }
    /**
     * @type {import('child_process').ChildProcessWithoutNullStreams}
     */
    let ssh;
    let sshExec;
    if (process.env.NODE_ENV === 'development') {
        sshExec = async (cmd) => {
            await writeLog(cmd);
        }
    } else {
        ssh = spawnSudoUtilAsync('SHELL_INTERACTIVE', [domaindata['Username']]);
        let cb = null;
        setTimeout(async () => {
            if (ssh == null) return;
            // SSH prone to wait indefinitely, so we need to set a timeout
            await writeLog(`\n$> Execution took more than ${maxExecutionTime / 1000}s, exiting gracefully.`);
            await writeLog(`kill ${ssh.pid}: Exit code ` + (await spawnSudoUtil('SHELL_KILL', [ssh.pid + ""])).code);
            ssh = null;
            if (cb) cb('', 124);
        }, maxExecutionTime).unref();
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
            if (cb) {
                ssh = null;
                cb('', code);
            }
        });
        sshExec = ( /** @type {string} */ cmd, write = true) => {
            return new Promise((resolve, reject) => {
                if (!ssh) return reject("shell has terminated already");
                cb = ( /** @type {string} */ chunk, code) => {
                    if (!ssh) {
                        if (code) {
                            return writeLog("Exit status: " + (code) + "\n")
                                .then(() => reject(`shell has terminated.`));
                        } else {
                            return resolve();
                        }
                    }
                    chunk = chunk.replace(/\0/g, '');
                    let match = chunk.match(/\[.+?\@.+? .+?\]\$/);
                    if (match) {
                        cb = null;
                        chunk = chunk.replace(/\x1b.+?$/, '').trimEnd();
                        if (write && chunk) {
                            writer(chunk + "\n");
                        }
                        resolve();
                        return true;
                    } else {
                        if (write && chunk) {
                            writer(chunk);
                        }
                        return false;
                    }
                };
                if (cmd) {
                    if (write) {
                        writer('$> ' + cmd + "\n");
                    }
                    ssh.stdin.write(cmd + "\n");
                } else if (write) {
                    resolve(); // nothing to do
                }
            })
        }
        await sshExec('', false); // drop initial message
        await sshExec('set -e', false); // early exit on error
    }
    try {
        if (config.root) {
            // moved to config.features
            config.features = (config.features || []).concat([{
                root: config.root
            }]);
            delete config.root;
        }
        let firewallStatusCache = undefined;
        let firewallStatus = async () => {
            if (firewallStatusCache === undefined)
                firewallStatusCache = !!iptablesExec.getByUsers(await iptablesExec.getParsed(), domaindata['Username'])[0];
            return firewallStatusCache;
        };
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
                            await virtExec("modify-domain", value, {
                                domain,
                            });
                            break;
                        case 'rename':
                            if (value && value["new-user"] && await firewallStatus()) {
                                await iptablesExec.setDelUser(domaindata['Username']);
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
                                await iptablesExec.setAddUser(value["new-user"]);
                            }
                            domaindata = await virtualminExec.getDomainInfo(domain);
                            break;
                        case 'disable':
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
                            break;
                        case 'delete':
                            await writeLog("$> virtualmin delete-domain");
                            await virtExec("delete-domain", value, {
                                user: domaindata['Username'],
                            });
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
                                await virtExec("disable-feature", value, {
                                    domain,
                                    mysql: true,
                                });
                            } else {
                                await writeLog("Already disabled");
                            }
                        } else {
                            let dbname = null;
                            if (!enabled) {
                                await writeLog("$> Enabling MySQL");
                                await virtExec("enable-feature", value, {
                                    domain,
                                    mysql: true,
                                });
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
                            await virtExec("create-database", {
                                domain,
                                name: dbname,
                                type: 'mysql',
                            });
                        }
                        break;
                    case 'postgres':
                    case 'postgresql':
                        enabled = isFeatureEnabled('postgres');
                        if (value === "off") {
                            await writeLog("$> Disabling PostgreSQL");
                            if (enabled) {
                                await virtExec("disable-feature", value, {
                                    domain,
                                    postgres: true,
                                });
                            } else {
                                await writeLog("Already disabled");
                            }
                        } else {
                            let dbname = null;
                            if (!enabled) {
                                await writeLog("$> Enabling PostgreSQL");
                                await virtExec("enable-feature", value, {
                                    domain,
                                    postgres: true,
                                });
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
                            await virtExec("create-database", {
                                domain,
                                name: dbname,
                                type: 'postgres',
                            });
                        }
                        break;
                    case 'dns':
                        enabled = isFeatureEnabled('dns');
                        if (value === "off") {
                            await writeLog("$> Disabling DNS");
                            if (enabled) {
                                await virtExec("disable-feature", value, {
                                    domain,
                                    dns: true,
                                });
                            } else {
                                await writeLog("Already disabled");
                            }
                        } else {
                            if (!enabled) {
                                await writeLog("$> Enabling DNS and applying records");
                                await virtExec("enable-feature", value, {
                                    domain,
                                    dns: true,
                                });
                            } else {
                                await writeLog("$> Applying DNS records");
                            }
                            if (Array.isArray(value)) {
                                for (let i = 0; i < value.length; i++) {
                                    if (typeof value[i] === 'string') {
                                        if (!value[i].startsWith("add ") && !value[i].startsWith("del ")) {
                                            value[i] = `add ${value[i]}`;
                                        }
                                        const values = (value[i] + '').split(' ', 4);
                                        if (values.length == 4) {
                                            value[i] = {
                                                action: values[0].toLowerCase() === 'del' ? 'del' : 'add',
                                                type: values[1].toLowerCase(),
                                                domain: values[2].toLowerCase(),
                                                value: values[3],
                                            }
                                        }
                                    }
                                }
                                await writeLog(await namedExec.set(domain, value));
                            }
                        }
                        break;
                    case 'firewall':
                        if (value === '' || value === 'on') {
                            await writeLog("$> changing firewall protection to " + (value || 'on'));
                            await writeLog(await iptablesExec.setAddUser(domaindata['Username']));
                            firewallStatusCache = true;
                        } else if (value === 'off') {
                            await writeLog("$> changing firewall protection to " + value);
                            await writeLog(await iptablesExec.setDelUser(domaindata['Username']));
                            firewallStatusCache = false;
                        }
                        break;
                    case 'python':
                        await writeLog("$> changing Python engine to " + (value || 'latest'));
                        await sshExec("command -v pathman &> /dev/null || (curl -sS https://webinstall.dev/pathman | bash) && source ~/.bash_profile");
                        await sshExec("command -v pyenv &> /dev/null || (curl -sS https://webinstall.dev/pyenv | bash) && source ~/.bash_profile");
                        await sshExec(`pyenv install ${value ? value + ':latest' : '3:latest'} -s`);
                        await sshExec(`pyenv global $(pyenv versions --bare | tail -n 1)`);
                        await sshExec("python --version");
                        break;
                    case 'node':
                        await writeLog("$> changing Node engine to " + (value || 'lts'));
                        await sshExec("command -v pathman &> /dev/null || (curl -sS https://webinstall.dev/pathman | bash) && source ~/.bash_profile");
                        await sshExec("pathman add .local/opt/node/bin && source ~/.bash_profile");
                        await sshExec(`curl -sS https://webinstall.dev/node@${value || 'lts'} | bash`);
                        await sshExec("command -v corepack &> /dev/null || npm i -g corepack && corepack enable");
                        await sshExec("node --version");
                        break;
                    case 'ruby':
                        await writeLog("$> changing Ruby engine to " + value);
                        await sshExec(`curl -sSL https://rvm.io/mpapis.asc | gpg --import -`);
                        await sshExec(`curl -sSL https://rvm.io/pkuczynski.asc | gpg --import -`);
                        await sshExec(`curl -sSL https://get.rvm.io | bash -s ${value}`);
                        await sshExec("ruby --version");
                        break;
                    default:
                        break;
                }
            }
        }
        await sshExec('unset HISTFILE TERM', false); // https://stackoverflow.com/a/9039154/3908409
        await sshExec(`export CI=true CONTINUOUS_INTEGRATION=true DEBIAN_FRONTEND=noninteractive LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`, false);
        await sshExec(`DATABASE='${getDbName(domaindata['Username'])}' USERNAME='${domaindata['Username']}' PASSWORD='${domaindata['Password']}'`, false);
        if (config.subdomain) {
            await runConfigSubdomain(config, domaindata, [config.subdomain, domain].join('.'), sshExec, writeLog, virtExec, await firewallStatus());
        } else {
            await runConfigSubdomain(config, domaindata, domain, sshExec, writeLog, virtExec, await firewallStatus(), true);
            if (Array.isArray(config.subdomains)) {
                for (const sub of config.subdomains) {
                    await runConfigSubdomain(sub, domaindata, [sub.subdomain, domain].join('.'), sshExec, writeLog, virtExec, await firewallStatus());
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

/**
 * @param {{source: any;features: any;commands: any;nginx: any;envs: any,directory:any}} config
 * @param {{[x: string]: any}} domaindata
 * @param {string} subdomain
 * @param {{(cmd: string, write?: boolean): Promise<any>}} sshExec
 * @param {{(s: string): Promise<void>}} writeLog
 * @param {{ (program: any, ...opts: any[]): Promise<any> }} virtExec
 * @param {boolean} firewallOn
 * @param {stillroot} firewallOn
 */
export async function runConfigSubdomain(config, domaindata, subdomain, sshExec, writeLog, virtExec, firewallOn, stillroot = false) {
    const featureRunner = async (feature) => {
        const key = typeof feature === 'string' ? feature.split(' ', 2)[0] : Object.keys(feature)[0];
        const value = typeof feature === 'string' ? feature.substring(key.length + 1) : feature[key];
        switch (key) {
            case 'php':
                await writeLog("$> changing PHP engine to " + value);
                await virtExec("modify-web", {
                    domain: subdomain,
                    'php-version': value,
                });
                break;
            case 'ssl':
                await writeLog("$> getting let's encrypt");
                await virtExec("generate-letsencrypt-cert", {
                    domain: subdomain,
                    'renew': 2,
                    'web': true,
                });
                break;
            case 'root':
                await writeLog("$> changing root folder");
                await virtExec("modify-web", {
                    domain: subdomain,
                    'document-dir': value,
                });
                break;
            case 'github':
            case 'gitlab':
            case 'bitbucket':
                let HOST = key.toUpperCase();
                if (config.envs.GITHUB_USER && config.envs.GITHUB_TOKEN) {
                    await writeLog(`$> running git ${value} with user credentials`);
                    await sshExec(`${HOST}_USER=${config.envs[`${HOST}_USER`]} ${HOST}_TOKEN=${config.envs[`${HOST}_TOKEN`]}`, false);
                    await sshExec(`git -c credential.helper='!f() { sleep 1; echo "username=\${${HOST}_USER}"; echo "password=\${${HOST}_TOKEN}"; }; f' ${value}`);
                } else {
                    await writeLog(`$> git ${value} ignored due no ${HOST}_USER and ${HOST}_TOKEN`);
                }
                break;
        }
    }
    await sshExec(`export DOMAIN='${subdomain}'`, false);
    await sshExec(`mkdir -p ${domaindata['Home directory']}${stillroot ? '' : `/domains/${subdomain}`}/public_html && cd "$_"`);
    if (config.source) {
        if (typeof config.source === 'string') {
            config.source = {
                url: config.source,
            };
        }
        const source = config.source;
        if (source.url !== 'clear' && !source.url.match(/^(?:(?:https?|ftp):\/\/)?([^\/]+)/)) {
            throw new Error("Invalid source URL");
        }
        if (config.directory && !source.directory) {
            source.directory = config.directory;
            delete config.directory;
        }
        var url;
        if (source.url !== 'clear') {
            url = new URL(source.url);
            if (!source.type || !['clone', 'extract'].includes(source.type)) {
                if (url.pathname.endsWith('.git') || (url.hostname.match(/^(www\.)?(github|gitlab)\.com$/) && !url.pathname.endsWith('.zip'))) {
                    source.type = 'clone';
                } else {
                    source.type = 'extract';
                }
            }
        }
        let executedCMD = [`rm -rf ..?* .[!.]* *`];
        let executedCMDNote = '';
        if (source.url === 'clear') {
            // we just delete them all
            executedCMDNote = 'Clearing files';
        } else if (source.type === 'clone') {
            if (!source.branch && source.directory) {
                source.branch = source.directory;
            } else if (!source.branch && url.hash) {
                source.branch = url.hash.substring(1);
                url.hash = '';
            }
            if (!source.credential && config.envs) {
                for (const HOST of ['GITHUB', 'GITLAB', 'BITBUCKET']) {
                    if (url.hostname.includes(HOST.toLowerCase()) && config.envs[`${HOST}_USER`] && config.envs[`${HOST}_TOKEN`]) {
                        await sshExec(`${HOST}_USER=${config.envs[`${HOST}_USER`]} ${HOST}_TOKEN=${config.envs[`${HOST}_TOKEN`]}`, false);
                        executedCMD.push(`printf "#!/bin/bash\\necho username=$${HOST}_USER\\necho password=$${HOST}_TOKEN" > ~/.git-credential-helper.sh`);
                        executedCMD.push(`git config credential.helper "/bin/bash ~/.git-credential-helper.sh"`);
                    }
                }
            }
            executedCMD.push(`git clone ${escapeShell(url.toString())}` +
                `${source.branch ? ` -b ${escapeShell(source.branch)}` : ''}` +
                `${source.shallow ? ` --depth 1` : ''}` +
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
        if (firewallOn) {
            await iptablesExec.setDelUser(domaindata['Username']);
        }
        await writeLog("$> " + executedCMDNote);
        for (const exec of executedCMD) {
            await sshExec(exec);
        }
        if (firewallOn) {
            await iptablesExec.setAddUser(domaindata['Username']);
        }
    }
    if (config.commands) {
        if (config.envs) {
            let entries = Object.entries(config.envs);
            if (entries.length > 0)
                await sshExec(entries.map(([k, v]) => `${k}='${v}'`).join(' '), false);
        }
        for (const cmd of config.commands) {
            if (typeof cmd === 'string') {
                await sshExec(cmd);
            } else if (typeof cmd === 'object') {
                if (cmd.command) {
                    await sshExec(cmd.command, cmd.write === false ? false : true);
                } else if (cmd.feature) {
                    await featureRunner(cmd.feature);
                }
            }
        }
    }

    if (Array.isArray(config.features)) {
        await writeLog("$> Applying features");
        for (const feature of config.features) {
            await featureRunner(feature);
        }
    }

    if (config.nginx) {
        await writeLog("$> Applying nginx config on " + subdomain);
        await writeLog(await nginxExec.set(subdomain, config.nginx));
    }
}