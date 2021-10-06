import {
    NodeSSH
} from "node-ssh";
import {
    escapeShell,
    getVersion
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
const maxExecutionTime = 600000;

/**
 * @param {any} config
 * @param {string} domain
 * @param {(log: string) => Promise<void>} writer
 */
export default async function runConfig(config, domain, writer, sandbox = false) {
    let starttime = Date.now();
    const writeLog = async (s) => {
        await writer(s + "\n");
        if (Date.now() - starttime > maxExecutionTime)
            throw new Error("Execution has timed out");
    }
    const writeExec = async (s) => {
        await writeLog(s.stdout);
        if (s.stderr) {
            await writeLog(s.stderr.split('\n').map(x => '! ' + x).join('\n'));
        }
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
    }
    let domaindata = await virtualminExec.getDomainInfo(domain);
    if (!domaindata) {
        await writeLog("Server is not exist. Finishing execution");
        return;
    }
    let sshExec;
    if (process.env.NODE_ENV === 'development') {
        sshExec = async (cmd) => {
            await writeLog(cmd);
        }
    } else {
        const ssh = new NodeSSH();
        await ssh.connect({
            host: 'localhost',
            username: domaindata['Username'],
            password: domaindata['Password'],

        });
        sshExec = async (cmd) => {
            const res = await ssh.execCommand(cmd);
            await writeExec(res);
        }
    }
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
            const value = typeof feature === 'string' ? feature.split(' ', 2)[1] : feature[key];
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
                    } else if (value) {
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
                        dbname = domaindata['Username'].replace(/-/, /_/) + "_" + dbname;
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
                    } else if (value) {
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
                        dbname = domaindata['Username'].replace(/-/, /_/) + "_" + dbname;
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
                    } else if (value) {
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
                    if (value === 'on') {
                        await writeLog("$> changing firewall protection to " + value);
                        await writeLog(await iptablesExec.setAddUser(domaindata['Username']));
                    } else if (value === 'off') {
                        await writeLog("$> changing firewall protection to " + value);
                        await writeLog(await iptablesExec.setDelUser(domaindata['Username']));
                    }
                    break;
                case 'php':
                    await writeLog("$> changing PHP engine to " + value);
                    await writeExec(await virtualminExec.execFormatted("modify-web", {
                        domain,
                        '--php-version': value,
                    }));
                    break;
                case 'python':
                    await writeLog("$> changing Python engine to " + value);
                    await sshExec("curl -sS https://webinstall.dev/pyenv | bash");
                    await sshExec("pyenv install -v");
                    await sshExec("pyenv global " + value);
                    await sshExec("python --version");
                    break;
                case 'node':
                    await writeLog("$> changing Node engine to " + value);
                    await sshExec(`curl -sS https://webinstall.dev/node@${value} | bash`);
                    await sshExec("node --version");
                    break;
                case 'ruby':
                    await writeLog("$> changing Ruby engine to " + value);
                    await sshExec(`curl -sSL https://rvm.io/mpapis.asc | gpg --import -`);
                    await sshExec(`curl -sSL https://rvm.io/pkuczynski.asc | gpg --import -`);
                    await sshExec(`curl -sSL https://get.rvm.io | bash -s ${value}`);
                    await sshExec("ruby --version");
                    break;
                case 'ssl':
                    await writeLog("$> getting let's encrypt");
                    await writeExec(await virtualminExec.execFormatted("generate-letsencrypt-cert", {
                        domain,
                        'renew': 2,
                        'web': true,
                    }));
                    break;
                case 'root':
                    await writeLog("$> changing root folder");
                    await writeExec(await virtualminExec.execFormatted("modify-web", {
                        domain,
                        'document-dir': value,
                    }));
                    break;
                default:
                    break;
            }
        }
    }
    await sshExec("cd " + domaindata['Home directory'] + "/public_html");
    if (config.source) {
        if (typeof config.source === 'string') {
            config.source = {
                url: config.source,
            };
        }
        const source = config.source;
        if (!source.url.match(/^(?:(?:https?|ftp):\/\/)?([^\/]+)/)) {
            throw new Error("Invalid source URL");
        }
        if (config.directory && !source.directory) {
            source.directory = config.directory;
            delete config.directory;
        }
        var url = new URL(source.url);
        if (url.pathname.endsWith('.git')) {
            source.clone = true;
        }
        let executedCMD = '';
        let firewallStatus = !!iptablesExec.getByUsers (await iptablesExec.getParsed(), domaindata['Username'])[0];

        if (source.clone) {
            if (!source.branch && source.directory) {
                source.branch = source.directory;
            } else if (!source.branch && url.hash) {
                source.branch = url.hash.substr(1);
                url.hash = '';
            }
            if (source.shallow !== false) {
                source.shallow = true;
            }
            executedCMD = `git clone ${escapeShell(url.toString())}` +
                `${source.branch ? ` -b ${escapeShell(source.branch)}`  : ''}` +
                `${source.shallow ? ` --depth 1`  : ''}`;
        } else {
            executedCMD = `wget -q -O _.zip ` + escapeShell(url.toString());
            executedCMD += ` ; "unzip -q -o _.zip ; rm _.zip ; chmod -R 0750 * .*"`;
            if (source.directory) {
                executedCMD += ` ; mv ${escapeShell(source.directory + '/{.,}*')} . 2>/dev/null`;
                executedCMD += ` ; rm -rf ${escapeShell(source.directory)}`;
            }
        }
        if (firewallStatus) {
            await iptablesExec.setDelUser(domaindata['Username']);
        }
        await writeLog("$> Downloading source");
        await writeLog(await sshExec(`rm -rf * .* 2>/dev/null`));
        await writeLog(await sshExec(executedCMD));
        if (firewallStatus) {
            await iptablesExec.setAddUser(domaindata['Username']);
        }
    }
    if (config.commands) {
        await sshExec('unset HISTFILE'); // https://stackoverflow.com/a/9039154/3908409
        await sshExec(`DATABASE='${domaindata['Username']}_db' ; DOMAIN='${domain}' ; USERNAME='${domaindata['Username']}' PASSWORD='${domaindata['Password']}'`);
        for (const cmd of config.commands) {
            await sshExec(cmd);
        }
    }
    if (config.nginx) {
        await writeLog("$> Applying nginx config");
        await writeLog(await nginxExec.set(domain, config.nginx));
    }
    if (config.subdomains) {
        for (const sub of config.subdomains) {
            await runConfig(sub, [sub.subdomain, domain].join('.'), writer, false);
        }
    }
}