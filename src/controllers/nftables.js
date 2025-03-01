import express from 'express';
import {
    nftablesExec as executor
} from '../executor/nftables.js';
import {
    checkPost
} from '../util.js';
import shelljs from 'shelljs';

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
                const id = shelljs.exec("id -u " + user).stdout.trim();
                return res.json(executor.getByUser(p, user, id));
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
            const id = shelljs.exec("id -u " + user).stdout.trim();
            res.json(await executor.setAddUser(user, id));
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
            const id = shelljs.exec("id -u " + user).stdout.trim();
            res.json(await executor.setDelUser(user, id));
        } catch (error) {
            next(error);
        }
    });
    return router;
}