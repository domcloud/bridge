import express from 'express';
import { virtualminExec } from '../executor/virtualmin.js';
import { checkAuth, checkGet } from '../util.js';

export default function () {
    var router = express.Router();
    router.get('/create-link', checkAuth, checkGet(['user']), async function (req, res, next) {
        res.send((await virtualminExec.execFormatted('create-login-link', {
            user: req.query.user.toString(),
        })));
    });
    router.get('/list-domains', checkAuth, checkGet(['domain']), async function (req, res, next) {
        res.send(await virtualminExec.getDomainInfo(req.query.domain.toString().split(','), false));
    });
    router.get('/list-bandwidth', checkAuth, checkGet(['domain']), async function (req, res, next) {
        res.send(await virtualminExec.getBandwidthInfo(req.query.domain.toString().split(',')));
    });
    return router;
}