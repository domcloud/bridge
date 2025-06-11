import {
    appendIfNotExist,
    cat,
    deleteIfExist,
    executeLock,
    spawnSudoUtil,
    turnNsToAbsolute,
    writeTo
} from '../util.js';
import {
    generate,
    parse
} from '../helpers/named.js';
import path from 'path';

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
    'a': ( /** @type {string} */ name, /** @type {string} */ ip) => ({
        name,
        ip
    }),
    'aaaa': ( /** @type {string} */ name, /** @type {string} */ ip) => ({
        name,
        ip
    }),
    'ns': ( /** @type {string} */ name, /** @type {string} */ host) => ({
        name,
        host
    }),
    'cname': ( /** @type {string} */ name, /** @type {string} */ alias) => ({
        name,
        alias
    }),
    'mx': ( /** @type {string} */ name, /** @type {string} */ preference, /** @type {string} */ host) => ({
        name,
        preference: parseInt(preference, 10),
        host,
    }),
    'ptr': ( /** @type {string} */ name, /** @type {string} */ host) => ({
        name,
        host
    }),
    'txt': ( /** @type {string} */ name, /** @type {string[]} */ ...txt) => ({
        name,
        txt: txt.join(' '),
    }),
    'srv': ( /** @type {string} */ name, /** @type {string} */ priority, /** @type {string} */ weight, /** @type {string} */ port, /** @type {string} */ target) => ({
        name,
        priority: parseInt(priority, 10),
        weight: parseInt(weight, 10),
        port: parseInt(port, 10),
        target,
    }),
    'spf': ( /** @type {string} */ name, /** @type {string} */ s) => ({
        name,
        data: s
    }),
    'caa': ( /** @type {string} */ name, /** @type {string} */ flags, /** @type {string} */ tag, /** @type {string} */ value) => ({
        name,
        flags: parseInt(flags, 10),
        tag,
        value: value.replace(new RegExp('^"(.+?)"$'), "$1"),
    }),
}

const getArrayOf = ( /** @type {any} */ file, /** @type {keyof typeof arrayKey | String} */ type) => {
    if (!arrayKey[type])
        throw new Error('Unknown type ' + type);
    return file[arrayKey[type]] || (file[arrayKey[type]] = []);
}

class NamedExecutor {
    /**
     * @param {string} zone
     */
    async resync(zone) {
        await spawnSudoUtil('NAMED_SYNC', [zone]);
    }
    /**
     * @param {string} zone
     */
    async show(zone) {
        return await executeLock('named', async () => {
            await spawnSudoUtil('NAMED_GET', [zone]);
            const file = cat(tmpFile);
            return { 
                ...parse(file),
                raw: file
            };
        });
    }
    /**
     * @param {string} zone
     * @param {string} domain
     * @param {string} type
     * @param {string} value
     */
    async add(zone, domain, type, value) {
        return await executeLock('named', async () => {
            await spawnSudoUtil('NAMED_GET', [zone]);
            var file = parse(cat(tmpFile));
            var arr = getArrayOf(file, type);
            var map = mapKey[type](domain, ...("" + value).split(' '));
            if (!appendIfNotExist(zone, arr, map)) {
                return "Done unchanged";
            }
            file.soa.serial++;
            writeTo(tmpFile, generate(file));
            await spawnSudoUtil('NAMED_SET', [zone]);
            return "Done updated";
        });
    }
    /**
     * @param {string} zone
     * @param {string} domain
     * @param {string} type
     * @param {string} value
     */
    async del(zone, domain, type, value) {
        await executeLock('named', async () => {
            await spawnSudoUtil('NAMED_GET', ["" + zone]);
            var file = parse(cat(tmpFile));
            var arr = getArrayOf(file, type);
            var map = mapKey[type](domain, ...("" + value).split(' '));
            if (!deleteIfExist(zone, arr, map)) {
                return "Done unchanged";
            }
            file.soa.serial++;
            writeTo(tmpFile, generate(file));
            await spawnSudoUtil('NAMED_SET', ["" + zone]);
            return "Done updated";
        });
    }
    /**
     * @param {string} zone
     * @param {{action: string, domain: string, type: string, value: string}[]} mods
     */
    async set(zone, mods) {
        return await executeLock('named', async () => {
            await spawnSudoUtil('NAMED_GET', ["" + zone]);
            var file = parse(cat(tmpFile));
            var changecount = 0;
            if (!Array.isArray(mods)) {
                mods = [mods];
            }
            for (let mod of mods) {
                if (!mod || !mod.action || !mod.domain || !mod.type || !mod.value) {
                    return "Invalid config";
                }
                var action = mod.action.toLowerCase();
                var arr = getArrayOf(file, mod.type.toUpperCase());
                var domain = turnNsToAbsolute((mod.domain || '').toLowerCase(), zone);
                var map = mapKey[mod.type.toLowerCase()](domain, ...("" + mod.value).split(' '));
                if (action === 'add') {
                    if (appendIfNotExist(zone, arr, map)) {
                        changecount++;
                    }
                }
                if (action === 'del') {
                    if (deleteIfExist(zone, arr, map)) {
                        changecount++;
                    }
                }
            }
            if (changecount === 0) {
                return "Done unchanged";
            }
            file.soa.serial++;
            var result = generate(file);
            writeTo(tmpFile, result);
            await spawnSudoUtil('NAMED_SET', ["" + zone]);
            return `Done updating ${changecount} records\n${result}`;
        });
    }
}

export const namedExec = new NamedExecutor();