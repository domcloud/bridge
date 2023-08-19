import {
    cat,
    appendIfNotExist,
    deleteIfNotExist,
    executeLock,
    spawnSudoUtil,
    writeTo
} from '../util.js';
import {
    encodeIPTables,
    parseIptablesDoc
} from '../parsers/iptables.js';
import path from 'path';
const tmpFile = path.join(process.cwd(), '/.tmp/iptables')
const tmpFile6 = path.join(process.cwd(), '/.tmp/ip6tables')

class IptablesExecutor {
    getRaw(parsed) {
        return encodeIPTables(parsed);
    }
    /**
     * @param {any} parsed
     * @param {string[]} users
     */
    getByUsers(parsed, ...users) {
        return users.map(u => (
            parsed.filter?.rules.find(x => x["--uid-owner"] === u)
        ))
    }
    async getParsed() {
        await executeLock('iptables', async () => {
            await spawnSudoUtil('IPTABLES_GET');
        });
        return parseIptablesDoc(cat(tmpFile));
    }
    async setAddUser(user) {
        const v4 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IPTABLES_GET');
            var p = parseIptablesDoc(cat(tmpFile));
            const rules = p.filter.rules;
            if (!appendIfNotExist(rules, {
                    "-A": "OUTPUT",
                    "-m": "owner",
                    "--uid-owner": user,
                    "-j": "REJECT"
                })) {
                return "Done unchanged for iptables";
            }
            writeTo(tmpFile, encodeIPTables(p));
            await spawnSudoUtil('IPTABLES_SET');
            return "Updated for iptables";
        });
        const v6 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IP6TABLES_GET');
            var p = parseIptablesDoc(cat(tmpFile6));
            const rules = p.filter.rules;
            if (!appendIfNotExist(rules, {
                    "-A": "OUTPUT",
                    "-m": "owner",
                    "--uid-owner": user,
                    "-j": "REJECT"
                })) {
                return "Done unchanged for ip6tables";
            }
            writeTo(tmpFile6, encodeIPTables(p));
            await spawnSudoUtil('IP6TABLES_SET');
            return "Updated for ip6tables";
        });
        return [v4, v6].join(", ");
    }
    async setDelUser(user) {
        const v4 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IPTABLES_GET');
            var p = parseIptablesDoc(cat(tmpFile));
            const rules = p.filter.rules;
            if (!deleteIfNotExist(rules, {
                    "-A": "OUTPUT",
                    "-m": "owner",
                    "--uid-owner": user,
                    "-j": "REJECT"
                })) {
                return "Done unchanged for iptables";
            }
            writeTo(tmpFile, encodeIPTables(p));
            await spawnSudoUtil('IPTABLES_SET');
            return "Updated for iptables";
        });
        const v6 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IP6TABLES_GET');
            var p = parseIptablesDoc(cat(tmpFile6));
            const rules = p.filter.rules;
            if (!deleteIfNotExist(rules, {
                    "-A": "OUTPUT",
                    "-m": "owner",
                    "--uid-owner": user,
                    "-j": "REJECT"
                })) {
                return "Done unchanged for ip6tables";
            }
            writeTo(tmpFile6, encodeIPTables(p));
            await spawnSudoUtil('IP6TABLES_SET');
            return "Updated for ip6tables";
        });
        return [v4, v6].join(", ");
    }
}

export const iptablesExec = new IptablesExecutor();
