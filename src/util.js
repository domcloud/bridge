import path, { dirname } from 'path';
import { spawn } from 'child_process';
import lock from './helpers/lockfile.js';
import { existsSync, readdirSync, readFileSync } from 'fs';
import fs from 'fs/promises';
import { constants } from 'os';
import binaries from './binaries/metadata.cjs';
import { virtualminExec } from './executor/virtualmin.js';
const {
    javaVersionsList,
    javaVersionsMap,
    pythonVersionsList,
    pythonVersionsMap,
    rubyVersionsList,
    rubyVersionsMap,
} = binaries;


let tokenSecret, allowIps, sudoutil, version, revision;
// https://packagist.org/php-statistics
let phpVersionsList = [];
/**
 * @type {Record<string, {domain: string, id: string, path: string}>}
 */
let sslWildcardsMap = {};

let isThisDebian = false;

export const isDebian = () => isThisDebian

export const initUtils = () => {
    isThisDebian = existsSync('/etc/lsb-release');
    tokenSecret = `Bearer ${process.env.SECRET}`;
    allowIps = process.env.ALLOW_IP?.split(',').reduce((a, b) => {
        a[b] = true;
        return a;
    }, {}) || null
    sudoutil = path.join(process.cwd(), '/sudoutil.js');
    version = JSON.parse(readFileSync('package.json', { encoding: 'utf-8' })).version;
    const rev = readFileSync('.git/HEAD', { encoding: 'utf-8' }).trim();
    revision = rev.indexOf(':') === -1 ? rev : readFileSync('.git/' + rev.substring(5), { encoding: 'utf-8' }).trim();
    revision = revision.substring(0, 7);
    try {
        const phpPath = process.env.PHPFPM_REMILIST || (isThisDebian ? '/etc/php/' : '/etc/opt/remi/');
        const phpFiles = readdirSync(phpPath, { withFileTypes: true });
        phpVersionsList = phpFiles
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name.replace(/php(\d)(\d+)/, '$1.$2'))
        phpVersionsList = sortSemver(phpVersionsList).reverse();
    } catch (error) {
        phpVersionsList = [];
    }
    updateWildcardData();
}

export const initDeployd = function () {
    if (existsSync("./deployd/deployd")) {
        executeLock('deployd', () => {
            console.log("running deployd")
            const x = spawn("./deployd/deployd", [], {
                env: {
                    SECRET: process.env.SECRET,
                    SOCKET_PATH: process.env.SOCKET_PATH || '',
                },
                cwd: process.cwd(),
                stdio: 'pipe',
            })
            return new Promise((resolve, reject) => {
                x.on('close', resolve)
                x.on('error', reject)
            })
        })
    }
}

async function updateWildcardData() {
    sslWildcardsMap = {};
    var cachepath = path.join(process.cwd(), '/.tmp/wildcardssl.json');
    var sslWildcardStr = process.env.SSL_WILDCARDS || '';
    if (!sslWildcardStr) {
        return;
    }
    try {
        sslWildcardsMap = JSON.parse(await cat(cachepath));
        for (const domain of sslWildcardStr.split(',').map(x => x.split(':')[0])) {
            if (!(domain in sslWildcardsMap) || ['id', 'domain', 'path'].every(k => !(k in sslWildcardsMap[domain]))) {
                throw new Error();
            }
        }
        return
    } catch (error) {
        // can't parse is OK
    }
    try {
        const domains = sslWildcardStr.split(',').map(x => x.split(':')[0]);
        for (const [domain, d] of Object.entries(await virtualminExec.getDomainInfo(domains, true))) {
            sslWildcardsMap[domain] = {
                id: d['ID'] + '',
                path: dirname(d['SSL key file'] + ''),
                domain,
            }
        }
        await writeTo(cachepath, JSON.stringify(sslWildcardsMap))
    } catch (error) {
        console.error("Can't get valid ssl domain", error)
    }
}

export const getLtsPhp = (/** @type {string} */ major) => {
    if (!major) {
        return phpVersionsList[0];
    }
    for (let i = 0; i < phpVersionsList.length; i++) {
        const element = phpVersionsList[i];
        if (element.startsWith(major + '.')) {
            return element;
        }
    }
}

