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
    router.get('/get', checkGet(['domain', 'type']), async function (req, res, next) {
        try {
            let domain = await virtualminExec.getDomainInfo(req.query.domain.toString());
            let type = req.query.type.toString()
            let n = parseInt((req.query.n  || 100).toString()) || 100;
            let output = await logmanExec.getLog(domain, type, n);
            return res.json(output);
        } catch (err) {
            next(JSON.stringify(err, Object.getOwnPropertyNames(err)));
        }
    });
    return router;
}