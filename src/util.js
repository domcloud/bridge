import path from 'path';
import {
    spawn
} from 'child_process';
import {
    lock,
    unlock,
    check
} from 'proper-lockfile';
import _ from 'underscore';


let tokenSecret, allowIps, sudoutil, metadata;
import fs from 'fs';
export const initUtils = () => {
    tokenSecret = `Bearer ${process.env.SECRET}`;
    allowIps = process.env.ALLOW_IP ? process.env.ALLOW_IP.split(',').reduce((a, b) => {
        a[b] = true;
        return a;
    }, {}) : null
    sudoutil = path.join(process.cwd(), '/sudoutil.js');
    metadata = JSON.parse(fs.readFileSync(path.join(process.cwd(), '/package.json')).toString('utf-8'));
}

export const getVersion = () => {
    return metadata.version;
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

export const checkTheLock = function (/** @type {string} */ file)  {
    const realfile = path.join(process.cwd(), '.tmp', file + '.lock');
    return check(realfile, {
        realpath: false,
    })
}

export const executeLock = function (
    /** @type {string} */
    file,
    /** @type {(err?: Error) => Promise<any>} */
    callback) {
    const realfile = path.join(process.cwd(), '.tmp', file + '.lock');
    return new Promise((resolve, reject) => {
        lock(realfile, {
            retries: 10,
            realpath: false,
        }).then((release) => {
            callback()
            .then(resolve)
            .catch(reject)
            .finally(x => {
                return release();
            })
        }).catch(err => {
            reject(err);
        });
    });
}
export const deleteIfNotExist = ( /** @type {any[]} */ arr, /** @type {any} */ record) => {
    const idx = arr.findIndex((x) => _.isMatch(x, record));
    if (idx === -1) {
        return false;
    } else {
        arr.splice(idx, 1);
        return true;
    }
}
export const appendIfNotExist = ( /** @type {any[]} */ arr, /** @type {{}} */ record) => {
    const idx = arr.findIndex((x) => _.isMatch(x, record));
    if (idx === -1) {
        arr.push(record);
        return true;
    } else {
        return false;
    }
}

// https://github.com/xxorax/node-shell-escape/blob/master/shell-escape.js
export const escapeShell = function (/** @type {string[]} */ ...a) {
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