import {
    checkAuth,
    checkGet,
} from '../util.js';
import express from 'express';
import runConfig from '../executor/runner.js';
import got from 'got';

/**
 * @param {import('stream').Writable} stream
 * @param {string} content
 */
function writeAsync(stream, content) {
    return new Promise((resolve, reject) => {
        stream.write('' + content, 'utf-8', (err) => {
            if (err)
                reject(err)
            else
                resolve();
        })
    });
}
export default function () {
    var router = express.Router();
    router.post('/', checkAuth, checkGet(['domain']), async function (req, res, next) {
        /** @type {import('stream').Duplex} */
        let emitter = null;
        try {
            let callback = req.header('x-callback');
            await runConfig(req.body || {}, req.query.domain + "", async (s) => {
                if (callback && !emitter) {
                    emitter = got.stream.post(callback);
                    res.json('OK');
                }
                await writeAsync(emitter || res, s);
            }, false);
        } catch (error) {
            var r = emitter || res;
            await writeAsync(r, error.message);
            await writeAsync(r, error.stack);
        } finally {
            (emitter || res).end();
            if (!res.writableEnded) {
                res.end();
            }
        }
    });
    return router;
}