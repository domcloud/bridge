import express from 'express';
import {
    appendIfNotExist,
    checkPost,
    deleteIfNotExist,
    executeLock,
    spawnSudoUtil
} from '../util.js';
import {
    encodeIPTables,
    parseIptablesDoc
} from '../parsers/iptables.js';
import shelljs from 'shelljs';
import path from 'path';
const tmpFile = path.join(process.cwd(), '/.tmp/iptables')
const tmpFile6 = path.join(process.cwd(), '/.tmp/ip6tables')

const {
    cat,
    ShellString
} = shelljs;
export default function () {
    var router = express.Router();
    router.get('/show', async function (req, res, next) {
        await executeLock('iptables', async () => {
            await spawnSudoUtil('IPTABLES_GET');
        });
        var p = parseIptablesDoc(cat(tmpFile));
        if (req.query.view === 'raw')
            res.send(encodeIPTables(p));
        else {
            if (req.query.user) {
                res.json(("" + req.query.user).split(',').map(u => (
                    p.filter.rules.find(x => x["--uid-owner"] === u)
                )));
            } else {
                res.json((p));
            }
        }
    });
    router.post('/add', checkPost(['user']), async function (req, res, next) {
        const v4 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IPTABLES_GET');
            var p = parseIptablesDoc(cat(tmpFile));
            const rules = p.filter.rules;
            if (!appendIfNotExist(rules, {
                    "-A": "OUTPUT",
                    "-m": "owner",
                    "--uid-owner": req.body.user,
                    "-j": "REJECT"
                })) {
                return "Done unchanged for iptables";
            }
            ShellString(encodeIPTables(p)).to(tmpFile);
            return "Updated for iptables";
        });
        const v6 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IPTABLES_GET');
            var p = parseIptablesDoc(cat(tmpFile6));
            const rules = p.filter.rules;
            if (!appendIfNotExist(rules, {
                    "-A": "OUTPUT",
                    "-m": "owner",
                    "--uid-owner": req.body.user,
                    "-j": "REJECT"
                })) {
                return "Done unchanged for ip6tables";
            }
            ShellString(encodeIPTables(p)).to(tmpFile6);
            return "Updated for ip6tables";
        });
        res.json([v4, v6].join(", "));
    });
    router.post('/del', checkPost(['user']), async function (req, res, next) {
        const v4 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IPTABLES_GET');
            var p = parseIptablesDoc(cat(tmpFile));
            const rules = p.filter.rules;
            if (!deleteIfNotExist(rules, {
                    "-A": "OUTPUT",
                    "-m": "owner",
                    "--uid-owner": req.body.user,
                    "-j": "REJECT"
                })) {
                return "Done unchanged for iptables";
            }
            ShellString(encodeIPTables(p)).to(tmpFile);
            return "Updated for iptables";
        });
        const v6 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IPTABLES_GET');
            var p = parseIptablesDoc(cat(tmpFile6));
            const rules = p.filter.rules;
            if (!deleteIfNotExist(rules, {
                    "-A": "OUTPUT",
                    "-m": "owner",
                    "--uid-owner": req.body.user,
                    "-j": "REJECT"
                })) {
                return "Done unchanged for ip6tables";
            }
            ShellString(encodeIPTables(p)).to(tmpFile6);
            return "Updated for ip6tables";
        });
        res.json([v4, v6].join(", "));
    });
    return router;
}