export const getPythonVersion = (/** @type {string} */ status) => {
    const expand = (/** @type {string} */ version) => ({
        version,
        binary: pythonVersionsMap[version] || null,
    })
    // get latest stable version
    var stable = pythonVersionsList[0];
    if (!status) {
        return expand(stable);
    }
    if (/^\d+(\.\d+)?$/.test(status)) {
        var m = pythonVersionsList.find(x => {
            return x.startsWith(status);
        });
        if (m) {
            return expand(m);
        } else {
            return expand(status + ":latest");
        }
    }
    if (/^\d+\.\d+\.\d+$/.test(status)) {
        // no binaries
        return { version: status, binary: null };
    }
    switch (status) {
        case 'lts':
        case 'security':
            var security = pythonVersionsList[2];
            return expand(security || stable);
        case 'latest':
        case 'stable':
            return expand(stable);
        case 'system':
        default:
            return expand(status);
    }
}

export const getRubyVersion = (/** @type {string} */ status) => {
    const expand = (/** @type {string} */ version) => {
        let binary = rubyVersionsMap[version] || null;
        if (binary && isDebian()) {
            binary = binary.replace(/rocky/g, 'ubuntu');
        }
        return {
            version,
            binary,
        };
    }
    var stable = rubyVersionsList.filter(x => x.startsWith('ruby-'))[0];
    if (!status) {
        return expand(stable);
    }
    if (/^\d+(\.\d+)?$/.test(status)) {
        var m = rubyVersionsList.find(x => {
            return x.startsWith('ruby-' + status);
        });
        if (m) {
            return expand(m);
        }
    }
    if (/^\d+\.\d+\.\d+$/.test(status)) {
        return expand('ruby-' + status);
    }
    switch (status) {
        case 'lts':
        case 'security':
            var security = rubyVersionsList.filter(x => x.startsWith('ruby-')).find(x => {
                return !x.startsWith(stable.substring(0, stable.lastIndexOf('.')));
            });
            return expand(security || stable);
        case 'latest':
        case 'stable':
        default:
            var m = rubyVersionsList.find(x => {
                return x.startsWith(status);
            });
            if (m) {
                return expand(m);
            }
            return expand(stable);
    }
}

export const getJavaVersion = (/** @type {string} */ status) => {
    const expand = (/** @type {string} */ version) => ({
        version,
        binary: javaVersionsMap[version] || null,
    })
    // get latest stable version
    var stable = javaVersionsList[0];
    if (!status) {
        return expand(stable);
    }
    if (/^\d+(\.\d+){0,2}$/.test(status)) {
        var m = javaVersionsList.find(x => {
            return x.startsWith(status);
        });
        if (m) {
            return expand(m);
        }
    }
    switch (status) {
        case 'lts':
        case 'security':
            var security = javaVersionsList.find(x => {
                return x !== stable && parseInt(x.split('.')[0]) % 3 === 0
            });
            return expand(security || stable);
        case 'latest':
        case 'stable':
        default:
            return expand(stable);
    }
}

export const getVersion = () => {
    return version;
}

export const getRevision = () => {
    return revision;
}

export const getAuth = (/** @type {import('express').Request} */ req) => {
    return req.headers.authorization === tokenSecret && (!allowIps || allowIps[req.ip])
}

export const checkAuth = function (
    /** @type {import('express').Request} */
    req,
    /** @type {import('express').Response} */
    res,
    /** @type {any} */
    next) {
    if (getAuth(req)) {
        return next();
    }
    if (process.env.NODE_ENV === 'development') {
        return next();
    }
    res.status(403).contentType('application/json').send('"Forbidden"');
}

export const getSupportVersions = () => {
    return {
        php: phpVersionsList,
        python: pythonVersionsList,
        ruby: rubyVersionsList,
        java: javaVersionsList,
    }
}


/**
 * @param {string[]} args
 * @return {import('express').RequestHandler}
 */
export function checkGet(args) {
    return function (
        /** @type {import('express').Request} */
        req,
        /** @type {import('express').Response} */
        res,
        /** @type {import('express').NextFunction} */
        next) {
        for (const arg of args) {
            if (!req.query[arg]) {
                res.status(400).send(arg + ' is required');
                return;
            }
        }
        next();
    }
}


/**
 * @param {string[]} args
 * @return {import('express').RequestHandler}
 */
export function checkPost(args) {
    return function ( /** @type {import('express').Request} */
        req,
        /** @type {import('express').Response} */
        res,
        /** @type {any} */
        next) {
        if (!req.body) {
            res.status(400).send('missing post data');
            return;
        }
        for (const arg of args) {
            if (!req.body[arg]) {
                res.status(400).send(arg + ' is required');
                return;
            }
        }
        next();
    }
}

