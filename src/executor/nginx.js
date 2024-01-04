import {
    cat,
    escapeNginx,
    executeLock,
    spawnSudoUtil,
    splitLimit,
    unescapeNginx,
    writeTo
} from '../util.js';
import path from 'path';
import {
    NginxConfFile
} from 'nginx-conf';

const tmpFile = path.join(process.cwd(), '/.tmp/nginx')

const passengerKeys = [
    'enabled', 'app_env', 'env_var_list', 'set_header_list', 'app_start_command',
    'app_type', 'startup_file', 'ruby', 'nodejs', 'python',
    'meteor_app_settings', 'friendly_error_pages',
    'document_root', 'base_uri', 'app_root', 'sticky_sessions'
];
const locationKeys = [
    "root", "alias", "rewrite", "try_files", "return", "index", "expires", "allow", "deny",
];
const sslNames = ["", "off", "always", "on"];

class NginxExecutor {
    /** @param {import('nginx-conf/dist/src/conf').NginxConfItem} node */
    applyInfo(node, info) {
        /** @param {import('nginx-conf/dist/src/conf').NginxConfItem} node */
        function expandLocation(node, config) {
            for (const key of locationKeys) {
                if (config[key]) {
                    node._add(key, key === "root" || key === "alias" ?
                        path.join(`/home/${info.user}`, config[key]) : config[key]);
                }
            }
            if (config.passenger) {
                for (const key of passengerKeys) {
                    if (config.passenger[key]) {
                        let vall;
                        switch (key) {
                            case "env_var_list":
                                config.passenger[key].forEach((/** @type {String} */ v) => {
                                    var splt = splitLimit(v, /[= ]/g, 2);
                                    if (splt.length == 2) {
                                        node._add("passenger_env_var", splt[0] + ' ' + escapeNginx(splt[1]));
                                    }
                                });
                                continue;
                            case "set_header_list":
                                config.passenger[key].forEach((/** @type {String} */ v) => {
                                    var splt = splitLimit(v, /[= ]/g, 2);
                                    if (splt.length == 2) {
                                        node._add("passenger_set_header", splt[0] + ' ' + escapeNginx(splt[1]));
                                    }
                                });
                                continue;
                            case "document_root":
                            case "app_root":
                            case "ruby":
                            case "nodejs":
                            case "python":
                            case "meteor_app_settings":
                                // expand home path
                                vall = path.join(`/home/${info.user}`, config.passenger[key]);
                                break;
                            default:
                                vall = escapeNginx(config.passenger[key]);
                                break;
                        }
                        node._add("passenger_" + key, vall);
                    }
                }
            }
            if (config.locations && config.locations.length > 0) {
                for (const loc of config.locations) {
                    if (loc.match) {
                        node._add("location", loc.match);
                        expandLocation(node.location[node.location.length - 1], loc);
                    }
                }
            }
            if (config.fastcgi) {
                node._add("location", "~ \\.php" + (config.fastcgi == 'always' ? "(/|$)" : "$"));
                var n = node.location[node.location.length - 1];
                switch (config.fastcgi) {
                    case "on":
                    default:
                        n._add("try_files", "$uri =404");
                        break;
                    case "off":
                        n._add("return", "404");
                        break;
                    case "always":
                        break;
                }
                n._add("fastcgi_pass", info.fcgi);
            }
        }
        // remove all properties
        Object.getOwnPropertyNames(node).forEach(function (prop) {
            if (prop.startsWith("_")) return;
            while (node[prop] && node[prop].length > 0) {
                node._remove(prop);
            }
        });
        node._add('server_name', info.dom);
        let sslconf = info.config.ssl || sslNames[info.ssl];
        let httpconf = info.config.http || info.http;
        if (sslconf !== "enforce" && sslconf !== "always") {
            node._add('listen', info.ip);
            node._add('listen', info.ip6);
        }
        if (sslconf !== "off") {
            var postfix = httpconf == 1 ? '' : ' http2';
            node._add('listen', info.ip + ":443 ssl" + postfix);
            node._add('listen', info.ip6 + ":443 ssl" + postfix);
        } {
            node._add('root', info.root);
            node._add('access_log', info.access_log);
            node._add('error_log', info.error_log);
            node._add('ssl_certificate', info.ssl_certificate);
            node._add('ssl_certificate_key', info.ssl_certificate_key);
        }
        if (info.config.error_pages && info.config.error_pages.length > 0) {
            for (const error_page of info.config.error_pages) {
                node._add('error_page', error_page);
            }
        }
        info.config.fastcgi = info.config.fastcgi || "off";
        info.config.index = info.config.index || "index.html index.php";
        delete info.config.root;
        delete info.config.alias;
        expandLocation(node, info.config);
    }
    extractInfo(node, domain) {
        const extractLocations = (node, basepath) => {
            const r = {};
            if (node.location) {
                r.locations = [];
                for (const l of (node.location)) {
                    if (l.fastcgi_pass) {
                        if (l.return) {
                            r.fastcgi = "off";
                        } else if (l.try_files) {
                            r.fastcgi = "on";
                        } else {
                            r.fastcgi = "always";
                        }
                    } else {
                        r.locations.push(extractLocations(l, basepath));
                    }
                }
                if (r.locations.length === 0)
                    delete r.locations;
            }
            for (const k of Object.keys(node)) {
                if (k.startsWith("passenger_")) {
                    const ke = k.slice("passenger_".length);
                    const ve = node[k][0]._value + '';
                    r.passenger = r.passenger || {};
                    switch (ke) {
                        case "env_var":
                            r.passenger["env_var_list"] = r.passenger["env_var_list"] || [];
                            for (const env of node[k]) {
                                var splt = splitLimit(env._value, / /g, 2);
                                if (splt.length == 2) {
                                    r.passenger["env_var_list"].push(splt[0] + '=' + unescapeNginx(splt[1]));
                                }
                            }
                            break;
                        case "set_header":
                            r.passenger["set_header_list"] = r.passenger["set_header_list"] || [];
                            for (const env of node[k]) {
                                var splt = splitLimit(env._value, / /g, 2);
                                if (splt.length == 2) {
                                    r.passenger["set_header_list"].push(splt[0] + ' ' + unescapeNginx(splt[1]));
                                }
                            }
                            break;
                        case "document_root":
                        case "app_root":
                        case "ruby":
                        case "nodejs":
                        case "python":
                        case "meteor_app_settings":
                            // expand home path
                            r.passenger[ke] = ve.slice(basepath.length);
                            break;
                        default:
                            r.passenger[ke] = unescapeNginx(ve);
                            break;
                    }
                }
                if (locationKeys.includes(k)) {
                    r[k] = node[k][0]._value;
                    if (k === "root" || k === "alias") {
                        r[k] = r[k].slice(basepath.length);
                    }
                }
            }
            if (node._value)
                r.match = node._value;
            return r;
        }
        const findFastCgi = (l) => {
            if (l.fastcgi_pass) return l.fastcgi_pass[0]._value;
            else if (l.location) {
                for (const ll of l.location) {
                    var r = findFastCgi(ll);
                    if (r)
                        return r;
                }
            }
            return null;
        }
        const data = {
            ssl: 0, // binary of 1 = HTTP, 2 = HTTPS
            http: 2, // http version (1 or 2)
            dom: null,
            ip: null,
            ip6: null,
            root: null,
            user: null,
            fcgi: null,
            access_log: null,
            error_log: null,
            ssl_certificate: null,
            ssl_certificate_key: null,
            config: {},
        };
        data.dom = domain;
        node.listen.forEach(x => {
            let ip = ("" + x._value).split(" ")[0];
            if (ip.endsWith(":443"))
                ip = ip.slice(0, -4);
            data[ip.startsWith("[") ? "ip6" : "ip"] = ip;
            data.ssl |= x._value.includes("ssl") ? 2 : 1;
            if (x._value.includes("ssl")) data.http = x._value.includes('http2') ? 2 : 1;
        });
        data.root = node.root ? node.root[0]._value : "";
        data.user = data.root.split('/')[2];
        data.access_log = node.access_log[0]._value;
        data.error_log = node.error_log[0]._value;
        data.ssl_certificate = node.ssl_certificate ? node.ssl_certificate[0]._value : `/home/${data.user}/ssl.cert`;
        data.ssl_certificate_key = node.ssl_certificate_key ? node.ssl_certificate_key[0]._value : `/home/${data.user}/ssl.key`;

        data.fcgi = findFastCgi(node);
        data.config = extractLocations(node, `/home/${data.user}/`);
        delete data.config.match;
        delete data.config.alias;
        data.config.ssl = sslNames[data.ssl];
        if (data.http !== 2)
            data.config.http = data.http;
        if (!data.config.fastcgi)
            data.config.fastcgi = "off";
        if (node.error_page) {
            data.config.error_pages = [];
            node.error_page.map(x => data.config.error_pages.push(x._value));
        }
        return data;
    }
    /**
     * @param {string} domain
     */
    async get(domain) {
        return await executeLock('nginx', () => {
            return new Promise((resolve, reject) => {
                spawnSudoUtil('NGINX_GET', [domain]).then(() => {
                    NginxConfFile.create(tmpFile, (err, conf) => {
                        if (err)
                            return reject(err);
                        try {
                            let node = conf.nginx;
                            return resolve(node.server[0]);
                        } catch (error) {
                            return reject(error);
                        }
                    });
                }).catch(reject);
            });
        })
    }
    /**
     * @param {string} domain
     * @param {any} config
     */
    async set(domain, config) {
        return await executeLock('nginx', async () => {
            await spawnSudoUtil('NGINX_GET', [domain]);
            return await new Promise((resolve, reject) => {
                var src = cat(tmpFile).toString();
                NginxConfFile.createFromSource(src, (err, conf) => {
                    if (err)
                        return reject(err);
                    const node = conf.nginx.server[0];
                    if (!node) {
                        return reject(new Error(`Cannot find domain ${domain}`));
                    }
                    const info = this.extractInfo(node, domain);
                    info.config = config;
                    this.applyInfo(node, info);
                    writeTo(tmpFile, conf.toString());
                    spawnSudoUtil('NGINX_SET', [domain]).then(() => {
                        resolve("Done updated\n" + node.toString());
                    }).catch((err) => {
                        reject(err);
                    })
                });
            });
        })
    }
    /**
     * @param {string} domain
     * @param {any} info
     */
    async setDirect(domain, info) {
        return await executeLock('nginx', async () => {
            await spawnSudoUtil('NGINX_GET', [domain]);
            return await new Promise((resolve, reject) => {
                var src = cat(tmpFile).toString();
                NginxConfFile.createFromSource(src, (err, conf) => {
                    if (err)
                        return reject(err);
                    const node = conf.nginx.server[0];
                    if (!node) {
                        return reject(new Error(`Cannot find domain ${domain}`));
                    }
                    this.applyInfo(node, info);
                    writeTo(tmpFile, conf.toString());
                    spawnSudoUtil('NGINX_SET', [domain]).then(() => {
                        resolve("Done updated\n" + node.toString());
                    }).catch((err) => {
                        reject(err);
                    })
                });
            });
        })
    }
    /**
     * @param {string} domain
     * @param {string} ssl
     * @param {string} http
     */
    async setSsl(domain, ssl, http) {
        return await executeLock('nginx', async () => {
            await spawnSudoUtil('NGINX_GET', [domain]);
            return await new Promise((resolve, reject) => {
                var src = cat(tmpFile).toString();
                // https://github.com/virtualmin/virtualmin-nginx/issues/18
                src = src.replace(/ default_server/g, '');
                NginxConfFile.createFromSource(src, (err, conf) => {
                    if (err)
                        return reject(err);
                    const node = conf.nginx.server[0];
                    if (!node) {
                        return reject(new Error(`Cannot find domain ${domain}`));
                    }
                    const info = this.extractInfo(node, domain);
                    if (ssl) {
                        if (!["off", "always", "on"].includes(ssl)) {
                            return reject(new Error(`Invalid ssl value ${ssl}`));
                        }
                        info.config.ssl = ssl;
                    }
                    if (http) {
                        if (!["1", "2"].includes(http)) {
                            return reject(new Error(`Invalid http value ${http}`));
                        }
                        info.config.http = http;
                    }
                    this.applyInfo(node, info);
                    writeTo(tmpFile, conf.toString());
                    spawnSudoUtil('NGINX_SET', [domain]).then(() => {
                        resolve("Done updated\n" + node.toString());
                    }).catch((err) => {
                        reject(err);
                    })
                });
            });
        })
    }
}
export const nginxExec = new NginxExecutor();