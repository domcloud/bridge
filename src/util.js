import path from 'path';
import {
    spawn
} from 'child_process';
import {
    lock,
    unlock
} from 'lockfile';

const tokenSecret = `Bearer ${process.env.SECRET}`;
const allowIps = process.env.ALLOW_IP && process.env.ALLOW_IP.split(',').reduce((a, b) => {
    a[b] = true;
    return a;
}, {})

const sudoutil = path.join(process.cwd(), '/sudoutil.js');


export const checkAuth = function (
    /** @type {import('express').Request} */
    req,
    /** @type {import('express').Response} */
    res,
    /** @type {any} */
    next) {
    if (req.headers.authorization === tokenSecret) {
        if (!allowIps || allowIps[req.ip])
            next();
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
    args,
    /** @type {(stdout: any, stderr: any, code: number) => void} */
    callback) {
    // must by bypassable using visudo
    return new Promise((resolve, reject) => {
        var child = spawn("sudo", ["node", sudoutil, mode, ...args], {});
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
    const realfile = path.join(process.cwd(), 'tmp', file + '.lock');
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