/**
 * 
 * @param {string} mode 
 * @param {string[]} args 
 * @returns  {Promise<{code: number, stdout: string, stderr: string}>}
 */
export const spawnSudoUtil = function (
    mode,
    args = []) {
    // must by bypassable using visudo
    return new Promise((resolve, reject) => {
        try {
            var child = process.env.NODE_ENV === 'development' ?
                spawn("node", [sudoutil, mode, ...args], {}) :
                spawn("sudo", [sudoutil, mode, ...args], {});
            let stdout = '',
                stderr = ''; {
                child.stdout.on('data', data => {
                    stdout += data
                });
                child.stderr.on('data', data => {
                    stderr += data
                });
            }
            child.on('error', function (err) {
                stderr += err.message + "\n";
            });
            child.on('close', (code, signal) => {
                (code === 0 || code === null ? resolve : reject)({
                    code: typeof code === 'number' ? code : constants.signals[signal],
                    stdout,
                    stderr
                });
            });
        } catch (e) {
            reject({
                code: -1,
                stdout: '',
                stderr: e.message,
            });
        }
    });
}

export const spawnSudoUtilAsync = function ( /** @type {string} */
    mode,
    /** @type {string[]} */
    args = []) {
    // must by bypassable using visudo
    return process.env.NODE_ENV === 'development' ?
        spawn("node", [sudoutil, mode, ...args], {}) :
        spawn("sudo", [sudoutil, mode, ...args], {});
}

export const executeLock = function (
    /** @type {string} */
    file,
    /** @type {() => Promise<any>} */
    callback) {
    const realfile = path.join(process.cwd(), '.tmp', file + '.lock');
    return new Promise((resolve, reject) => {
        /**
         * @type {() => Promise<void>}}
         */
        let release;
        lock(realfile, {
            retries: 10,
            realpath: false,
        }).then((releaseCall) => {
            release = releaseCall;
            return callback();
        }).then(arg => {
            if (release) release().finally(() => resolve(arg));
            else resolve(arg);
        }).catch(err => {
            if (release) release().finally(() => reject(err));
            else reject(err);
        });
    });
}

