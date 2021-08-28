import {
    checkAuth,
    checkGet,
} from '../util.js';
import express from 'express';
import runConfig from '../executor/runner.js';
export default function () {
    var router = express.Router();
    router.post('/', checkAuth, checkGet(['domain']), async function (req, res, next) {
        try {
            await runConfig(req.body || {}, req.query.domain + "", (s) => res.write(s), false);
            res.end();
        } catch (error) {
            res.write(error.message);
            res.write(error.stack);
            res.end();
        }
    });
    return router;
}