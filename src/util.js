import path from 'path';
import { spawn } from 'child_process';
import { lock } from 'proper-lockfile';
import fs from 'fs';
import binaries from './binaries/metadata.cjs';
const {
    javaVersionsList,
    javaVersionsMap,
    pythonVersionsList,
    pythonVersionsMap,
    rubyVersionsList
} = binaries;


let tokenSecret, allowIps, sudoutil, version, revision;
// https://packagist.org/php-statistics
let phpVersionsList = [];
/**
 * @type {Record<string, string>}
 */
let sslWildcardsMap = {};
export const initUtils = () => {
    tokenSecret = `Bearer ${process.env.SECRET}`;
    allowIps = process.env.ALLOW_IP ? process.env.ALLOW_IP.split(',').reduce((a, b) => {
        a[b] = true;
        return a;
    }, {}) : null
    sudoutil = path.join(process.cwd(), '/sudoutil.js');
    version = JSON.parse(cat('package.json')).version;
    const rev = cat('.git/HEAD').trim();
    revision = rev.indexOf(':') === -1 ? rev : cat('.git/' + rev.substring(5)).trim();
    revision = revision.substring(0, 7);
    sslWildcardsMap = (process.env.SSL_WILDCARDS || '').split(',').reduce((a, b) => {
        var splits = b.split(':');
        if (splits.length == 2) {
            a[splits[0].toLowerCase()] = splits[1];
        }
        return a;
    }, {});
    try {
        const phpPath = process.env.PHPFPM_REMILIST || '/etc/opt/remi/';
        const phpFiles = fs.readdirSync(phpPath, { withFileTypes: true });
        phpVersionsList = phpFiles
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name.replace(/php(\d)(\d+)/, '$1.$2'))
        phpVersionsList = sortSemver(phpVersionsList).reverse();
    } catch (error) {
        phpVersionsList = [];
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
        return expand(status);
    }
    switch (status) {
        case 'system':
            return expand(status);
        case 'lts':
        case 'security':
            var security = pythonVersionsList.find(x => {
                return !x.startsWith(stable.substring(0, stable.lastIndexOf('.')));
            });
            return expand(security || stable);
        case 'latest':
        case 'stable':
        default:
            return expand(stable);
    }
}

