import express from 'express';
import {
    iptablesExec as executor
} from '../executor/iptables.js';
import {
    checkGet,
    checkPost
} from '../util.js';
import { virtualminExec } from '../executor/virtualmin.js';
import { logmanExec } from '../executor/logman.js';

export default function () {
    var router = express.Router();
    router.get('/get', checkGet(['user', 'type']), async function (req, res, next) {
        try {
            let type = req.query.type.toString()
            let user = req.query.user.toString()
            let n = parseInt((req.query.n  || 100).toString()) || 100;
            let output = await logmanExec.getLog(user, type, n);
            return res.json(output);
        } catch (err) {
            next(err);
        }
    });
    return router;
}