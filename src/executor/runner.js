import {
    NodeSSH
} from "node-ssh";
import { getVersion } from "../util.js";
import {
    virtualminExec
} from "./virtualmin.js";
const maxExecutionTime = 600000;

/**
 * @param {any} config
 * @param {string} domain
 * @param {(log: string) => void} writer
 */
export default async function runConfig(config, domain, writer, sandbox = false) {
    let domaindata = await virtualminExec.getDomainInfo(domain);
    let starttime = Date.now();
    const writeLog = (s) => {
        writer(s + "\n");
        if (Date.now() - starttime > maxExecutionTime)
            throw new Error("Execution has timed out");
    }
    const writeExec = (s) => {
        writeLog(s.stdout);
        if (s.stderr) {
            writeLog(s.stderr.split('\n').map(x => '! ' + x).join('\n'));
        }
        writeLog("Exit status: " + s.code);
    }
    writeLog(`DOM Cloud runner v${getVersion()} in ${domain} at ${new Date(starttime).toISOString()}`);
    if (Array.isArray(config.features) && !sandbox) {
        // root features
        for (const feature of config.features) {
            const key = typeof feature === 'string' ? feature.split(' ', 2)[0] : Object.keys(feature)[0];
            const value = typeof feature === 'string' ? feature.split(' ', 2)[1] : feature[key];
            switch (key) {
                case 'create':
                    writeLog("$> virtualmin create-domain");
                    if (domaindata) {
                        writeLog("Can't create. Domain exist");
                        break;
                    }
                    writeExec(await virtualminExec.execFormatted("create-domain", value, {
                        domain,
                        dir: true,
                        webmin: true,
                        unix: true,
                        'limits-from-plan': true,
                        'virtualmin-nginx': true,
                        'virtualmin-nginx-ssl': true,
                    }));
                    domaindata = await virtualminExec.getDomainInfo(domain);
                    break;
                case 'modify':
                    writeLog("$> virtualmin modify-domain");
                    writeExec(await virtualminExec.execFormatted("modify-domain", value, {
                        domain,
                    }));
                    break;
                case 'disable':
                    writeLog("$> virtualmin disable-domain");
                    writeExec(await virtualminExec.execFormatted("disable-domain", value, {
                        domain,
                    }));
                    break;
                case 'enable':
                    writeLog("$> virtualmin enable-domain");
                    writeExec(await virtualminExec.execFormatted("enable-domain", value, {
                        domain,
                    }));
                    break;
                case 'delete':
                    writeLog("$> virtualmin delete-domain");
                    writeExec(await virtualminExec.execFormatted("delete-domain", value, {
                        domain,
                    }));
                    // no need to do other stuff
                    return;
                default:
                    break;
            }
        }
    }
    if (!domaindata) {
        writeLog("Server is not exist. Finishing execution");
        return;
    }
    let sshExec;
    if (process.env.NODE_ENV === 'development') {
        sshExec = async (cmd) => {
            writeLog(cmd);
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
            writeExec(res);
        }
    }
    await sshExec("cd " + domaindata['Home directory'] + "/public_html");

    if (Array.isArray(config.features)) {
        for (const feature of config.features) {
            const key = typeof feature === 'string' ? feature.split(' ', 2)[0] : Object.keys(feature)[0];
            const value = typeof feature === 'string' ? feature.split(' ', 2)[1] : feature[key];
            const isFeatureEnabled = (f) => {
                return domaindata['Features'].includes(f);
            }
            let enabled;
            switch (key) {
                case 'mysql':
                    enabled = isFeatureEnabled('mysql');
                    if (value === "off") {
                        writeLog("$> Disabling MySQL");
                        if (enabled) {
                            writeExec(await virtualminExec.execFormatted("disable-feature", value, {
                                domain,
                                mysql: true,
                            }));
                        } else {
                            writeLog("Already disabled");
                        }
                    } else if (value) {
                        let dbname = null;
                        if (!enabled) {
                            writeLog("$> Enabling MySQL");
                            writeExec(await virtualminExec.execFormatted("enable-feature", value, {
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
                        writeLog(`$> Creating db instance ${dbname} on MySQL`);
                        writeExec(await virtualminExec.execFormatted("create-database", {
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
                        writeLog("$> Disabling PostgreSQL");
                        if (enabled) {
                            writeExec(await virtualminExec.execFormatted("disable-feature", value, {
                                domain,
                                postgres: true,
                            }));
                        } else {
                            writeLog("Already disabled");
                        }
                    } else if (value) {
                        let dbname = null;
                        if (!enabled) {
                            writeLog("$> Enabling PostgreSQL");
                            writeExec(await virtualminExec.execFormatted("enable-feature", value, {
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
                        writeLog(`$> Creating db instance ${dbname} on PostgreSQL`);
                        writeExec(await virtualminExec.execFormatted("create-database", {
                            domain,
                            name: dbname,
                            type: 'postgres',
                        }));
                    }
                    break;
                case 'dns':
                    enabled = isFeatureEnabled('dns');
                    if (value === "off") {
                        writeLog("$> Disabling DNS");
                        if (enabled) {
                            writeExec(await virtualminExec.execFormatted("disable-feature", value, {
                                domain,
                                dns: true,
                            }));
                        } else {
                            writeLog("Already disabled");
                        }
                    } else if (value) {
                        if (!enabled) {
                            writeLog("$> Enabling DNS");
                            writeExec(await virtualminExec.execFormatted("enable-feature", value, {
                                domain,
                                dns: true,
                            }));
                        }
                    }
                    break;
                case 'firewall':
                case 'php':
                    writeLog("$> changing PHP engine to " + value);
                    writeExec(await virtualminExec.execFormatted("modify-web", {
                        domain,
                        '--php-version': value,
                    }));
                    break;
                case 'python':
                    writeLog("$> changing Python engine to " + value);
                    await sshExec("curl -sS https://webinstall.dev/pyenv | bash");
                    await sshExec("pyenv install -v");
                    await sshExec("pyenv global " + value);
                    await sshExec("python --version");
                    break;
                case 'node':
                    writeLog("$> changing Node engine to " + value);
                    await sshExec(`curl -sS https://webinstall.dev/node@${value} | bash`);
                    await sshExec("node --version");
                    break;
                case 'ruby':
                    writeLog("$> changing Ruby engine to " + value);
                    await sshExec(`curl -sSL https://rvm.io/mpapis.asc | gpg --import -`);
                    await sshExec(`curl -sSL https://rvm.io/pkuczynski.asc | gpg --import -`);
                    await sshExec(`curl -sSL https://get.rvm.io | bash -s ${value}`);
                    await sshExec("ruby --version");
                    break;
                case 'ssl':
                    writeLog("$> getting let's encrypt");
                    writeExec(await virtualminExec.execFormatted("generate-letsencrypt-cert", {
                        domain,
                        'renew': 2,
                        'web': true,
                    }));
                default:
                    break;
            }
        }
    }
    if (config.root) {
        writeLog("$> changing root folder");
        writeExec(await virtualminExec.execFormatted("modify-web", {
            domain,
            'document-dir': config.root,
        }));
    }
    if (config.source) {
        // snip
    }
    if (config.commands) {
        await sshExec('unset HISTFILE'); // https://stackoverflow.com/a/9039154/3908409
        await sshExec(`DATABASE='${domaindata['Username']}_db' ; DOMAIN='${domain}' ; USERNAME='${domaindata['Username']}' PASSWORD='${domaindata['Password']}'`);
        for (const cmd of config.commands) {
            await sshExec(cmd);
        }
    }
    if (config.subdomains) {
        for (const sub of config.subdomains) {
            await runConfig(sub, [sub.subdomain, domain].join('.'), writer, false);
        }
    }
}