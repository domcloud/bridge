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
        /** @type {import('stream').Writable} */
        let write = res;
        try {
            let callback = req.header('x-callback');
            await runConfig(req.body || {}, req.query.domain + "", async (s) => {
                if (callback && !emitter) {
                    emitter = got.stream.post(callback);
                    res.json('OK');
                    write = emitter;
                }
                await writeAsync(write, s);
            }, false);
        } catch (error) {
            await writeAsync(write, '$> Error occured\n');
            await writeAsync(write, JSON.stringify(error));
        } finally {
            await writeAsync(write, '$> Execution Finished\n');
            if (emitter && !emitter.writableEnded) {
                emitter.end();
            }
            if (!res.writableEnded) {
                res.end();
            }
        }
    });
    return router;
}