// https://github.com/xxorax/node-shell-escape/blob/master/shell-escape.js
export const escapeShell = function ( /** @type {string[]} */ ...a) {
    var ret = [];

    a.forEach(function (s) {
        if (/[^A-Za-z0-9_\/:=-]/.test(s)) {
            s = "'" + s.replace(/'/g, "'\\''") + "'";
            s = s.replace(/^(?:'')+/g, '') // unduplicate single-quote at the beginning
                .replace(/\\'''/g, "\\'"); // remove non-escaped single-quote if there are enclosed between 2 escaped
        }
        ret.push(s);
    });

    return ret.join(' ');
};

export const normalizeShellOutput = function ( /** @type {string[]} */ output) {
    var text = output.join('');
    text = text.replace(/\x1b\[A.+?\x1b\[Ke/g, '\n');
    text = text.replace(/^\$> (.+)/gm, '\u001b[37m$$> $1\u001b[0m');
    text = text.replace(/^\$< "(.+)"( \+)?/gm, '\u001b[37m$$< "\u001b[36m$1\u001b[37m"$2\u001b[0m');
    text = text.replace(/^(Exit status: .+)/gm, "\u001b[36m$1\u001b[0m");
    text = text.replace(/^(\$> Error occured.*)/gm, "\u001b[91m$1\u001b[0m");
    text.endsWith('\r') && (text += "\n");
    return text;
}

export const getDbName = function ( /** @type {string} */ user, /** @type {string} */ db = 'db') {
    return (`${user.replace(/-/g, '_')}_${db.replace(/[-.]/g, '_')}`).replace(/[^a-zA-Z0-9_]/g, '');
}

export const escapeNginx = function ( /** @type {string} */ str) {
    if (/[^A-Za-z0-9_\/:=-]/.test(str)) {
        return JSON.stringify(str);
    } else {
        return str;
    }
}

export const unescapeNginx = function ( /** @type {string} */ str) {
    try {
        if (/^".*"$/.test(str)) {
            return JSON.parse(str);
        } else if (/'.*'/.test(str)) {
            return str.substring(1, str.length - 1);
        } else {
            return str;
        }
    } catch (error) {
        return "";
    }
}

// https://stackoverflow.com/a/64296576
export function splitLimit(/** @type {string} */ input,/** @type {string|RegExp} */  separator, /** @type {Number} */  limit) {
    // Ensure the separator is global
    if (!(separator instanceof RegExp) || !separator.global) {
        separator = new RegExp(separator, 'g');
    }
    // Allow the limit argument to be excluded
    limit = limit ?? -1;

    const output = [];
    let finalIndex = 0;

    while (--limit) {
        const lastIndex = separator.lastIndex;
        const search = separator.exec(input);
        if (search === null) {
            break;
        }
        finalIndex = separator.lastIndex;
        output.push(input.slice(lastIndex, search.index));
    }

    output.push(input.slice(finalIndex));

    return output;
}

/**
 * @param {string} str - The string to search in
 * @param {string} pat - The pattern to search for
 * @param {number} nth - The occurrence number (starting from 1)
 * @returns {number} - The index of the nth occurrence, or -1 if not found
 */
export function nthIndexOf(str, pat, nth) {
    if (nth < 1) return -1; // nth occurrence must start from 1
    let i = -1;

    while (nth-- > 0) {
        i = str.indexOf(pat, i + 1); // Move to the next occurrence
        if (i === -1) return -1; // Stop if not found
    }

    return i;
}

/**
 * @param {string} str
 * @param {string} pat
 */
export function countOf(str, pat) {
    if (!pat) return 0; // Avoid infinite loops on empty pattern
    let count = 0;
    let pos = 0;

    while ((pos = str.indexOf(pat, pos)) !== -1) {
        count++;
        pos += pat.length; // Move past the found occurrence
    }

    return count;
}
// https://stackoverflow.com/a/40201629/3908409
/**
 * @param {string[]} arr
 */
export function sortSemver(arr) {
    return arr.map(a => a.replace(/\d+/g, n => +n + 100000 + '')).sort()
        .map(a => a.replace(/\d+/g, n => +n - 100000 + ''));
}

/**
 * spawnSync but not blocking thread
 * @param {'id'|'ss'} prog
 * @param {string[]} arg
 */
async function spawnSync(prog, arg) {
    return new Promise((resolve, reject) => {
        const child = spawn(prog, arg);

        let stdoutData = '', stderrData = '';

        child.stdout.on('data', (data) => {
            stdoutData += data.toString();
        });
        child.stderr.on('data', (data) => {
            stderrData += data.toString();
        });
        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(stderrData.trim()));
                return;
            }
            resolve(stdoutData.trim());
        });
    });
}

export async function getListeningPorts() {
    const output = await spawnSync('ss', ['-ltn4']);
    /**
     * @type {Set<number>}
     */
    const ports = new Set();

    output.split('\n').slice(1).forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4) {
            const localAddr = parts[3];
            const [ip, portStr] = localAddr.split(':');
            const port = parseInt(portStr, 10);

            if (!isNaN(port) && (ip === '0.0.0.0' || ip === '127.0.0.1')) {
                ports.add(port);
            }
        }
    });

    return ports;
}

export async function getUnameMap() {
    const passwdContent = await cat('/etc/passwd');
    const uidToUser = new Map();

    passwdContent.split('\n').forEach(line => {
        if (!line || line.startsWith('#')) return;
        const fields = line.split(':');
        const uname = fields[0];
        const uid = parseInt(fields[2], 10);
        if (!isNaN(uid)) {
            uidToUser.set(uid, uname);
        }
    });

    return uidToUser;
}

/**
 * @param {string} user
 * @returns {Promise<string>}
 */
export async function getUid(user) {
    return spawnSync('id', ['-u', user])
}

/**
 * @param {string} user
 * @returns {Promise<string>}
 */
export async function getUname(user) {
    return spawnSync('id', ['-nu', user])
}

/**
 * @param {import('fs').PathLike} path
 * @returns {Promise<string>}
 */
export function cat(path) {
    return fs.readFile(path, {
        encoding: 'utf-8'
    });
}


/**
 * @param {import('fs').PathLike} path
 * @param {string | NodeJS.ArrayBufferView} content
 * @returns {Promise}
 */
export function writeTo(path, content) {
    return fs.writeFile(path, content, {
        encoding: 'utf-8'
    });
}

/**
 * 
 * @param {string} subdomain 
 */
export function detectCanShareSSL(subdomain) {
    const subdomainParts = subdomain.split('.');
    for (const domain of Object.keys(sslWildcardsMap)) {

        // Split the domain strings into arrays of subdomains
        const domainParts = domain.split('.');

        // Check if the subdomain has exactly one more part than the domain
        if (subdomainParts.length === domainParts.length + 1 &&
            subdomain.endsWith(`.${domain}`)) {
            return sslWildcardsMap[domain]
        }
    }
    return null;
}
