import path from 'path';
import {
    spawn
} from 'child_process';
import {
    lock,
    unlock
} from 'lockfile';
import _ from 'underscore';


let tokenSecret, allowIps, sudoutil;

export const initUtils = () => {
    tokenSecret = `Bearer ${process.env.SECRET}`;
    allowIps = process.env.ALLOW_IP ? process.env.ALLOW_IP.split(',').reduce((a, b) => {
        a[b] = true;
        return a;
    }, {}) : null
    sudoutil = path.join(process.cwd(), '/sudoutil.js');
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
    args = [],
    /** @type {(stdout: any, stderr: any, code: number) => void} */
    callback = null) {
    // must by bypassable using visudo
    return new Promise((resolve, reject) => {
        var child = process.env.NODE_ENV === 'development' ?
            spawn("node", [sudoutil, mode, ...args], {}) :
            spawn("sudo", ["node", sudoutil, mode, ...args], {});
        let stdout = '',
            stderr = '';
        if (callback) {
            child.stdout.on('data', data => callback(data, null, null));
            child.stderr.on('data', data => callback(null, data, null));
        } else {
            child.stdout.on('data', data => {
                stdout += data
            });
            child.stderr.on('data', data => {
                stderr += data
            });
        }
        child.on('close', code => {
            if (callback)
                callback(null, null, code);
            (code === 0 ? resolve : reject)({
                code,
                stdout,
                stderr
            });
        });
    });
}

export const executeLock = function (
    /** @type {string} */
    file,
    /** @type {(err?: Error) => Promise<any>} */
    callback) {
    const realfile = path.join(process.cwd(), '.tmp', file + '.lock');
    return new Promise((resolve, reject) => {
        lock(realfile, (err) => {
            resolve(callback(err)
                .finally(x => {
                    unlock(realfile, () => {});
                    return x;
                }));
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