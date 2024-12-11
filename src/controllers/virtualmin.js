import express from 'express';
import { virtualminExec } from '../executor/virtualmin.js';
import { checkGet } from '../util.js';

export default function () {
    var router = express.Router();
    router.get('/create-link', checkGet(['user']), async function (req, res, next) {
        try {
            res.send((await virtualminExec.execFormatted('create-login-link', {
                user: req.query.user.toString(),
            })));
        } catch (error) {
            next(error);
        }
    });
    router.get('/list-domains', checkGet(['domain']), async function (req, res, next) {
        try {
            res.send(await virtualminExec.getDomainInfo(req.query.domain.toString().split(','), false));
        } catch (error) {
            next(error);
        }
    });
    router.get('/list-all-domains', async function (req, res, next) {
        try {
            let proc = await virtualminExec.execFormatted('list-domains', { 'name-only': true, 'toplevel': true });
            res.send(proc.stdout.trim().split('\n'));
        } catch (error) {
            next(error);
        }
    });
    router.get('/list-bandwidth', checkGet(['domain']), async function (req, res, next) {
        try {
            res.send(await virtualminExec.getBandwidthInfo(req.query.domain.toString().split(',')));
        } catch (error) {
            next(error);
        }
    });
    router.get('/list-databases', checkGet(['domain']), async function (req, res, next) {
        try {
            res.send(await virtualminExec.getDatabaseInfo(req.query.domain.toString()));
        } catch (error) {
            next(error);
        }
    });
    router.get('/list-users', checkGet(['domain']), async function (req, res, next) {
        try {
            res.send(await virtualminExec.getUserInfo(req.query.domain.toString()));
        } catch (error) {
            next(error);
        }
    });
    return router;
}