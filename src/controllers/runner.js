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
        /** @type {import('stream').Duplex} */
        let emitter = null;
        try {
            let callback = req.header('x-callback');
            await runConfig(req.body || {}, req.query.domain + "", (s) => {
                if (callback && !emitter) {
                    emitter = got.stream.post(callback);
                    res.json('OK');
                }
                (emitter || res).write(s);
            }, false);
        } catch (error) {
            var r = emitter || res;
            r.write(error.message);
            r.write(error.stack);
        } finally {
            (emitter || res).end();
            if (!res.writableEnded) {
                res.end();
            }
        }
    });
    return router;
}