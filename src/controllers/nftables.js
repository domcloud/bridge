import express from 'express';
import {
    nftablesExec as executor
} from '../executor/nftables.js';
import {
    checkPost,
    getUid
} from '../util.js';

export default function () {
    var router = express.Router();
    router.get('/show', async function (req, res, next) {
        try {
            const p = await executor.getParsed();
            const user = req.query.user?.toString();
            if (user) {
                if (user.match(/[^\w.-]/)) {
                    throw new Error("invalid username");
                }
                res.json(executor.getByUser(p, user, await getUid(user)));
                return;
            }
            res.json(p);
        } catch (error) {
            next(error);
        }
    });
    router.post('/add', checkPost(['user']), async function (req, res, next) {
        try {
            const user = req.body.user.toString();
            if (user.match(/[^\w.-]/)) {
                throw new Error("invalid username");
            }
            res.json(await executor.setAddUser(user, await getUid(user)));
        } catch (error) {
            next(error);
        }
    });
    router.post('/del', checkPost(['user']), async function (req, res, next) {
        try {
            const user = req.body.user.toString();
            if (user.match(/[^\w.-]/)) {
                throw new Error("invalid username");
            }
            res.json(await executor.setDelUser(user, await getUid(user)));
        } catch (error) {
            next(error);
        }
    });
    return router;
}