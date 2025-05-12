import path from "path";
import {
    detectCanShareSSL,
    escapeShell, getDbName, getLtsPhp,
    isDebian, spawnSudoUtil, splitLimit
} from "../util.js";
import { nftablesExec } from "./nftables.js";
import { namedExec } from "./named.js";
import { nginxExec } from "./nginx.js";
import { virtualminExec } from "./virtualmin.js";
import { unitExec } from "./unit.js";
import { dockerExec } from "./docker.js";
import { redisExec } from "./redis.js";

/**
 * @param {{source: any;features: any;commands: any;services: any;nginx: any;unit: any;envs: any,directory:any, root:any}} config
 * @param {{[x: string]: any}} domaindata
 * @param {string} subdomain
 * @param {{(cmd: string, write?: boolean): Promise<any>}} sshExec
 * @param {{(s: string): Promise<void>}} writeLog
 * @param {{ (program: any, ...opts: any[]): Promise<any> }} virtExec
 * @param {() => Promise<boolean>} firewallStatus
 * @param {boolean} stillroot
 * @param {boolean} sandbox
 */

export async function runConfigSubdomain(config, domaindata, subdomain, sshExec, writeLog, virtExec, firewallStatus, stillroot = false, sandbox = false) {
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

    async function featureRunner(/** @type {object|string} */ feature) {
        let key = typeof feature === 'string' ? splitLimit(feature, / /g, 2)[0] : Object.keys(feature)[0];
        let value = typeof feature === 'string' ? feature.substring(key.length + 1) : feature[key];
        let enabled = domaindata['Features'].includes(key);
        let subenabled = subdomaindata['Features'].includes(key);
        let dbneedcreate = false;

        if (!stillroot && !sandbox) {
            switch (key) {
                case 'modify':
                    await writeLog("$> virtualmin modify-domain");
                    await virtExec("modify-domain", value, {
                        domain: subdomain,
                    });
                    break;
                case 'rename':
                    await writeLog("$> virtualmin rename-domain");
                    if (value && typeof value["new-domain"] == 'string') {
                        if (!value["new-domain"].endsWith('.' + subdomaindata['Parent domain'])) {
                            throw new Error("The new domain name must ends with parent domain");
                        }
                    }
                    if (value && typeof value["new-user"] == 'string') {
                        throw new Error("Can't rename username for subserver");
                    }
                    await virtExec("rename-domain", value, {
                        domain: subdomain,
                    });
                    // in case if we change domain name
                    if (value && value["new-domain"])
                        subdomain = value["new-domain"];
                    await new Promise(r => setTimeout(r, 1000));
                    // @ts-ignore
                    subdomaindata = await virtualminExec.getDomainInfo(subdomain);
                    break;
                case 'delete':
                    await writeLog("$> virtualmin delete-domain");
                    await virtExec("delete-domain", value, {
                        domain: subdomain,
                    });
                    // no need to do other stuff
                    return;
            }
        }

        switch (key) {
            case 'mariadb':
            case 'mysql':
                if (!stillroot && !enabled) {
                    await writeLog("Problem: Can't manage MySQL while it is disabled in parent domain");
                    break;
                }
                if (value === "off") {
                    await writeLog("$> Disabling MySQL");
                    if (sandbox) {
                        await writeLog("$> turning off MySQL is denied");
                    } else if (subenabled) {
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
                    // need password
                    subdomaindata = await virtualminExec.getDomainInfo(subdomain);
                    domaindata['Password for mysql'] = subdomaindata['Password for mysql'];
                    await sshExec(` MYPASSWD='${subdomaindata['Password for mysql']}'`, false);
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
                } else if (sandbox && value) {
                    await writeLog("$> managing MySQL database is denied");
                } else if (value.startsWith("drop ")) {
                    let dropdb = value.substr("drop ".length).trim();
                    dbname = getDbName(domaindata['Username'], domainprefix == "db" ? dropdb : domainprefix + '_' + dropdb);
                    await virtExec("delete-database", {
                        domain: subdomain,
                        name: dbname,
                        type: 'mysql',
                    });
                } else if (value.startsWith("modify-pass ")) {
                    let pass = value.substr("modify-pass ".length).trim();
                    if (pass) {
                        await virtExec("modify-database-pass", {
                            domain: subdomain,
                            pass,
                            type: 'mysql',
                        });
                        subdomaindata['Password for mysql'] = pass;
                        await sshExec(` MYPASSWD='${pass}'`, false);
                    }
                } else if (!value) {
                    await writeLog(`$> MySQL is already initialized. To create another database, use "mysql create dbname"`);
                }
                break;
            case 'postgresql':
            case 'postgres':
                if (!stillroot && !enabled) {
                    await writeLog("Problem: Can't manage PostgreSQL while it is disabled in parent domain");
                    break;
                }
                if (value === "off") {
                    await writeLog("$> Disabling PostgreSQL");
                    if (sandbox) {
                        await writeLog("$> turning off PostgreSQL is denied");
                    } else if (subenabled) {
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
                    // need password
                    subdomaindata = await virtualminExec.getDomainInfo(subdomain);
                    domaindata['Password for postgres'] = subdomaindata['Password for postgres'];
                    await sshExec(` PGPASSWD='${subdomaindata['Password for postgres']}'`, false);
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
                } else if (sandbox && value) {
                    await writeLog("$> managing PostgreSQL database is denied");
                } else if (value.startsWith("drop ")) {
                    let dropdb = value.substr("drop ".length).trim();
                    dbname = getDbName(domaindata['Username'], domainprefix == "db" ? dropdb : domainprefix + '_' + dropdb);
                    await virtExec("delete-database", {
                        domain: subdomain,
                        name: dbname,
                        type: 'postgres',
                    });
                } else if (value.startsWith("modify-pass ")) {
                    let pass = value.substr("modify-pass ".length).trim();
                    if (pass) {
                        await virtExec("modify-database-pass", {
                            domain: subdomain,
                            pass,
                            type: 'postgres',
                        });
                        subdomaindata['Password for postgres'] = pass;
                        await sshExec(` PGPASSWD='${pass}'`, false);
                    }
                } else if (!value) {
                    await writeLog(`$> PostgreSQL is already initialized. To create another database, use "postgresql create dbname"`);
                }
                break;
            case 'valkey':
            case 'redis':
                const dbuser = domaindata['Username'];
                let instances = await redisExec.show(dbuser);
                subenabled = instances.length > 0;
                let matchedDB = "";
                /**
                 * @param {string} arg
                 */
                function matchDB(arg) {
                    dbname = getDbName(dbuser, domainprefix == "db" ? arg : domainprefix + '_' + arg);
                    return instances.find(x => x.startsWith(dbname + ":"))
                }
                if (value === "off") {
                    await writeLog("$> Disabling Redis");
                    if (sandbox) {
                        await writeLog("$> turning off Redis is denied");
                    } else if (subenabled) {
                        for (const db of instances) {
                            dbname = db.split(":")[0];
                            await writeLog(await redisExec.prune(dbname));
                            await writeLog(await redisExec.del(dbuser, dbname));
                        }
                    } else {
                        await writeLog("Already disabled");
                    }
                    break;
                }
                if (!subenabled) {
                    await writeLog("$> Enabling Redis");
                    dbneedcreate = true;
                }
                if (value.startsWith("create ")) {
                    let newdb = value.substr("create ".length).trim();
                    matchedDB = matchDB(newdb)
                    if (!matchedDB) {
                        dbneedcreate = true;
                    }
                }
                const passRef = { pass: undefined }
                if (dbneedcreate) {
                    await writeLog(`$> Creating db instance ${dbname} on Redis`);
                    await writeLog(await redisExec.add(domaindata['Username'], dbname, passRef));
                } else if (value.startsWith("get ")) {
                    let arg = value.substr("get ".length).trim();
                    matchedDB = matchDB(arg);
                    if (matchedDB) {
                        passRef.pass = matchedDB.split(":")[1];
                    }
                } else if (sandbox && value) {
                    await writeLog("$> managing Redis database is denied");
                    break;
                } else if (value.startsWith("drop ")) {
                    let arg = value.substr("drop ".length).trim();
                    matchedDB = matchDB(arg);
                    if (matchedDB) {
                        await writeLog(`$> Pruning db instance ${dbname} on Redis`);
                        await writeLog(await redisExec.prune(dbname));
                        await writeLog(`$> Dropping db instance ${dbname} on Redis`);
                        await writeLog(await redisExec.del(domaindata['Username'], dbname));
                    } else {
                        await writeLog(`$> DB instance ${dbname} is not found on Redis`);
                    }
                    break;
                } else if (value.startsWith("modify-pass ")) {
                    let arg = value.substr("modify-pass ".length).trim();
                    matchedDB = matchDB(arg);
                    if (matchedDB) {
                        await writeLog(`$> Regenerating password for db instance ${dbname} on Redis`);
                        await writeLog(await redisExec.passwd(domaindata['Username'], dbname, passRef));
                    }
                } else if (!value) {
                    await writeLog(`$> Redis is already initialized`);
                    matchedDB = matchDB(domainprefix)
                    if (matchedDB) {
                        passRef.pass = matchedDB.split(":")[1];
                    }
                }
                if (passRef.pass) {
                    await sshExec(` RDPASSWD='${passRef.pass}'`, false);
                    await writeLog(`$> RDPASSWD for ${dbname} is loaded`);
                } else {
                    await writeLog(`$> Database ${dbname} is not found! To create it, use "redis create dbname"`);
                }
                break;
            case 'dns':
                if (!stillroot && !enabled) {
                    await writeLog("Problem: Can't manage DNS while it is disabled in parent domain");
                    break;
                }
                if (value === "off") {
                    await writeLog("$> Disabling DNS feature");
                    if (sandbox) {
                        await writeLog("$> turning off DNS feature is denied");
                    } if (subenabled) {
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
                } else if (value == 'off') {
                    value = 'off';
                } else if (!value.includes('.')) {
                    value = getLtsPhp(value);
                }

                if (!value) {
                    throw new Error(`php version ${value} not found`);
                }

                if (value == 'off' || value.endsWith('.sock')) {
                    if (subdomaindata['PHP execution mode'] != 'none') {
                        await writeLog("$> Turning off PHP engine");
                        await virtExec("modify-web", {
                            domain: subdomain,
                            mode: 'none',
                        });
                        subdomaindata['PHP execution mode'] = 'none';
                    }
                    if (value == 'off') {
                        await sshExec(`rm -f ~/.local/bin/php`, false);
                    }
                    await writeLog("$> Updating nginx config");
                    const nginxNodes = await nginxExec.get(subdomain);
                    nginxInfos = nginxExec.extractInfo(nginxNodes, subdomain);
                    if (value != 'off') {
                        nginxInfos.fcgi = `unix:/home/${path.join(subdomaindata['Username'], value)}`
                    }
                    await writeLog(await nginxExec.setDirect(subdomain, nginxInfos));
                    break;
                }

                await writeLog("$> Changing PHP engine to " + value);

                if (subdomaindata['PHP execution mode'] == 'none') {
                    await virtExec("modify-web", {
                        domain: subdomain,
                        mode: 'fpm',
                        'php-fpm-mode': 'ondemand',
                    });
                    subdomaindata['PHP execution mode'] = 'fpm';
                }

                await virtExec("modify-web", {
                    domain: subdomain,
                    'php-version': value,
                });

                var phpVer = isDebian() ? value : value.replace('.', '');
                // TODO: This is already done by virtualmin in ~/bin?
                await sshExec(`mkdir -p ~/.local/bin; echo -e "\\u23\\u21/bin/bash\\n$(which php${phpVer}) \\u22\\u24\\u40\\u22" > ~/.local/bin/php; chmod +x ~/.local/bin/php`, false);
                break;
            case 'http':
                var nginxNodes = await nginxExec.get(subdomain);
                var nginxInfos = nginxExec.extractInfo(nginxNodes, subdomain);
                value = parseInt(value);
                if (![1, 3].includes(value)) {
                    throw new Error(`http option invalid. specify "http 1" or "http 3"`);
                }
                if (value === nginxInfos.http) {
                    await writeLog("$> http version config is set unchanged");
                } else {
                    nginxInfos.config.http = value;
                    await writeLog("$> Applying nginx http config on " + subdomain);
                    await writeLog(await nginxExec.setDirect(subdomain, nginxInfos));
                }
                break;
            case 'www':
                var nginxNodes = await nginxExec.get(subdomain);
                var nginxInfos = nginxExec.extractInfo(nginxNodes, subdomain);
                if (!['off', 'on', 'enforce', 'always'].includes(value)) {
                    throw new Error(`www option invalid. specify "www on" or "www off" or "www always"`);
                }
                if (value === nginxInfos.www) {
                    await writeLog("$> www version config is set unchanged");
                } else {
                    nginxInfos.config.www = value;
                    await writeLog("$> Applying nginx www config on " + subdomain);
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
                } else if (value == 'letsencrypt' || value == 'lets-encrypt' || value == 'renew') {
                    regenerateSsl = true;
                } else if (value == 'selfsign' || value == 'self-sign') {
                    selfSignSsl = true;
                }
                var sharedSSL = regenerateSsl ? null : detectCanShareSSL(subdomain);
                nginxNodes = await nginxExec.get(subdomain);
                nginxInfos = nginxExec.extractInfo(nginxNodes, subdomain);
                var expectCert = sharedSSL ? path.join(sharedSSL.path, 'ssl.combined') : (subdomaindata['SSL cert and CA file'] || subdomaindata['SSL cert file']);
                var expectKey = sharedSSL ? path.join(sharedSSL.path, 'ssl.key') : subdomaindata['SSL key file'];
                if ((!expectCert || !expectKey) && !regenerateSsl) {
                    expectedSslMode = 'off';
                }
                // if (force regenerate or no explicit command or ssl not match) AND it's shared ssl differ, then must break.
                if (regenerateSsl || (!expectedSslMode && !selfSignSsl) || (expectCert != nginxInfos.ssl_certificate)) {
                    if (subdomaindata['SSL shared with'] && (!sharedSSL || subdomaindata['SSL shared with'] != sharedSSL.domain)) {
                        await writeLog("$> Breaking ssl cert sharing");
                        await virtExec("modify-web", {
                            domain: subdomain,
                            'break-ssl-cert': true,
                        });
                        await new Promise(r => setTimeout(r, 1000));
                        // paths changing... need to refresh data
                        subdomaindata = await virtualminExec.getDomainInfo(subdomain);
                        nginxNodes = await nginxExec.get(subdomain);
                        nginxInfos = nginxExec.extractInfo(nginxNodes, subdomain);
                        if (!sharedSSL) {
                            expectCert = subdomaindata['SSL cert and CA file'] || subdomaindata['SSL cert file'];
                            expectKey = subdomaindata['SSL key file'];
                        }
                    }
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
                if (sharedSSL && sharedSSL.domain != subdomaindata['SSL shared with']) {
                    changed = true;
                }
                try {
                    // if NOT shared AND force LE or no explicit command, check regeration
                    if (!sharedSSL && (regenerateSsl || (!expectedSslMode && !selfSignSsl))) {
                        const remaining = subdomaindata['SSL cert expiry'] ? (Date.parse(subdomaindata['SSL cert expiry']) - Date.now()) / 86400000 : 0;
                        // if force LE or remaining > 30 days, get fresh one
                        if (!regenerateSsl && subdomaindata['SSL candidate hostnames'] == subdomain && subdomaindata['Lets Encrypt renewal'] == 'Enabled' && (remaining > 30)) {
                            await writeLog("$> SSL cert expiry is " + Math.trunc(remaining) + " days away so skipping renewal");
                            await writeLog("$> To enforce renewal please use 'ssl renew'");
                        } else {
                            await writeLog("$> Generating SSL cert with Let's Encrypt");
                            await spawnSudoUtil('OPENSSL_CLEAN');

                            await virtExec("generate-letsencrypt-cert", {
                                domain: subdomain,
                                'renew': 2,
                                'web': true,
                                'validate-first': true,
                            });
                            const nextDate = new Date();
                            nextDate.setMonth(nextDate.getMonth() + 3);
                            subdomaindata['SSL cert expiry'] = nextDate.toISOString();
                        }
                        // Regenerate self sign if
                        // 1. Explicit request || SSL off
                        // 2. Let's Encrypt renewal enabled
                        // 3. sharing SSL and was not
                    } else if ((selfSignSsl || expectedSslMode == 'off') || (subdomaindata['Lets Encrypt renewal'] == 'Enabled') || ((sharedSSL && !subdomaindata['SSL shared with'] && !expectedSslMode))) {
                        if (subdomaindata['SSL shared with']) {
                            throw new Error('Cannot turn off SSL while using shared domain!')
                        }
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
                } catch (error) {
                    throw error;
                } finally {
                    await writeLog("$> Applying nginx ssl config on " + subdomain);
                    await writeLog(await nginxExec.setDirect(subdomain, nginxInfos));
                    if (sharedSSL && subdomaindata['SSL shared with'] !== sharedSSL.domain) {
                        await writeLog("$> Applying SSL links with global domain");
                        await writeLog(await virtualminExec.pushVirtualServerConfig(subdomaindata['ID'], {
                            'ssl_same': sharedSSL.id,
                            'ssl_key': path.join(sharedSSL.path, 'ssl.key'),
                            'ssl_cert': path.join(sharedSSL.path, 'ssl.cert'),
                            'ssl_chain': path.join(sharedSSL.path, 'ssl.ca'),
                            'ssl_combined': path.join(sharedSSL.path, 'ssl.combined'),
                            'ssl_everything': path.join(sharedSSL.path, 'ssl.everything'),
                        }));
                        subdomaindata['SSL shared with'] = sharedSSL.domain
                    }
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
                    await writeLog("$> Changing root path to " + value);
                    await sshExec(`mkdir -p '${absolutePath}'`);
                    await virtExec("modify-web", {
                        domain: subdomain,
                        'document-dir': value,
                    });
                    subdomaindata['HTML directory'] = absolutePath;
                } else {
                    await writeLog("$> root path is set unchanged");
                }
                break;
        }
    };

    const htmlDir = subdomaindata['Home directory'] + '/public_html';

    async function serviceRunner(/** @type {object|string} */ services) {
        const addFlags = typeof services == 'string' ? `-f ${(
            services.match(/^[^#]+/)[0]
        )}` : '';
        if (htmlDir == subdomaindata['HTML directory']) {
            await writeLog("$> Changing root path for safety");
            await featureRunner("root public_html/public");
        }
        if (typeof services == 'string' && services.includes('/')) {
            const subDir = services.substring(0, services.lastIndexOf('/'));
            await sshExec(`cd ${htmlDir}/${subDir}`, false);
        } else {
            await sshExec(`cd ${htmlDir}`, false);
        }

        await writeLog("$> Removing docker compose services if exists");
        await sshExec(`docker compose ${addFlags} --progress quiet down --remove-orphans || true`);
        await writeLog("$> Configuring NGINX forwarding for docker");
        let d = await dockerExec.executeServices(services, htmlDir, subdomain, domaindata['Username'], writeLog);
        await writeLog("$> Writing docker compose services");
        await writeLog(d.split('\n').map(x => `  ${x}`).join('\n'));
        await writeLog("$> Applying compose services");
        // wait for https://github.com/docker/compose/pull/12458
        await sshExec(`docker compose ${addFlags} --progress plain up --build --detach`);
        await sshExec(`docker ps`);
    }

    if (config.source || config.commands || config.services) {
        await sshExec(`mkdir -p '${htmlDir}' && cd "$_"`);
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
                    if (url.protocol == 'ssh' || url.pathname.endsWith('.git') || (url.hostname.match(/^(www\.)?(github|gitlab|bitbucket)\.com$/) && !url.pathname.endsWith('.zip') && !url.pathname.endsWith('.tar.gz'))) {
                        source.type = 'clone';
                    } else {
                        source.type = 'extract';
                    }
                }
            }
            let executedCMD = [source['rootlesskit'] ? `rootlesskit rm -rf *` : `rm -rf *`];
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
                    await writeLog("$> writing SSH keys for cloning github.com repository");
                    await sshExec(`mkdir -p ~/.ssh; touch $HOME/.ssh/{id_github_com,config}; chmod 0600 $HOME/.ssh/*`, false);
                    await sshExec(`echo "${Buffer.from(source.credentials.github.ssh).toString('base64')}" | base64 --decode > $HOME/.ssh/id_github_com`, false);
                    if (source.credentials.github.sshPub) {
                        await sshExec(`echo "${Buffer.from(source.credentials.github.sshPub).toString('base64')}" | base64 --decode > $HOME/.ssh/id_github_com.pub`, false);
                    }
                    // delete old config https://stackoverflow.com/a/36111659/3908409
                    await sshExec(`sed 's/^Host/\\n&/' $HOME/.ssh/config | sed '/^Host '"github.com"'$/,/^$/d;/^$/d' > $HOME/.ssh/config`, false);
                    await sshExec(`echo "${Buffer.from(configFileContent).toString('base64')}" | base64 --decode >> ~/.ssh/config`, false);
                }
                executedCMD.push(`git clone ${escapeShell(url.toString())}` +
                    `${source.branch ? ` -b ${escapeShell(source.branch)}` : ''}` +
                    `${!source.depth || source.depth == 'blobless' ? ` --filter=blob:none` : ''}` +
                    `${source.depth == 'treeless' ? ` --filter=tree:0` : ''}` +
                    `${source.depth == 'shallow' ? ` --depth 1` : ''}` +
                    `${source.submodules ? ` --recurse-submodules` : ''}` + ' .');
                executedCMDNote = 'Cloning files';
            } else if (source.type === 'extract') {
                if (!source.directory && url.hash) {
                    source.directory = decodeURI(url.hash.substring(1));
                    url.hash = '';
                }
                if (url.pathname.endsWith('.tar.gz')) {
                    executedCMD.push(`wget -O _.tar.gz ` + escapeShell(url.toString()));
                    executedCMD.push(`tar -xzf _.tar.gz ; rm _.tar.gz`);
                } else if (url.pathname.endsWith('.tar.xz')) {
                    executedCMD.push(`wget -O _.tar.xz ` + escapeShell(url.toString()));
                    executedCMD.push(`tar -xJf _.tar.xz ; rm _.tar.xz`);
                } else if (url.pathname.endsWith('.tar.bz2')) {
                    executedCMD.push(`wget -O _.tar.bz2 ` + escapeShell(url.toString()));
                    executedCMD.push(`tar -xjf _.tar.bz2 ; rm _.tar.bz2`);
                } else {
                    executedCMD.push(`wget -O _.zip ` + escapeShell(url.toString()));
                    executedCMD.push(`unzip -q -o _.zip ; rm _.zip`);
                }
                if (source.directory) {
                    executedCMD.push(`mv ${escapeShell(source.directory)}/* .`);
                    executedCMD.push(`rm -rf ${escapeShell(source.directory)}`);
                }
                executedCMD.push('chmod -R 0750 *');
                executedCMDNote = 'Downloading files';
            }

            if (await firewallStatus()) {
                await nftablesExec.setDelUser(domaindata['Username'], domaindata['User ID']);
            }
            await writeLog("$> " + executedCMDNote);
            for (const exec of executedCMD) {
                await sshExec(exec);
            }
        }

        if (config.commands) {
            let entries = Object.entries(config.envs || {});
            entries.push(['DATABASE', dbname]);
            await sshExec(' ' + entries.map(([k, v]) => `${k}='${v}'`).join(' '), false);
            for (const cmd of config.commands) {
                if (typeof cmd === 'string') {
                    await sshExec(cmd);
                } else if (typeof cmd === 'object' && cmd !== null) {
                    if (cmd.command) {
                        await sshExec(cmd.command, cmd.write === false ? false : true);
                    } else if (cmd.feature) {
                        await featureRunner(cmd.feature);
                    } else if (cmd.services) {
                        await serviceRunner(cmd.services);
                    } else if (cmd.filename && cmd.content) {
                        await writeLog("$> writing " + cmd.filename);
                        await sshExec(`echo "${Buffer.from(cmd.content).toString('base64')}" | base64 --decode > "${cmd.filename}"`, false);
                    }
                }
            }
        }

        if (config.services) {
            await serviceRunner(config.services);
        }

    } catch (error) {
        throw error;
    } finally {
        if (config.source && await firewallStatus()) {
            await nftablesExec.setAddUser(domaindata['Username'], domaindata['User ID']);
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
