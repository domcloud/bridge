import {
    checkGet,
    checkPost,
} from '../util.js';
import express from 'express';
import {
    nginxExec as executor
} from '../executor/nginx.js';
export default function () {
    var router = express.Router();
    router.get('/', checkGet(['domain']), async function (req, res, next) {
        try {
            const node = await executor.get(req.query.domain + "");
            const raw = node.toString();
            res.json({
                ...executor.extractInfo(node, req.query.domain),
                raw,
            });
        } catch (error) {
            next(error);
        }
    });
    router.post('/', checkGet(['domain']), async function (req, res, next) {
        try {
            res.contentType('text/plain');
            return res.send(await executor.set("" + req.query.domain, req.body || {}));
        } catch (error) {
            next(error);
        }
    });
    router.post('/ssl', checkGet(['domain']), checkPost(['ssl']), async function (req, res, next) {
        try {
            res.contentType('text/plain');
            return res.send(await executor.setSsl("" + req.query.domain, req.body.ssl, req.body.http + ""));
        } catch (error) {
            next(error);
        }
    });
    return router;
}