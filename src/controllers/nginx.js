import {
    checkAuth,
    checkGet,
    checkPost,
} from '../util.js';
import express from 'express';
import {
    nginxExec as executor
} from '../executor/nginx.js';
export default function () {
    var router = express.Router();
    router.get('/', checkAuth, checkGet(['domain']), async function (req, res, next) {
        try {
            const node = await executor.get(req.query.domain);
            if (req.query.view === 'raw') {
                res.contentType('text/plain');
                res.send(node.toString());
            } else {
                res.json(executor.extractInfo(node, req.query.domain));
            }
        } catch (error) {
            next(error);
        }
    });
    router.post('/', checkAuth, checkGet(['domain']), async function (req, res, next) {
        try {
            return res.json(await executor.set(req.query.domain, req.body || {}));
        } catch (error) {
            next(error);
        }
    });
    return router;
}