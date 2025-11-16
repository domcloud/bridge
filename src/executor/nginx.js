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
    "root", "alias", "rewrite", "try_files", "return", "index",
    "expires", "allow", "deny", "autoindex", "proxy_pass",
    "limit_except", "limit_rate", "limit_rate_after", "default_type"
];
const sslNames = ["", "off", "always", "on"];
const wwwNames = ["", "off", "always", "on"];

class NginxExecutor {
    /** @param {import('nginx-conf/dist/src/conf').NginxConfItem} node */
    applyInfo(node, info) {
        /** @param {import('nginx-conf/dist/src/conf').NginxConfItem} node */
        function expandLocation(node, config) {
            for (const key of locationKeys) {
                if (!config[key]) {
                    // do nothing
                } else if (key === "root" || key == "alias") {
                    node._add(key, path.join(`/home/${info.user}`, config[key]));
                } else if (key === "proxy_pass") {
                    if (/^http:\/\/(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\]):\d+(\$\w+|\/.*)?$/.test(config[key])) {
                        node._add(key, config[key]);
                    }
                } else if (key == "limit_except") {
                    node._add(key, config[key], [{
                        children: null,
                        comments: null,
                        isBlock: false,
                        isVerbatim: false,
                        name: "deny",
                        parent: null,
                        value: "all",
                    }]);
                } else {
                    node._add(key, config[key]);
                }
            }
            if (Array.isArray(config.rewrite_list)) {
                for (const rewrite of config.rewrite_list) {
                    node._add("rewrite", rewrite);
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
            if (config.fastcgi && info.fcgi) {
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
        let wwwconf = info.config.www || wwwNames[info.www];
        if (wwwconf === "enforce" || wwwconf === "always") {
            node._add('server_name', 'www.' + info.dom);
        } else if (wwwconf == "on") {
            node._add('server_name', 'www.' + info.dom + ' ' + info.dom);
        } else {
            node._add('server_name', info.dom);
        }
        let sslconf = info.config.ssl || sslNames[info.ssl];
        let httpconf = info.config.http || info.http;
        if (sslconf !== "enforce" && sslconf !== "always") {
            node._add('listen', info.ip ? info.ip + ":80" : "80");
            node._add('listen', (info.ip6 || '[::]') + ":80");
        }
        if (sslconf !== "off") {
            node._add('listen', info.ip ? info.ip + ":443 ssl" : "443 ssl");
            node._add('listen', (info.ip6 || '[::]') + ":443 ssl");
            if (httpconf == 3) {
                node._add('listen', info.ip ? info.ip + ":443 quic" : "443 quic");
                node._add('listen', (info.ip6 || '[::]') + ":443 quic");
                node._add('http3', "on");
                node._add('add_header', `Alt-Svc 'h3=":443"; ma=86400'`);
            }
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
        if (info.config?.proxy_pass) {
            if (!Array.isArray(info.config.locations) || info.config.locations.length == 0 || info.config.locations[0].match != '/') {
                info.config.locations = [{ match: '/' }, ...(info.config.locations || [])];
            }
            info.config.locations[0].proxy_pass = info.config.proxy_pass;
            delete info.config?.proxy_pass;
        }
        expandLocation(node, info.config);
        if (info.free) {
            if (!Array.isArray(node.location)) {
                node._add('location', '/')
            }
            let idx = node.location.findIndex(x => x._value == '/');
            if (idx == -1) {
                node._add('location', '/')
                idx = node.location.length - 1;
            }
            const anyL = node.location[idx];
            if (anyL.try_files?.length > 0) {
                // if has try_files, then combined if method would break it
                // https://stackoverflow.com/a/39594559/3908409
                anyL._add('if', `($http_referer !~ "^https?://${info.dom}")`);
                anyL.if[0]._add('rewrite', '^ /deceptive.html last');
            } else {
                // Used as multiple AND logic Trick
                // https://ezecodes.wordpress.com/2016/06/30/multiple-if-conditions-in-nginx/
                anyL._add('if', `($http_referer !~ "^https?://${info.dom}")`);
                anyL._add('if', `($http_accept ~ "^text/html")`);
                anyL._add('if', `($http_user_agent ~ "^Mozilla")`);
                anyL._add('if', `($reject = "123")`);
                anyL.if[0]._add('set', '$reject "${reject}1"');
                anyL.if[1]._add('set', '$reject "${reject}2"');
                anyL.if[2]._add('set', '$reject "${reject}3"');
                anyL.if[3]._add('rewrite', '^ /deceptive.html last');
            }
            node._add('location', '= /deceptive.html', []);
            const iloc = node.location[node.location.length - 1]
            iloc._add('root', '/usr/local/share/www');
            iloc._add('internal');
        }
    }
    /**
     * 
     * @param {import('nginx-conf/dist/src/conf').NginxConfItem} node
     * @param {string} domain 
     */
    extractInfo(node, domain) {
        const extractLocations = (node, info) => {
            const r = {};
            if (node.location) {
                r.locations = [];
                for (const l of (node.location)) {
                    if (l.fastcgi_pass || /^~ "?\.php/.test(l._value)) {
                        if (l.return || !l.fastcgi_pass) {
                            r.fastcgi = "off";
                        } else if (l.try_files) {
                            r.fastcgi = "on";
                        } else {
                            r.fastcgi = "always";
                        }
                    } else {
                        let mm = extractLocations(l, info);
                        if (mm.match === '= /deceptive.html') {
                            continue;
                        } else if (Object.keys(mm).length == 1) {
                            continue;
                        }
                        r.locations.push(mm);
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
                            r.passenger[ke] = ve.slice(info.home.length);
                            break;
                        default:
                            r.passenger[ke] = unescapeNginx(ve);
                            break;
                    }
                }
                if (locationKeys.includes(k)) {
                    const v = node[k][0]._value;
                    if (k === "root" || k === "alias") {
                        r[k] = v.slice(info.home.length);
                    } else if (k == "rewrite") {
                        if (r["rewrite"]) {
                            r["rewrite_list"] = [r["rewrite"], v]
                            delete r["rewrite"];
                        } else if (Array.isArray(r["rewrite_list"])) {
                            r["rewrite_list"].push(v);
                        } else {
                            r["rewrite_list"] = [v]
                        }
                    } else {
                        r[k] = v;
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
            www: 1, // binary of 1 = apex, 2 = www
            http: 1, // http version (1 or 2)
            dom: null,
            ip: null,
            ip6: null,
            root: null,
            user: null,
            home: null,
            fcgi: null,
            free: false,
            access_log: null,
            error_log: null,
            ssl_certificate: null,
            ssl_certificate_key: null,
            config: {},
        };
        data.dom = domain;
        data.free = process.env.NGINX_FREE_DOMAIN && (domain + '').endsWith(process.env.NGINX_FREE_DOMAIN)
        node.listen.forEach(x => {
            let ip = ("" + x._value).split(" ")[0];
            if (ip.endsWith(":443"))
                ip = ip.slice(0, -4);
            else if (ip.endsWith(":80"))
                ip = ip.slice(0, -3);
            else if (ip === "80" || ip === "443")
                ip = "";
            data[ip.startsWith("[") ? "ip6" : "ip"] = ip;
            data.ssl |= ("" + x._value).includes("ssl") ? 2 : 1;
        });
        if (node.http3?.[0]._value == "on") {
            data.http = 3;
        }
        let servernames = ((node.server_name[0]?._value || '') + '').split(' ');
        let hasApex = servernames.includes(domain);
        let hasWww = servernames.includes('www.' + domain);
        data.www = (hasApex ? 1 : 0) + (hasWww ? 2 : 0);
        data.root = node.root[0]?._value || "";
        data.user = data.root.split('/')[2];
        data.home = `/home/${data.user}/`;
        data.access_log = node.access_log[0]?._value;
        data.error_log = node.error_log[0]?._value;
        data.ssl_certificate = node.ssl_certificate[0]?._value;
        data.ssl_certificate_key = node.ssl_certificate_key[0]?._value;

        data.fcgi = findFastCgi(node);
        data.config = extractLocations(node, data);
        delete data.config.match;
        delete data.config.alias;
        data.config.ssl = sslNames[data.ssl];
        if (data.http !== 1)
            data.config.http = data.http;
        if (data.www !== 1)
            data.config.www = wwwNames[data.www];
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
    get(domain) {
        return executeLock('nginx', () => {
            return new Promise((resolve, reject) => {
                spawnSudoUtil('NGINX_GET', [domain]).then(() => {
                    NginxConfFile.create(tmpFile, (err, conf) => {
                        if (err)
                            return reject(err);
                        const node = conf.nginx.server?.[0];
                        if (!node) {
                            return reject(new Error(`Cannot find domain ${domain}`));
                        }
                        return resolve(node);
                    });
                }).catch(reject);
            });
        })
    }
    /**
     * @param {string} domain
     * @param {any} config
     */
    set(domain, config) {
        return executeLock('nginx', async () => {
            await spawnSudoUtil('NGINX_GET', [domain]);
            const src = await cat(tmpFile);
            const conf = await new Promise((resolve, reject) => {
                NginxConfFile.createFromSource(src, (err, conf) => {
                    if (err)
                        return reject(err);
                    const node = conf.nginx.server?.[0];
                    if (!node) {
                        return reject(new Error(`Cannot find domain ${domain}`));
                    }
                    const info = this.extractInfo(node, domain);
                    if (typeof config === 'string') {
                        // experimental parse from string
                        NginxConfFile.createFromSource(config, (err, rawConf) => {
                            if (err)
                                return reject(err);
                            const rawNode = rawConf.nginx.server?.[0] || rawConf.nginx;
                            const rawInfo = this.extractInfo(rawNode, domain);
                            info.config = rawInfo.config;
                            this.applyInfo(node, info);
                            resolve(conf);
                        })
                    } else {
                        info.config = config;
                        this.applyInfo(node, info);
                        resolve(conf);
                    }
                });
            });
            const dst = conf.toString();
            if (src === dst) {
                return "Nothing changed";
            }
            await writeTo(tmpFile, conf.toString());
            await spawnSudoUtil('NGINX_SET', [domain]);
            return "Done updated\n" + conf.toString();
        })
    }
    /**
     * @param {string} domain
     * @param {any} info
     */
    setDirect(domain, info) {
        return executeLock('nginx', async () => {
            await spawnSudoUtil('NGINX_GET', [domain]);
            var src = await cat(tmpFile);
            return await new Promise((resolve, reject) => {
                NginxConfFile.createFromSource(src, (err, conf) => {
                    if (err)
                        return reject(err);
                    const node = conf.nginx.server[0];
                    if (!node) {
                        return reject(new Error(`Cannot find domain ${domain}`));
                    }
                    this.applyInfo(node, info);
                    const dst = conf.toString();
                    if (src === dst) {
                        return resolve("Nothing changed");
                    }
                    writeTo(tmpFile, dst)
                        .then(() => spawnSudoUtil('NGINX_SET', [domain]))
                        .then(() => {
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
    setSsl(domain, ssl, http) {
        return executeLock('nginx', async () => {
            await spawnSudoUtil('NGINX_GET', [domain]);
            var src = await cat(tmpFile);
            return await new Promise((resolve, reject) => {
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
                        if (!["1", "3"].includes(http)) {
                            return reject(new Error(`Invalid http value ${http}`));
                        }
                        info.config.http = http;
                    }
                    this.applyInfo(node, info);
                    writeTo(tmpFile, conf.toString())
                        .then(() => spawnSudoUtil('NGINX_SET', [domain]))
                        .then(() => {
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