import {
    appendIfNotExist,
    checkAuth,
    checkGet,
    checkPost,
    deleteIfNotExist,
    executeLock,
    spawnSudoUtil
} from '../util.js';
import {
    generate,
    parse
} from '../parsers/named.js';
import shelljs from 'shelljs';
import path from 'path';

const {
    cat,
    ShellString
} = shelljs;

const tmpFile = path.join(process.cwd(), '/.tmp/named')

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

class NamedExecutor {
    async resync(domain) {
        await spawnSudoUtil('NAMED_SYNC', [domain]);
    }
    async show(domain) {
        return await executeLock('named', async () => {
            await spawnSudoUtil('NAMED_GET', [domain]);
            return parse(cat(tmpFile));
        });
    }
    async add(domain, type, value) {
        return await executeLock('named', async () => {
            await spawnSudoUtil('NAMED_GET', [domain]);
            var file = parse(cat(tmpFile));
            var arr = getArrayOf(file, type);
            var map = mapKey[type](("" + value).split(' '));
            if (!appendIfNotExist(arr, map)) {
                return "Done unchanged";
            }
            file.soa.serial++;
            ShellString(generate(file)).to(tmpFile);
            await spawnSudoUtil('NAMED_SET', [domain]);
            return "Done updated";
        });
    }
    async del(domain, type, value) {
        await executeLock('named', async () => {
            await spawnSudoUtil('NAMED_GET', ["" + domain]);
            var file = parse(cat(tmpFile));
            var arr = getArrayOf(file, type);
            var map = mapKey[type](("" + value).split(' '));
            if (!deleteIfNotExist(arr, map)) {
                return "Done unchanged";
            }
            file.soa.serial++;
            ShellString(generate(file)).to(tmpFile);
            await spawnSudoUtil('NAMED_SET', ["" + domain]);
            return "Done updated";
        });
    }
}

export const namedExec = new NamedExecutor();
