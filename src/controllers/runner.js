import {
    checkAuth,
    checkGet,
} from '../util.js';
import express from 'express';
import runConfig from '../executor/runner.js';
import got from 'got';
export default function () {
    var router = express.Router();
    router.post('/', checkAuth, checkGet(['domain']), async function (req, res, next) {
        try {
            /** @type {import('stream').Duplex} */
            let emitter = null;
            let callback = req.header('x-callback');
            await runConfig(req.body || {}, req.query.domain + "", (s) => {
                if (callback && !emitter) {
                    emitter = got.stream.post(callback);
                    res.json('OK');
                }
                (emitter || res).write(s);
            }, false);
            (emitter || res).end();
        } catch (error) {
            if (!res.writableEnded) {
                res.write(error.message);
                res.write(error.stack);
                res.end();
            }
        }
    });
    return router;
}