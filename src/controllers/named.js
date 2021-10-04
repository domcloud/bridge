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
    router.post('/add', checkAuth, checkPost(['zone', 'domain', 'type', 'value']), async function (req, res, next) {
        try {
            const r = await executor.add(req.body.zone, req.body.domain, req.body.type, req.body.value);
            res.json(r);
        } catch (error) {
            next(error);
        }
    });
    router.post('/del', checkAuth, checkPost(['zone', 'domain', 'type', 'value']), async function (req, res, next) {
        try {
            const r = await executor.del(req.body.zone, req.body.domain, req.body.type, req.body.value);
            res.json(r);
        } catch (error) {
            next(error);
        }
    });
    return router;
}