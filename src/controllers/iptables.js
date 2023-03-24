import express from 'express';
import {
    iptablesExec as executor
} from '../executor/iptables.js';
import {
    checkPost
} from '../util.js';

export default function () {
    var router = express.Router();
    router.get('/show', async function (req, res, next) {
        try {
            const p = await executor.getParsed();
            if (req.query.view === 'raw')
                res.send(executor.getRaw(p));
            else {
                if (req.query.user) {
                    res.json(executor.getByUsers(p, ...(req.query.user.toString()).split(',')));
                } else {
                    res.json((p));
                }
            }
        } catch (error) {
            next(error);
        }
    });
    router.post('/add', checkPost(['user']), async function (req, res, next) {
        try {
            res.json(await executor.setAddUser(req.body.user.toString()));
        } catch (error) {
            next(error);
        }
    });
    router.post('/del', checkPost(['user']), async function (req, res, next) {
        try {
            res.json(await executor.setDelUser(req.body.user.toString()));
        } catch (error) {
            next(error);
        }
    });
    return router;
}