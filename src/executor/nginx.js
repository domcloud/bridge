import express from 'express';
import {
    checkAuth,
    checkGet,
    executeLock,
    spawnSudoUtil
} from '../util.js';
import path from 'path';
import _ from 'underscore';
// import Parser from '../parsers/nginx.js';
import shelljs from 'shelljs';
import parser, {
    NginxConfFile
} from 'nginx-conf';
const tmpFile = path.join(process.cwd(), '/.tmp/nginx')
const {
    cat,
    ShellString
} = shelljs;

const findServ = (arr, name) => {
    return arr.find((x) => (x.server_name[0]._value).split(" ").includes(name));
}
const passengerKeys = [
    'enabled', 'app_env', 'app_start_command', 'app_type',
    'startup_file', 'ruby', 'nodejs', 'python',
    'meteor_app_settings', 'friendly_error_pages',
    'document_root', 'base_uri', 'app_root', 'sticky_sessions'
];
const locationKeys = [
    "root", "alias", "rewrite", "try_files", "return"
];
const sslNames = ["", "off", "enforce", "on"];

class NginxExecutor {
    /** @param {import('nginx-conf/dist/src/conf').NginxConfItem} node */
    applyInfo(node, info) {
        /** @param {import('nginx-conf/dist/src/conf').NginxConfItem} node */
        function expandLocation(node, info) {
            for (const key of locationKeys) {
                if (info[key]) {
                    node._add(key, key === "root" || key === "alias" ?
                        path.join(`/home/${info.user}`, info[key]) : info[key]);
                }
            }
            if (info.passenger) {
                for (const key of passengerKeys) {
                    if (info.passenger[key]) {
                        node._add("passenger_" + key, key === "document_root" || key === "app_root" ?
                            path.join(`/home/${info.user}`, info.passenger[key]) : info.passenger[key]);
                    }
                }
            }
            if (info.locations && info.locations.length > 0) {
                for (const loc of info.locations) {
                    if (loc.match) {
                        var n = node._add("location", loc.match);
                        expandLocation(n, loc);
                    }
                }
            }
            if (info.fastcgi) {
                switch (info.fastcgi) {
                    case "on":
                        var n = node._add("location", "~ \\.php(/|$)");
                        n._add("try_files", '$uri =404');
                        n._add("fastcgi_pass", info.fcgi);
                        break;
                    case "off":
                        var n = node._add("location", "= .actuallydisabledphpexecution");
                        n._add("return", '404');
                        n._add("fastcgi_pass", info.fcgi);
                        break;
                    case "cached":
                        n._add("try_files", '$uri =404');
                        n._add("fastcgi_pass", info.fcgi);
                        n._add("fastcgi_cache", "phpcache");
                        break;
                    case "wpcached":
                        n._add("try_files", '$uri =404');
                        n._add("fastcgi_pass", info.fcgi);
                        n._add("fastcgi_cache", "phpcache");
                        break;
                }
            }
        }
        Object.getOwnPropertyNames(node).forEach(function (prop) {
            delete node[prop];
        });
        node._add('server_name', info.dom);
        if (info.config.ssl !== "enforce") {
            node._add('listen', info.ip);
            node._add('listen', info.ip6);
        }
        if (info.config.ssl !== "off") {
            node._add('listen', info.ip + ":443 ssl http2");
            node._add('listen', info.ip6 + ":443 ssl http2");
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
                        r.fastcgi = r.fastcgi_cache || "on";
                    } else {
                        r.locations.push(extractLocations(l, basepath));
                    }
                }
                if (r.locations.length === 0)
                    delete r.locations;
            }
            for (const k of Object.keys(node)) {
                if (k.startsWith("passenger_") && passengerKeys.includes(k.slice("passenger_".length))) {
                    const ke = k.slice("passenger_".length);
                    r.passenger = r.passenger || {};
                    r.passenger[ke] = node[k][0]._value;
                    if (ke === "document_root" || ke === "app_root") {
                        r.passenger[ke] = r.passenger[ke].slice(basepath.length);
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
            // else if (l._comments && l._comments.length > 0 && l._comments[0].trim().match(/^fastcgi_pass localhost:\[\d{4,5}\]$/)) {
            //     return l._comments[0].trim().split(' ')[1];
            // } // read in comments
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
        });
        data.root = node.root ? node.root[0]._value : "";
        data.user = data.root.split('/')[2];
        data.access_log = node.access_log[0]._value;
        data.error_log = node.error_log[0]._value;
        data.ssl_certificate = node.ssl_certificate[0]._value;
        data.ssl_certificate_key = node.ssl_certificate_key[0]._value;

        data.fcgi = findFastCgi(node);
        data.config = extractLocations(node, `/home/${data.user}/`);
        delete data.config.match;
        delete data.config.root;
        delete data.config.alias;
        data.config.ssl = sslNames[data.ssl];
        if (!data.config.fastcgi)
            data.config.fastcgi = "off";
        if (node.error_page) {
            data.config.error_pages = [];
            node.error_page.map(x => data.config.error_pages.push(x._value));
        }
        return data;
    }
    async get(domain) {
        return await executeLock('nginx', () => {
            return new Promise((resolve, reject) => {
                spawnSudoUtil('NGINX_GET').then(() => {
                    NginxConfFile.create(tmpFile, (err, conf) => {
                        if (err)
                            return reject(err);
                        try {
                            let node = conf.nginx;
                            if (domain !== 'all')
                                node = findServ(node.http[0].server, domain);
                            return resolve(node);
                        } catch (error) {
                            return reject(error);
                        }
                    });
                }).catch(reject);
            });
        })
    }
    async set(domain, config) {
        return await executeLock('nginx', () => {
            return new Promise((resolve, reject) => {
                spawnSudoUtil('NGINX_GET').then(() => {
                    NginxConfFile.create(tmpFile, async (err, conf) => {
                        if (err)
                            return reject(err);
                        const node = findServ(conf.nginx.http[0].server, domain);
                        const info = this.extractInfo(node, domain);
                        info.config = config;
                        this.applyInfo(node, info);
                        conf.write(async (e) => {
                            if (e)
                                return reject(err);
                            await spawnSudoUtil('NGINX_SET');
                            return resolve("Done updated");
                        });
                    });
                }).catch(reject);
            });
        })
    }
}
export const nginxExec = new NginxExecutor();
