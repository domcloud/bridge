import {
    checkGet,
    checkPost,
} from '../util.js';
import express from 'express';
import {
    redisExec as executor
} from '../executor/redis.js';
export default function () {
    var router = express.Router();
    router.get('/list', checkGet(['user']), async function (req, res, next) {
        try {
            const node = await executor.show(req.query.user + "");
            res.json(node);
        } catch (error) {
            next(error);
        }
    });
    router.post('/add', checkGet(['user', 'name']), async function (req, res, next) {
        try {
            const node = await executor.add(req.query.user + "", req.query.name + "");
            res.json(node);
        } catch (error) {
            next(error);
        }
    });
    router.post('/del', checkGet(['user', 'name']), async function (req, res, next) {
        try {
            const node = await executor.del(req.query.user + "", req.query.name + "");
            res.json(node);
        } catch (error) {
            next(error);
        }
    });
    return router;
}