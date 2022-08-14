import path from 'path';
import {
    spawn,
    exec
} from 'child_process';
import {
    lock,
    unlock,
    check
} from 'proper-lockfile';
import axios from 'axios';


let tokenSecret, allowIps, sudoutil, version, revision;
let phpReleaseData = ['5.6', '7.4'];
import fs from 'fs';
export const initUtils = () => {
    tokenSecret = `Bearer ${process.env.SECRET}`;
    allowIps = process.env.ALLOW_IP ? process.env.ALLOW_IP.split(',').reduce((a, b) => {
        a[b] = true;
        return a;
    }, {}) : null
    sudoutil = path.join(process.cwd(), '/sudoutil.js');
    version = JSON.parse(fs.readFileSync(path.join(process.cwd(), '/package.json')).toString('utf-8')).version;
    const rev = fs.readFileSync('.git/HEAD').toString().trim();
    revision = rev.indexOf(':') === -1 ? rev : fs.readFileSync('.git/' + rev.substring(5)).toString().trim();
    revision = revision.substring(0, 7);
    axios.get('https://www.php.net/releases/?json').then(res => {
        Object.values(res.data).forEach(v => {
            v.supported_versions.forEach(ver => {
                if (!phpReleaseData.includes(ver)) {
                    phpReleaseData.push(ver);
                }
            });
        });
    }).catch(err => {
        console.log('error fetching PHP release', err);
    });
}

export const getLtsPhp = (major) => {
    if (!major) {
        return phpReleaseData[phpReleaseData.length - 1];
    }
    for (let i = phpReleaseData.length; i-- > 0;) {
        const element = phpReleaseData[i];
        if (element.startsWith(major + '.')) {
            return element;
        }
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

export const spawnSudoUtil = function (
    /** @type {string} */
    mode,
    /** @type {string[]} */
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