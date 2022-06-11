import {
    checkAuth,
    checkGet,
    checkPost,
} from '../util.js';
import express from 'express';
import {
    namedExec as executor
} from '../executor/named.js';
export default function () {
    var router = express.Router();
    router.post('/resync', checkAuth, checkGet(['zone']), async function (req, res, next) {
        try {
            await executor.resync(req.query.zone + '');
            res.json("OK");
        } catch (error) {
            next(error);
        }
    });
    router.get('/show', checkAuth, checkGet(['zone']), async function (req, res, next) {
        try {
            res.json(await executor.show(req.query.zone + ''));
        } catch (error) {
            next(error);
        }
    });
    router.post('/modify', checkAuth, checkGet(['zone']), async function (req, res, next) {
        try {
            res.json(await executor.set(req.query.zone + '', req.body));
        } catch (error) {
            next(error);
        }
    });
    return router;
}