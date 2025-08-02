import express from 'express';
import {
    checkGet,
} from '../util.js';
import { logmanExec } from '../executor/logman.js';

export default function () {
    var router = express.Router();
    router.get('/get', checkGet(['user', 'dom', 'type']), async function (req, res, next) {
        try {
            let type = req.query.type.toString()
            let user = req.query.user.toString()
            let dom = req.query.dom.toString()
            let sub = req.query.sub?.toString() || '';
            let n = parseInt((req.query.n || 100).toString()) || 100;
            let output = await logmanExec.getLog(user, dom, type, sub, n);
            res.json(output);
        } catch (err) {
            next(err);
        }
    });
    return router;
}