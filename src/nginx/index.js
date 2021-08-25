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
import e from 'express';
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
    'document_root', 'base_uri', 'app_root'
];
const locationKeys = [
    "root", "alias", "rewrite", "try_files", "return"
];
const sslNames = ["", "off", "enforce", "on"];
const extractInfo = (node, domain) => {
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
        // }
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
export default function () {
    var router = express.Router();
    router.get('/', checkAuth, checkGet(['domain']), async function (req, res, next) {
        try {
            await executeLock('nginx', () => {
                return spawnSudoUtil('NGINX_GET');
            })
            NginxConfFile.create(tmpFile, (err, conf) => {
                if (err)
                    return next(err);
                try {
                    let node = conf.nginx;
                    if (req.query.domain !== 'all')
                        node = findServ(node.http[0].server, req.query.domain);
                    if (req.query.view === 'raw') {
                        res.contentType('text/plain');
                        res.send(node.toString());
                    } else {
                        res.json(extractInfo(node, req.query.domain));
                    }
                } catch (error) {
                    next(error);
                }
            });
        } catch (error) {
            next(error);
        }
    });
    router.post('/', checkAuth, checkGet(['domain']), async function (req, res, next) {
        await executeLock('nginx', async () => {
            await spawnSudoUtil('NGINX_GET');
            NginxConfFile.create(tmpFile, (err, conf) => {
                if (err)
                    return next(err);
                let node = findServ(conf.nginx.http[0].server, req.query.domain);
                conf.nginx.http[0]._comments
                res.contentType('text/plain');
                res.send(node.toString());
            });
        })

    });
    return router;
}