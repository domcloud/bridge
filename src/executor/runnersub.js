import path from "path";
import {
    detectCanShareSSL,
    escapeShell, getDbName, getLtsPhp, spawnSudoUtil, splitLimit
} from "../util.js";
import { iptablesExec } from "./iptables.js";
import { namedExec } from "./named.js";
import { nginxExec } from "./nginx.js";
import { virtualminExec } from "./virtualmin.js";
import { unitExec } from "./unit.js";

/**
 * @param {{source: any;features: any;commands: any;nginx: any;unit: any;envs: any,directory:any, root:any}} config
 * @param {{[x: string]: any}} domaindata
 * @param {string} subdomain
 * @param {{(cmd: string, write?: boolean): Promise<any>}} sshExec
 * @param {{(s: string): Promise<void>}} writeLog
 * @param {{ (program: any, ...opts: any[]): Promise<any> }} virtExec
 * @param {boolean} firewallOn
 * @param {boolean} stillroot
 */

export async function runConfigSubdomain(config, domaindata, subdomain, sshExec, writeLog, virtExec, firewallOn, stillroot = false) {
    var subdomaindata;

    if (stillroot) {
        subdomaindata = domaindata;
    } else {
        try {
            subdomaindata = await virtualminExec.getDomainInfo(subdomain);
        } catch {
            await writeLog("\n$> Server is not exist. Finishing execution for " + subdomain + " domain\n");
            return;
        }
    }

    let domainprefix = stillroot || !subdomaindata['Parent domain'] ? "db" : subdomain.slice(0, -(subdomaindata['Parent domain'].length + 1));
    let dbname = getDbName(domaindata['Username'], domainprefix);

    const featureRunner = async (/** @type {object|string} */ feature) => {
        let key = typeof feature === 'string' ? splitLimit(feature, / /g, 2)[0] : Object.keys(feature)[0];
        let value = typeof feature === 'string' ? feature.substring(key.length + 1) : feature[key];
        if (key == 'mariadb') {
            key = 'mysql';
        }
        if (key == 'postgresql') {
            key = 'postgres';
        }
        let enabled = domaindata['Features'].includes(key);
        let subenabled = subdomaindata['Features'].includes(key);
        let dbneedcreate = false;
        switch (key) {
            case 'mysql':
                if (!stillroot && !enabled) {
                    await writeLog("Problem: Can't manage MySQL while it is disabled in parent domain");
                    break;
                }
                if (value === "off") {
                    await writeLog("$> Disabling MySQL");
                    if (subenabled) {
                        await virtExec("disable-feature", value, {
                            domain: subdomain,
                            mysql: true,
                        });
                        subdomaindata['Features'] = subdomaindata['Features'].replace(/ ?mysql/, '');
                    } else {
                        await writeLog("Already disabled");
                    }
                    break;
                }
                if (!subenabled) {
                    await writeLog("$> Enabling MySQL");
                    await virtExec("enable-feature", value, {
                        domain: subdomain,
                        mysql: true,
                    });
                    dbneedcreate = true;
                    subdomaindata['Features'] += ' ' + key;
                }
                if (value.startsWith("create ")) {
                    let newdb = value.substr("create ".length).trim();
                    dbname = getDbName(domaindata['Username'], domainprefix == "db" ? newdb : domainprefix + '_' + newdb);
                    dbneedcreate = true;
                }
                if (dbneedcreate) {
                    await writeLog(`$> Creating db instance ${dbname} on MySQL`);
                    await virtExec("create-database", {
                        domain: subdomain,
                        name: dbname,
                        type: 'mysql',
                    });
                }
                break;
            case 'postgres':
                if (!stillroot && !enabled) {
                    await writeLog("Problem: Can't manage PostgreSQL while it is disabled in parent domain");
                    break;
                }
                if (value === "off") {
                    await writeLog("$> Disabling PostgreSQL");
                    if (subenabled) {
                        await virtExec("disable-feature", value, {
                            domain: subdomain,
                            postgres: true,
                        });
                        subdomaindata['Features'] = subdomaindata['Features'].replace(/ ?postgres/, '');
                    } else {
                        await writeLog("Already disabled");
                    }
                    break;
                }
                if (!subenabled) {
                    await writeLog("$> Enabling PostgreSQL");
                    await virtExec("enable-feature", value, {
                        domain: subdomain,
                        postgres: true,
                    });
                    subdomaindata['Features'] += ' ' + key;
                    dbneedcreate = true;
                }
                if (value.startsWith("create ")) {
                    let newdb = value.substr("create ".length).trim();
                    dbname = getDbName(domaindata['Username'], domainprefix == "db" ? newdb : domainprefix + '_' + newdb);
                    dbneedcreate = true;
                }
                if (dbneedcreate) {
                    await writeLog(`$> Creating db instance ${dbname} on PostgreSQL`);
                    await virtExec("create-database", {
                        domain: subdomain,
                        name: dbname,
                        type: 'postgres',
                    }
                    );
                }
                break;
            case 'dns':
                if (!stillroot && !enabled) {
                    await writeLog("Problem: Can't manage DNS while it is disabled in parent domain");
                    break;
                }
                if (value === "off") {
                    await writeLog("$> Disabling DNS feature");
                    if (subenabled) {
                        await virtExec("disable-feature", value, {
                            domain: subdomain,
                            dns: true,
                        });
                        subdomaindata['Features'] = subdomaindata['Features'].replace(/ ?dns/, '');
                    } else {
                        await writeLog("Already disabled");
                    }
                    break;
                }
                if (!subenabled) {
                    await writeLog("$> Enabling DNS feature");
                    await virtExec("enable-feature", value, {
                        domain: subdomain,
                        dns: true,
                    });
                    subdomaindata['Features'] += ' ' + key;
                }
                if (!Array.isArray(value)) {
                    break;
                }
                if (!stillroot) {
                    await writeLog("Problem: Can't manage DNS records on subdomain");
                    break;
                }
                await writeLog("$> Applying DNS records");
                for (let i = 0; i < value.length; i++) {
                    if (typeof value[i] !== 'string') {
                        continue;
                    }
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
                        };
                    }
                }
                await writeLog(await namedExec.set(subdomain, value));
                break;
            case 'php':
                if (value == 'lts' || value == 'latest') {
                    value = getLtsPhp();
                } else if (!value.includes('.')) {
                    value = getLtsPhp(value);
                }
                if (!value) {
                    throw new Error(`php version ${value} not found`);
                }

                await writeLog("$> Changing PHP engine to " + value);
                if (process.env.MODE !== 'dev') {
                    await virtExec("modify-web", {
                        domain: subdomain,
                        'php-version': value,
                    });
                }

                var phpVer = value.replace('.', '');
                await sshExec(`mkdir -p ~/.local/bin; echo -e "\\u23\\u21/bin/bash\\n$(which php${phpVer}) \\u22\\u24\\u40\\u22" > ~/.local/bin/php; chmod +x ~/.local/bin/php`, false);
                break;
            case 'http':
                var nginxNodes = await nginxExec.get(subdomain);
                var nginxInfos = nginxExec.extractInfo(nginxNodes, subdomain);
                value = parseInt(value);
                if (![1, 2].includes(value)) {
                    throw new Error(`http option invalid. specify "http 1" or "http 2"`);
                }
                if (value === nginxInfos.http) {
                    await writeLog("$> http version config is set unchanged");
                } else {
                    nginxInfos.config.http = value;
                    await writeLog("$> Applying nginx http config on " + subdomain);
                    await writeLog(await nginxExec.setDirect(subdomain, nginxInfos));
                }
                break;
            case 'ssl':
                // ssl also fix any misconfigurations
                var changed = false;
                let regenerateSsl = false;
                let selfSignSsl = false;
                let expectedSslMode = null;
                if (['off', 'always', 'on'].includes(value)) {
                    expectedSslMode = value;
                } else if (value == 'letsencrypt' || value == 'lets-encrypt') {
                    regenerateSsl = true;
                } else if (value == 'selfsign' || value == 'self-sign') {
                    selfSignSsl = true;
                }
                var sharedSSL = regenerateSsl ? null : detectCanShareSSL(subdomain);
                nginxNodes = await nginxExec.get(subdomain);
                nginxInfos = nginxExec.extractInfo(nginxNodes, subdomain);
                var expectCert = sharedSSL ? path.join(sharedSSL, 'ssl.combined') : (subdomaindata['SSL cert and CA file'] || subdomaindata['SSL cert file']);
                var expectKey = sharedSSL ? path.join(sharedSSL, 'ssl.key') : subdomaindata['SSL key file'];
                // if (force regenerate or no explicit command or ssl not match) AND it's shared, then must break.
                if (regenerateSsl || (!expectedSslMode && !sharedSSL && !selfSignSsl) || (expectCert != nginxInfos.ssl_certificate)) {
                    if (subdomaindata['SSL shared with']) {
                        await writeLog("$> Breaking ssl cert sharing with the global domain");
                        await virtExec("modify-web", {
                            domain: subdomain,
                            'break-ssl-cert': true,
                        });
                        await new Promise(r => setTimeout(r, 1000));
                        // paths changing... need to refresh data
                        subdomaindata = await virtualminExec.getDomainInfo(subdomain);
                        nginxNodes = await nginxExec.get(subdomain);
                        nginxInfos = nginxExec.extractInfo(nginxNodes, subdomain);
                        expectCert = sharedSSL ? path.join(sharedSSL, 'ssl.combined') : (subdomaindata['SSL cert and CA file'] || subdomaindata['SSL cert file']);
                        expectKey = sharedSSL ? path.join(sharedSSL, 'ssl.key') : subdomaindata['SSL key file'];
                    }
                }
                if (!expectCert || !expectKey) {
                    expectedSslMode = 'off';
                }
                if (expectCert != nginxInfos.ssl_certificate) {
                    nginxInfos.ssl_certificate = expectCert;
                    changed = true;
                }
                if (expectKey != nginxInfos.ssl_certificate_key) {
                    nginxInfos.ssl_certificate_key = expectKey;
                    changed = true;
                }
                if (subdomaindata['HTML directory'] != nginxInfos.root) {
                    nginxInfos.root = subdomaindata['HTML directory'];
                    changed = true;
                }
                if (expectedSslMode && expectedSslMode != ["", "off", "always", "on"][nginxInfos.ssl]) {
                    nginxInfos.config.ssl = expectedSslMode;
                    changed = true;
                }
                // if force LE or no explicit command AND not shared, check regeration
                if (regenerateSsl || (!expectedSslMode && !sharedSSL && !selfSignSsl)) {
                    const remaining = subdomaindata['SSL cert expiry'] ? (Date.parse(subdomaindata['SSL cert expiry']) - Date.now()) / 86400000 : 0;
                    // if force LE or remaining > 30 days, get fresh one
                    if (!regenerateSsl && subdomaindata['Lets Encrypt renewal'] == 'Enabled' && (remaining > 30)) {
                        await writeLog("$> SSL cert expiry is " + Math.trunc(remaining) + " days away so skipping renewal");
                        await writeLog("$> To enforce renewal please use 'ssl lets-encrypt'");
                    } else {
                        await writeLog("$> Generating SSL cert with Let's Encrypt");
                        await spawnSudoUtil('OPENSSL_CLEAN');
                        await virtExec("generate-letsencrypt-cert", {
                            domain: subdomain,
                            'renew': 2,
                            'web': true,
                            'skip-dns-check': true,
                        });
                        subdomaindata['SSL cert expiry'] = new Date().toISOString()
                    }
                    // if LE ON AND force self-sign / shared on, must turn off
                    // if it was shared or ssl path don't match, just assume that's also LE ON
                } else if ((selfSignSsl || sharedSSL) && ((subdomaindata['SSL shared with'] && changed && !expectedSslMode) || subdomaindata['Lets Encrypt renewal'] == 'Enabled')) {
                    await writeLog("$> Generating self signed cert and turning off let's encrypt renewal");
                    await virtExec("generate-cert", {
                        domain: subdomain,
                        'self': true,
                    });
                    delete subdomaindata['Lets Encrypt renewal'];
                    delete subdomaindata['SSL shared with'];
                } else if (!changed) {
                    await writeLog("$> SSL config seems OK, nothing changed");
                    break;
                }
                await writeLog("$> Applying nginx ssl config on " + subdomain);
                await writeLog(await nginxExec.setDirect(subdomain, nginxInfos));
                if (sharedSSL && sharedSSL.match(/\/(\d{10,})\//)) {
                    await writeLog("$> Applying SSL links with global domain");
                    let id = sharedSSL.match(/\/(\d{10,})\//)[1];
                    await writeLog(await virtualminExec.pushVirtualServerConfig(subdomaindata['ID'], {
                        'ssl_same': id,
                        'ssl_key': path.join(sharedSSL, 'ssl.key'),
                        'ssl_cert': path.join(sharedSSL, 'ssl.cert'),
                        'ssl_chain': path.join(sharedSSL, 'ssl.ca'),
                    }));
                }
                break;
            case 'root':
                // remove prefix and trailing slash
                value = value.replace(/^\/+/, '').replace(/\/+$/, '');
                if (!stillroot && value.startsWith('domains/' + subdomain + '/')) {
                    // confusion with nginx generator
                    value = value.substring(('domains/' + subdomain + '/').length);
                }
                var absolutePath = path.join(subdomaindata['Home directory'], value);
                if (absolutePath !== subdomaindata['HTML directory']) {
                    await writeLog("$> Changing root folder");
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
    };

    if (config.source || config.commands) {
        await sshExec(`shopt -s dotglob`, false);
        await sshExec(`export DOMAIN='${subdomain}'`, false);
        // enable managing systemd for linger user
        await sshExec(`export XDG_RUNTIME_DIR=/run/user/$(id -u)`, false);
        await sshExec(`export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus`, false);
        await sshExec(`mkdir -p ${subdomaindata['Home directory']}/public_html && cd "$_"`);
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

    if (config.nginx) {
        await writeLog("$> Applying nginx config on " + subdomain);
        await writeLog(await nginxExec.set(subdomain, config.nginx));
    }


    if (config.unit) {
        await writeLog("$> Applying unit config on " + subdomain);
        let d = await unitExec.setDomain(subdomain, config.unit, subdomaindata);
        await writeLog(d.stdout);
    }

    try {
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
                await iptablesExec.setDelUser(domaindata['Username'], domaindata['User ID']);
            }
            await writeLog("$> " + executedCMDNote);
            for (const exec of executedCMD) {
                await sshExec(exec);
            }
        }
        if (config.commands) {
            await sshExec(`export DATABASE='${dbname}'`, false);
            if (config.envs) {
                let entries = Object.entries(config.envs);
                if (entries.length > 0)
                    await sshExec("export " + entries.map(([k, v]) => `${k}='${v}'`).join(' '), false);
            }
            for (const cmd of config.commands) {
                if (typeof cmd === 'string') {
                    await sshExec(cmd);
                } else if (typeof cmd === 'object' && cmd !== null) {
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
    } catch (error) {
        throw error;
    } finally {
        if (config.source && firewallOn) {
            await iptablesExec.setAddUser(domaindata['Username'], domaindata['User ID']);
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
