import express from 'express';
import {
    checkAuth,
    checkGet,
    executeLock,
    spawnSudoUtil
} from '../util.js';
import {
    generate,
    parse
} from '../parsers/named.js';
import shelljs from 'shelljs';
import path from 'path';
import _ from 'underscore';

const {
    cat,
    ShellString
} = shelljs;

const tmpFile = path.join(process.cwd(), '/.tmp/named')

const deleteIfNotExist = (arr, record) => {
    const idx = arr.findIndex((x) => _.isMatch(x, record));
    if (idx === -1) {
        return false;
    } else {
        arr.splice(idx, 1);
        return true;
    }
}
const appendIfNotExist = (arr, record) => {
    const idx = arr.findIndex((x) => _.isMatch(x, record));
    if (idx === -1) {
        arr.push(record);
        return true;
    } else {
        return false;
    }
}
const arrayKey = {
    A: 'a',
    AAAA: 'aaaa',
    NS: 'ns',
    CNAME: 'cname',
    MX: 'mx',
    PTR: 'ptr',
    TXT: 'txt',
    SRV: 'srv',
    SPF: 'spf',
    CAA: 'caa',
};
const mapKey = {
    'a': (ip) => ({
        ip
    }),
    'aaaa': (ip) => ({
        ip
    }),
    'ns': (host) => ({
        host
    }),
    'cname': (alias) => ({
        alias
    }),
    'mx': (preference, host) => ({
        preference: parseInt(preference, 10),
        host,
    }),
    'ptr': (host) => ({
        host
    }),
    'txt': (...txt) => ({
        txt: txt.join(' '),
    }),
    'srv': (priority, weight, port, target) => ({
        priority: parseInt(priority, 10),
        weight: parseInt(weight, 10),
        port: parseInt(port, 10),
        target,
    }),
    'spf': (s) => ({
        data: s
    }),
    'caa': (flags, tag, value) => ({
        flags: parseInt(flags, 10),
        tag,
        value: value.replace(new RegExp('^"(.+?)"$'), "$1"),
    }),
}

const getArrayOf = (file, type) => {
    if (!arrayKey[type])
        throw new Error('Unknown type');
    return file[arrayKey[type]] || (file[arrayKey[type]] = []);
}

export default function () {
    var router = express.Router();
    router.post('/resync', checkAuth, checkGet(['domain']), async function (req, res) {
        await spawnSudoUtil('NAMED_SYNC', ["" + req.query.domain]);
        res.json("OK");
    });
    router.get('/show', checkAuth, checkGet(['domain']), async function (req, res, next) {
        try {
            await executeLock('named', () => {
                return spawnSudoUtil('NAMED_GET', ["" + req.query.domain]);
            });
            res.json(parse(cat(tmpFile)));
        } catch (error) {
            next(error);
        }
    });
    router.post('/add', checkAuth, checkGet(['domain', 'type', 'value']), async function (req, res) {
        const r = await executeLock('named', async () => {
            await spawnSudoUtil('NAMED_GET', ["" + req.query.domain]);
            var file = parse(cat(tmpFile));
            var arr = getArrayOf(file, req.query.type);
            var map = mapKey[req.query.type](("" + req.query.value).split(' '));
            if (!appendIfNotExist(arr, map)) {
                return "Done unchanged";
            }
            file.soa.serial++;
            ShellString(generate(file)).to(tmpFile);
            return "Done updated";
        });
        res.json(r);
    });
    router.post('/del', checkAuth, checkGet(['domain', 'type', 'value']), async function (req, res) {
        const r = await executeLock('named', async () => {
            await spawnSudoUtil('NAMED_GET', ["" + req.query.domain]);
            var file = parse(cat(tmpFile));
            var arr = getArrayOf(file, req.query.type);
            var map = mapKey[req.query.type](("" + req.query.value).split(' '));
            if (!deleteIfNotExist(arr, map)) {
                return "Done unchanged";
            }
            file.soa.serial++;
            ShellString(generate(file)).to(tmpFile);
            return "Done updated";
        });
        res.json(r);
    });
    return router;
}