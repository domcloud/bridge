import path from "path";
import {
    detectCanShareSSL,
    escapeShell,
    getDbName,
    getLtsPhp,
    getPythonVersion,
    getRevision,
    getRubyVersion,
    getVersion,
    spawnSudoUtil,
    spawnSudoUtilAsync,
    splitLimit
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
const maxExecutionTime = 900000;

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
        await virtExec("create-domain", config.features[0].create, process.env.MODE === 'dev' ? {
            dir: true,
            webmin: true,
            unix: true,
        } : {
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
    let domaindata
    try {
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
        let firewallStatusCache = undefined;
        let firewallStatus = async () => {
            if (firewallStatusCache === undefined)
                firewallStatusCache = !!iptablesExec.getByUsers(await iptablesExec.getParsed(), domaindata['Username'])[0];
            return firewallStatusCache;
        };
        if (Array.isArray(config.features)) {
            for (const feature of config.features) {
                const key = typeof feature === 'string' ? splitLimit(feature, / /g, 2)[0] : Object.keys(feature)[0];
                const value = typeof feature === 'string' ? feature.substring(key.length + 1) : feature[key];
                const isFeatureEnabled = ( /** @type {string} */ f) => {
                    return domaindata['Features'].includes(f);
                }
                let enabled, arg;
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
                        case 'backup':
                            await writeLog("$> virtualmin backup-domain");
                            await virtExec("backup-domain", value, {
                                domain,
                                'all-features': !value.features,
                                'as-owner': true,
                            });
                            break;
                        case 'restore':
                            await writeLog("$> virtualmin restore-domain");
                            await virtExec("restore-domain", value, {
                                domain,
                                'reuid': true,
                            });
                            break;
                        case 'delete':
                            await writeLog("$> virtualmin delete-domain");
                            await virtExec("delete-domain", value, {
                                user: domaindata['Username'],
                            });
                            await spawnSudoUtil('PHPFPM_CLEAN', domaindata['ID']);
                            // no need to do other stuff
                            return;
                        default:
                            break;
                    }
                }
                switch (key) {
                    case 'mysql':
                    case 'mariadb':
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
                        if (process.env.MODE === 'dev') {
                            break;
                        }
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
                                        const values = splitLimit(value[i] + '', / /g, 4);
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
                    case 'ftp':
                        enabled = isFeatureEnabled('ftp');
                        if (value === "off") {
                            await writeLog("$> Disabling FTP");
                            if (enabled) {
                                await virtExec("disable-feature", value, {
                                    domain,
                                    ftp: true,
                                });
                            } else {
                                await writeLog("Already disabled");
                            }
                        } else {
                            if (!enabled) {
                                await writeLog("$> Enabling FTP");
                                await virtExec("enable-feature", value, {
                                    domain,
                                    ftp: true,
                                });
                            } else {
                                await writeLog("FTP is already enabled");
                            }
                        }
                        break;
                    case 'firewall':
                        if (process.env.MODE === 'dev') {
                            break;
                        }
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
                        arg = value;
                        if (value == 'off') {
                            await writeLog("$> removing Python engine");
                            await sshExec("rm -rf ~/.pyenv");
                            await sshExec("pathman remove ~/.pyenv/bin && pathman remove ~/.pyenv/shims; source ~/.bashrc");
                            await sshExec("sed -i '/pyenv/d' ~/.bashrc");
                        } else {
                            const parg = getPythonVersion(value);
                            await writeLog("$> changing Python engine to " + parg.version);
                            await sshExec("command -v pathman &> /dev/null || (curl -sS https://webinstall.dev/pathman | bash); source ~/.bashrc");
                            await sshExec("command -v pyenv &> /dev/null || (curl -sS https://webinstall.dev/pyenv | bash); source ~/.bashrc");
                            if (parg.binary) {
                                await sshExec(`cd ~/tmp && mkdir -p ~/.pyenv/versions/${parg.version}`);
                                await sshExec(`wget -O python.tar.zst "${parg.binary}" && tar -axf python.tar.zst && rm $_`);
                                await sshExec(`mv ~/tmp/python/install/* ~/.pyenv/versions/${parg.version} || true ; rm -rf ~/tmp/python`);
                                await sshExec(`(cd ~/.pyenv/versions/${parg.version}/bin && ln -s python3 python) || true`);
                                await sshExec("cd ~/public_html", false);
                            } else {
                                await sshExec(`pyenv install ${parg.version} -s`);
                            }
                            await sshExec(`pyenv global ${parg.version.replace(":latest", "")} ; source ~/.bashrc`);
                            await sshExec("python --version");
                        }
                        break;
                    case 'node':
                        arg = value;
                        if (arg == 'off') {
                            await writeLog("$> removing Node engine");
                            await sshExec("rm -rf ~/.local/opt/node-* ~/.local/opt/node ~/Downloads/webi/node");
                            await sshExec("rm -rf ~/.cache/yarn ~/.cache/node ~/.config/yarn ~/.npm");
                            await sshExec("pathman remove ~/.local/opt/node/bin ; source ~/.bashrc");
                        } else {
                            if (value == "latest" || value == "current") {
                                arg = ""
                            } else if (!value || value == "stable") {
                                arg = "@lts"
                            } else {
                                arg = "@" + value
                            }
                            await writeLog("$> changing Node engine to " + (value || 'lts'));
                            await sshExec("command -v pathman &> /dev/null || (curl -sS https://webinstall.dev/pathman | bash) ; source ~/.bashrc");
                            await sshExec("pathman add .local/opt/node/bin ; source ~/.bashrc");
                            await sshExec(`curl -sS https://webinstall.dev/node${arg} | bash`);
                            await sshExec("command -v corepack &> /dev/null || npm i -g corepack && corepack enable");
                            await sshExec("node --version");
                        }
                        break;
                    case 'deno':
                        arg = value;
                        if (arg == 'off') {
                            await writeLog("$> removing Deno engine");
                            await sshExec("rm -rf ~/.local/opt/deno-* ~/.deno ~/.local/bin/deno ~/Downloads/webi/deno");
                            await sshExec("pathman remove ~/.deno/bin/ ; source ~/.bashrc");
                        } else {
                            if (value == "latest" || value == "current") {
                                arg = ""
                            } else if (!value || value == "lts") {
                                arg = "@stable"
                            } else {
                                arg = "@" + value
                            }
                            await writeLog("$> changing Deno engine to " + (value || 'stable'));
                            await sshExec("command -v pathman &> /dev/null || (curl -sS https://webinstall.dev/pathman | bash) ; source ~/.bashrc");
                            await sshExec(`curl -sS https://webinstall.dev/deno${arg} | bash`);
                            await sshExec("mkdir -p ~/.deno/bin/ && pathman add $_ ; source ~/.bashrc");
                            await sshExec("deno --version");
                        }
                        break;
                    case 'go':
                    case 'golang':
                        arg = value;
                        if (arg == 'off') {
                            await writeLog("$> removing Golang engine");
                            await sshExec("chmod -R 0700 ~/.local/opt/go-*");
                            await sshExec("rm -rf ~/.local/opt/go-* ~/.cache/go-build ~/.local/opt/go ~/go ~/Downloads/webi/golang");
                            await sshExec("pathman remove .local/opt/go/bin ; source ~/.bashrc");
                        } else {
                            if (value == "latest" || value == "current") {
                                arg = ""
                            } else if (!value || value == "lts") {
                                arg = "@stable"
                            } else {
                                arg = "@" + value
                            }
                            await writeLog("$> changing Golang engine to " + (value || 'stable'));
                            await sshExec("command -v pathman &> /dev/null || (curl -sS https://webinstall.dev/pathman | bash) ; source ~/.bashrc");
                            await sshExec(`curl -sS https://webinstall.dev/golang${arg} | WEBI__GO_ESSENTIALS=true bash ; source ~/.bashrc`);
                            await sshExec("go version");
                        }
                        break;
                    case 'rust':
                    case 'rustlang':
                        if (value == 'off') {
                            await writeLog("$> removing Rust engine");
                            await sshExec("rustup self uninstall -y");
                            await sshExec("pathman remove $HOME/.cargo/bin ; source ~/.bashrc");
                            break;
                        } else {
                            await writeLog(value ? "$> changing Rust engine to " + value : "$> installing Rust engine");
                            await sshExec("command -v pathman &> /dev/null || (curl -sS https://webinstall.dev/pathman | bash) ; source ~/.bashrc");
                            await sshExec(`command -v rustup &> /dev/null || (curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal)`);
                            await sshExec(`pathman add $HOME/.cargo/bin ; source ~/.bashrc`);
                            if (value && value != "stable" && value != "current" && value != "latest") {
                                await sshExec(`rustup toolchain install ${value} && rustup default ${value}`);
                            }
                            await sshExec("rustc --version");
                        }
                        break;
                    case 'ruby':
                        if (value == 'off') {
                            await writeLog("$> removing Ruby engine");
                            await sshExec(`rm -rf ~/.rvm`);
                            await sshExec("sed -i '/rvm\\|RVM/d' ~/.bashrc");
                        } else {
                            await writeLog(value ? "$> changing Ruby engine to " + value : "$> installing Ruby engine");
                            await sshExec(`command -v rvm &> /dev/null || { curl -sSL https://rvm.io/mpapis.asc | gpg --import -; curl -sSL https://rvm.io/pkuczynski.asc | gpg --import -; }`);
                            await sshExec(`command -v rvm &> /dev/null || { curl -sSL https://get.rvm.io | bash -s stable; source ~/.rvm/scripts/rvm; rvm autolibs disable; }`);
                            await sshExec(`rvm install ${getRubyVersion(value)} --no-docs`);
                            await sshExec("ruby --version");
                        }
                        break;
                    case 'bun':
                        arg = value;
                        if (arg == 'off') {
                            await writeLog("$> removing Bun engine");
                            await sshExec("chmod -R 0700 ~/.local/opt/bun-*");
                            await sshExec("rm -rf ~/.local/opt/bun-* ~/.local/opt/bun ~/Downloads/webi/bun");
                            await sshExec("pathman remove .local/opt/bun/bin ; source ~/.bashrc");
                        } else {
                            if (value == "latest" || value == "current" || !value || value == "lts") {
                                arg = ""
                            } else {
                                arg = "@" + value
                            }
                            await writeLog("$> changing Bun engine to " + (value || 'latest'));
                            await sshExec("command -v pathman &> /dev/null || (curl -sS https://webinstall.dev/pathman | bash) ; source ~/.bashrc");
                            await sshExec(`curl -sS https://webinstall.dev/bun${arg} | bash ; source ~/.bashrc`);
                            await sshExec("bun --version");
                        }
                        break;
                    case 'zig':
                        arg = value;
                        if (arg == 'off') {
                            await writeLog("$> removing Zig engine");
                            await sshExec("rm -rf ~/.local/opt/zig ~/Downloads/webi/zig");
                            await sshExec("pathman remove .local/opt/zig/bin ; source ~/.bashrc");
                        } else {
                            if (value == "latest" || value == "current" || !value || value == "lts") {
                                arg = ""
                            } else {
                                arg = "@" + value
                            }
                            await writeLog("$> changing Zig engine to " + (value || 'latest'));
                            await sshExec("command -v pathman &> /dev/null || (curl -sS https://webinstall.dev/pathman | bash) ; source ~/.bashrc");
                            await sshExec(`curl -sS https://webinstall.dev/zig${arg} | bash ; source ~/.bashrc`);
                            await sshExec("zig --version");
                        }
                        break;
                    case 'dotnet':
                        arg = value;
                        if (arg == 'off') {
                            await writeLog("$> removing Dotnet engine");
                            await sshExec("rm -rf ~/.dotnet");
                            await sshExec("pathman remove .dotnet ; source ~/.bashrc");
                        } else {
                            if (value == "latest" || value == "current") {
                                arg = "-- --version latest"
                            } else if ( !value || value == "lts" || value == "stable") {
                                arg = ""
                            } else {
                                arg = ''
                            }
                            await writeLog("$> changing Dotnet engine to " + (value || 'lts'));
                            await sshExec("command -v pathman &> /dev/null || (curl -sS https://webinstall.dev/pathman | bash) ; source ~/.bashrc");
                            await sshExec(`curl -sS https://dot.net/v1/dotnet-install.sh | bash -s ${arg}`);
                            await sshExec(`pathman add ~/.dotnet ; source ~/.bashrc`);
                            await sshExec("dotnet --version");
                        }
                        break;
                    default:
                        break;
                }
            }
        }
        await sshExec('unset HISTFILE TERM', false); // https://stackoverflow.com/a/9039154/3908409
        await sshExec(`export CI=true CONTINUOUS_INTEGRATION=true LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 PIP_PROGRESS_BAR=off`, false);
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
 * @param {{source: any;features: any;commands: any;nginx: any;envs: any,directory:any, root:any}} config
 * @param {{[x: string]: any}} domaindata
 * @param {string} subdomain
 * @param {{(cmd: string, write?: boolean): Promise<any>}} sshExec
 * @param {{(s: string): Promise<void>}} writeLog
 * @param {{ (program: any, ...opts: any[]): Promise<any> }} virtExec
 * @param {boolean} firewallOn
 * @param {stillroot} firewallOn
 */
export async function runConfigSubdomain(config, domaindata, subdomain, sshExec, writeLog, virtExec, firewallOn, stillroot = false) {
    var subdomaindata;
    const featureRunner = async (/** @type {object|string} */ feature) => {
        const key = typeof feature === 'string' ? splitLimit(feature, / /g, 2)[0] : Object.keys(feature)[0];
        let value = typeof feature === 'string' ? feature.substring(key.length + 1) : feature[key];
        switch (key) {
            case 'php':
                if (value == 'lts' || value == 'latest') {
                    value = getLtsPhp();
                } else if (!value.includes('.')) {
                    value = getLtsPhp(value);
                }
                if (!value) {
                    throw new Error(`php version ${value} not found`);
                }

                await writeLog("$> changing PHP engine to " + value);
                if (process.env.MODE !== 'dev') {
                    await virtExec("modify-web", {
                        domain: subdomain,
                        'php-version': value,
                    });
                }

                var phpVer = value.replace('.', '');
                await sshExec(`mkdir -p ~/.local/bin; echo -e "\\u23\\u21/bin/bash\\n$(which php${phpVer}) \\u22\\u24\\u40\\u22" > ~/.local/bin/php; chmod +x ~/.local/bin/php`, false);
                break;
            case 'ssl':
                // ssl now also fix any misconfigurations
                if (process.env.MODE === 'dev') {
                    break;
                }
                let regenerateSsl = false;
                let expectedSslMode = null;
                if (['off', 'always', 'on'].includes(value)) {
                    expectedSslMode = expectedSslMode;
                } else if (value == 'letsencrypt') {
                    regenerateSsl = true;
                }
                var nginxNodes = await nginxExec.get(subdomain);
                var nginxInfos = nginxExec.extractInfo(nginxNodes, subdomain);
                var sharedSSL = regenerateSsl ? null : detectCanShareSSL(subdomain);
                var changed = false;
                var expectCert = sharedSSL ? path.join(sharedSSL, 'ssl.cert') : domaindata['SSL cert file'];
                var expectKey = sharedSSL ? path.join(sharedSSL, 'ssl.key') : domaindata['SSL key file'];
                if (!expectCert || !expectKey) {
                    expectedSslMode = 'off';
                }
                if (expectCert != nginxInfos.ssl_certificate) {
                    nginxInfos.ssl_certificate = expectCert
                    changed = true;
                }
                if (expectKey != nginxInfos.ssl_certificate_key) {
                    nginxInfos.ssl_certificate_key = expectKey
                    changed = true;
                }
                if (domaindata['HTML directory'] != nginxInfos.root) {
                    nginxInfos.root = domaindata['HTML directory']
                    changed = true;
                }
                if (expectedSslMode && expectedSslMode != ["", "off", "always", "on"][nginxInfos.ssl]) {
                    nginxInfos.config.ssl = expectedSslMode
                    changed = true;
                }
                if (changed) {
                    await writeLog("$> Applying nginx ssl config on " + subdomain);
                    await writeLog(await nginxExec.setDirect(subdomain, nginxInfos));
                }
                if (regenerateSsl || (!expectedSslMode && !sharedSSL)) {
                    await writeLog("$> generating ssl cert with let's encrypt");
                    await spawnSudoUtil('OPENSSL_CLEAN');
                    await virtExec("generate-letsencrypt-cert", {
                        domain: subdomain,
                        'renew': 2,
                        'web': true,
                    });
                }
                break;
            case 'root':
                if (process.env.MODE === 'dev') {
                    break;
                }
                // remove prefix and trailing slash
                value = value.replace(/^\/+/, '').replace(/\/+$/, '');
                var absolutePath = path.join(subdomaindata['Home directory'], value);
                if (absolutePath !== subdomaindata['HTML directory']) {
                    await writeLog("$> changing root folder");
                    await sshExec(`mkdir -p ${absolutePath}`);
                    await virtExec("modify-web", {
                        domain: subdomain,
                        'document-dir': value,
                    });
                    subdomaindata['HTML directory'] = absolutePath;
                } else {
                    await writeLog("$> root folder is set unchanged");
                }
                break;
        }
    }
    if (stillroot) {
        subdomaindata = domaindata
    } else {
        try {
            subdomaindata = await virtualminExec.getDomainInfo(subdomain);
        } catch {
            await writeLog("\n$> Server is not exist. Finishing execution for " + subdomain + " domain\n");
            return;
        }
    }
    if (config.source || config.commands) {
        await sshExec(`shopt -s dotglob`, false);
        await sshExec(`export DOMAIN='${subdomain}'`, false);
        await sshExec(`mkdir -p ${subdomaindata['Home directory']}/public_html && cd "$_"`);    
    }
    if (config.source) {
        if (typeof config.source === 'string') {
            config.source = {
                url: config.source,
            };
        }
        const source = config.source;
        if (source.url !== 'clear' && !source.url.match(/^(?:(?:https?|ftp|ssh):\/\/)?([^\/]+)/)) {
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
                if (url.protocol == 'ssh' || url.pathname.endsWith('.git') || (url.hostname.match(/^(www\.)?(github|gitlab)\.com$/) && !url.pathname.endsWith('.zip') && !url.pathname.endsWith('.tar.gz'))) {
                    source.type = 'clone';
                } else {
                    source.type = 'extract';
                }
            }
        }
        let executedCMD = [`rm -rf *`];
        let executedCMDNote = '';
        if (source.url === 'clear') {
            // we just delete them all
            executedCMDNote = 'Clearing files';
        } else if (source.type === 'clone') {
            if (!source.branch && source.directory) {
                source.branch = source.directory;
            } else if (!source.branch && url.hash) {
                source.branch = decodeURI(url.hash.substring(1));
                url.hash = '';
            }
            if (source.credentials?.github?.ssh) {
                const configFileContent = `Host github.com\n\tStrictHostKeyChecking no\n\tIdentityFile ~/.ssh/id_github_com\n`;
                await writeLog("$> writing SSH private key for cloning github.com repository");
                await sshExec(`mkdir -p ~/.ssh; touch $HOME/.ssh/{id_github_com,config}; chmod 0600 $HOME/.ssh/*`, false);
                await sshExec(`echo "${Buffer.from(source.credentials.github.ssh).toString('base64')}" | base64 --decode > $HOME/.ssh/id_github_com`, false);
                // delete old config https://stackoverflow.com/a/36111659/3908409
                await sshExec(`sed 's/^Host/\\n&/' $HOME/.ssh/config | sed '/^Host '"github.com"'$/,/^$/d;/^$/d' > $HOME/.ssh/config`, false);
                await sshExec(`echo "${Buffer.from(configFileContent).toString('base64')}" | base64 --decode >> ~/.ssh/config`, false);
            }
            executedCMD.push(`git clone ${escapeShell(url.toString())}` +
                `${source.branch ? ` -b ${escapeShell(source.branch)}` : ''}` +
                `${source.shallow ? ` --depth 1` : ''}` +
                `${source.submodules ? ` --recurse-submodules` : ''}` + ' .');
            executedCMDNote = 'Cloning files';
        } else if (source.type === 'extract') {
            if (!source.directory && url.hash) {
                source.directory = decodeURI(url.hash.substring(1));
                url.hash = '';
            }
            if (url.pathname.endsWith('.tar.gz')) {
                executedCMD.push(`wget -O _.tar.gz ` + escapeShell(url.toString()));
                executedCMD.push(`tar -xzf _.tar.gz ; rm _.tar.gz ; chmod -R 0750 *`);
            } else {
                executedCMD.push(`wget -O _.zip ` + escapeShell(url.toString()));
                executedCMD.push(`unzip -q -o _.zip ; rm _.zip ; chmod -R 0750 *`);    
            }
            if (source.directory) {
                executedCMD.push(`mv ${escapeShell(source.directory)}/* .`);
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
                await sshExec("export " + entries.map(([k, v]) => `${k}='${v}'`).join(' '), false);
        }
        for (const cmd of config.commands) {
            if (typeof cmd === 'string') {
                await sshExec(cmd);
            } else if (typeof cmd === 'object') {
                if (cmd.command) {
                    await sshExec(cmd.command, cmd.write === false ? false : true);
                } else if (cmd.feature) {
                    await featureRunner(cmd.feature);
                } else if (cmd.filename && cmd.content) {
                    await writeLog("$> writing " + cmd.filename);
                    await sshExec(`echo "${Buffer.from(cmd.content).toString('base64')}" | base64 --decode > "${cmd.filename}"`, false);
                }
            }
        }
    }


    if (config.nginx && config.nginx.root) {
        // moved to config.features
        config.features = (config.features || []).concat([{
            root: config.nginx.root
        }]);
        delete config.nginx.root;
    } else if (config.root) {
        // moved to config.features
        config.features = (config.features || []).concat([{
            root: config.root
        }]);
        delete config.root;
    }

    if (Array.isArray(config.features)) {
        await writeLog("$> Applying features");
        for (const feature of config.features) {
            if (typeof feature === 'string' && feature.match(/^ssl/)) {
                continue;
            }
            await featureRunner(feature);
        }
    }


    if (process.env.MODE !== 'dev') {
        if (config.nginx) {
            await writeLog("$> Applying nginx config on " + subdomain);
            await writeLog(await nginxExec.set(subdomain, config.nginx));
        }

        if (Array.isArray(config.features)) {
            for (const feature of config.features) {
                if (typeof feature === 'string' && feature.match(/^ssl/)) {
                    await featureRunner(feature);
                }
            }
        }
    }
}