export const getRubyVersion = (/** @type {string} */ status) => {
    // get latest stable version
    var stable = rubyVersionsList[0];
    if (!status) {
        return stable;
    }
    if (/^ruby-/.test(status)) {
        status = status.substring(5);
    }
    if (/^\d+(\.\d+)?$/.test(status)) {
        var m = rubyVersionsList.find(x => {
            return x.startsWith(status);
        });
        if (m) {
            return m;
        }
    }
    if (/^\d+\.\d+\.\d+$/.test(status)) {
        return status;
    }
    switch (status) {
        case 'lts':
        case 'security':
            var security = rubyVersionsList.find(x => {
                return !x.startsWith(stable.substring(0, stable.lastIndexOf('.')));
            });
            return security || stable;
        case 'latest':
        case 'stable':
        default:
            return stable;
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
                return !x.startsWith(stable.substring(0, stable.lastIndexOf('.')));
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

export const checkAuth = function (
    /** @type {import('express').Request} */
    req,
    /** @type {import('express').Response} */
    res,
    /** @type {any} */
    next) {
    if (req.headers.authorization === tokenSecret) {
        if (!allowIps || allowIps[req.ip])
            return next();
    }
    if (process.env.NODE_ENV === 'development') {
        return next();
    }
    res.sendStatus(403);
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
 * @param {array} args
 */
export function checkGet(args) {
    return function (
        /** @type {import('express').Request} */
        req,
        /** @type {import('express').Response} */
        res,
        /** @type {any} */
        next) {
        for (const arg of args) {
            if (!req.query[arg]) {
                return res.status(400).send(arg + ' is required');
            }
        }
        next();
    }
}


/**
 * @param {array} args
 */
export function checkPost(args) {
    return function ( /** @type {import('express').Request} */
        req,
        /** @type {import('express').Response} */
        res,
        /** @type {any} */
        next) {
        if (!req.body) return res.status(400).send('missing post data');
        for (const arg of args) {
            if (!req.body[arg]) {
                return res.status(400).send(arg + ' is required');
            }
        }
        next();
    }
}

/**
 * 
 * @param {string} mode 
 * @param {string[]} args 
 * @returns  {Promise<{code: number | string, stdout: string, stderr: string}>}
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
                    code: typeof code === 'number' ? code : signal,
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
        let release;
        lock(realfile, {
            retries: 10,
            realpath: false,
        }).then((releaseCall) => {
            release = releaseCall;
            return callback();
        }).then(arg => {
            if (release) release();
            resolve(arg);
        }).catch(err => {
            if (release) release();
            reject(err);
        });
    });
}
// Returns whether an object has a given set of `key:value` pairs.
/**
 * @param {any} object
 * @param {Record<string, any>} attrs
 */
export function isMatch(object, attrs) {
    var _keys = Object.keys(attrs),
        length = _keys.length;
    if (object == null) return !length;
    var obj = Object(object);
    for (var i = 0; i < length; i++) {
        var key = _keys[i];
        if (attrs[key] !== obj[key] || !(key in obj)) return false;
    }
    return true;
}

export const deleteIfNotExist = ( /** @type {any[]} */ arr, /** @type {any} */ record) => {
    const idx = arr.findIndex((x) => isMatch(x, record));
    if (idx === -1) {
        return false;
    } else {
        arr.splice(idx, 1);
        return true;
    }
}
export const appendIfNotExist = ( /** @type {any[]} */ arr, /** @type {{}} */ record) => {
    const idx = arr.findIndex((x) => isMatch(x, record));
    if (idx === -1) {
        arr.push(record);
        return true;
    } else {
        return false;
    }
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
    var text2 = '';
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text.length > i + 1 ? text[i + 1] : '';
        const prev = 0 <= i - 1 ? text[i - 1] : '';
        if (char === '\r') {
            if (next === '\u001b') {
                i++;
                // ANSI navigation controls
                while (text.substr(i, 1) === '\u001b' && /\[[ABCDK]/.test(text.substr(i + 1, 2))) {
                    i += 3;
                }
            } else if (next === '\n') {
                text2 += '\n';
                i++;
            } else if (next === prev) {
                i++;
            } else {
                // clear last line
                text2 = text2.substr(0, text2.lastIndexOf('\n') + 1);
            }
        } else {
            text2 += char;
        }
    }
    text = text2;
    text = text.replace(/\x1b\[A.+?\x1b\[Ke/g, '\n');
    text = text.replace(/^\$> (.+)/gm, '\u001b[37m$$> $1\u001b[0m');
    text = text.replace(/^(Exit status: .+)/gim, "\u001b[36m$1\u001b[0m");
    return text;
}

export const getDbName = function ( /** @type {string} */ user, /** @type {string} */ db = 'db') {
    return (`${user.replace(/-/g, '_')}_${db}`).replace(/[^a-zA-Z0-9_]/g, '');
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

// https://stackoverflow.com/a/40201629/3908409
/**
 * @param {string[]} arr
 */
export function sortSemver(arr) {
    return arr.map(a => a.replace(/\d+/g, n => +n + 100000 + '')).sort()
        .map(a => a.replace(/\d+/g, n => +n - 100000 + ''));
}

/**
 * @param {fs.PathOrFileDescriptor} path
 * @returns {string}
 */
export function cat(path) {
    return fs.readFileSync(path, {
        encoding: 'utf-8'
    });
}


/**
 * @param {fs.PathOrFileDescriptor} path
 * @param {string | NodeJS.ArrayBufferView} content
 */
export function writeTo(path, content) {
    fs.writeFileSync(path, content, {
        encoding: 'utf-8'
    });
}

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
