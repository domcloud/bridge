import express from 'express';
import { virtualminExec } from '../executor/virtualmin.js';
import { checkAuth, checkGet } from '../util.js';

export default function () {
    var router = express.Router();
    router.get('/create-link', checkAuth, checkGet(['user']), async function (req, res, next) {
        try {
            res.send((await virtualminExec.execFormatted('create-login-link', {
                user: req.query.user.toString(),
            })));
        } catch (error) {
            next(error);
        }
    });
    router.get('/list-domains', checkAuth, checkGet(['domain']), async function (req, res, next) {
        try {
            res.send(await virtualminExec.getDomainInfo(req.query.domain.toString().split(','), false));
        } catch (error) {
            next(error);
        }
    });
    router.get('/list-bandwidth', checkAuth, checkGet(['domain']), async function (req, res, next) {
        try {
            res.send(await virtualminExec.getBandwidthInfo(req.query.domain.toString().split(',')));
        } catch (error) {
            next(error);
        }
    });
    return router;
}