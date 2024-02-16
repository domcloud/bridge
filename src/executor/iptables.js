import { encodeIptablesDoc, genRules, parseIptablesDoc } from '../parsers/iptables.js';
import {
    cat,
    appendIfNotExist,
    deleteIfExist,
    executeLock,
    spawnSudoUtil,
    writeTo
} from '../util.js';
import path from 'path';
const tmpFile = path.join(process.cwd(), '/.tmp/iptables')
const tmpFile6 = path.join(process.cwd(), '/.tmp/ip6tables')

class IptablesExecutor {
    /**
     * @param {any} parsed
     */
    getByUser(parsed, userName, userID = "") {
        const setRules = genRules(userName, userID);
        return parsed.filter.some((x) => setRules.includes(x));
    }
    async getParsed() {
        await executeLock('iptables', async () => {
            await spawnSudoUtil('IPTABLES_GET');
        });
        return parseIptablesDoc(cat(tmpFile));
    }
    async setAddUser(userName, userID = "") {
        const v4 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IPTABLES_GET');
            var p = parseIptablesDoc(cat(tmpFile));
            const rules = p.filter;
            const setRules = genRules(userName, userID);

            if (!appendIfNotExist(rules, setRules)) {
                return "Done unchanged for iptables";
            }
            writeTo(tmpFile, encodeIptablesDoc(p));
            await spawnSudoUtil('IPTABLES_SET');
            return "Updated for iptables";
        });
        const v6 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IP6TABLES_GET');
            var p = parseIptablesDoc(cat(tmpFile6));
            const rules = p.filter;
            const setRules = genRules(userName, userID);

            if (!appendIfNotExist(rules, setRules)) {
                return "Done unchanged for iptables";
            }
            writeTo(tmpFile6, encodeIptablesDoc(p));
            await spawnSudoUtil('IP6TABLES_SET');
            return "Updated for ip6tables";
        });
        return [v4, v6].join(", ");
    }
    async setDelUser(userName, userID = "") {
        const v4 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IPTABLES_GET');
            var p = parseIptablesDoc(cat(tmpFile));
            const rules = p.filter;
            const setRules = genRules(userName, userID);

            if (!deleteIfExist(rules, setRules)) {
                return "Done unchanged for iptables";
            }
            writeTo(tmpFile, encodeIptablesDoc(p));
            await spawnSudoUtil('IPTABLES_SET');
            return "Updated for iptables";
        });
        const v6 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IP6TABLES_GET');
            var p = parseIptablesDoc(cat(tmpFile6));
            const rules = p.filter;
            const setRules = genRules(userName, userID);

            if (!deleteIfExist(rules, setRules)) {
                return "Done unchanged for iptables";
            }
            writeTo(tmpFile6, encodeIptablesDoc(p));
            await spawnSudoUtil('IP6TABLES_SET');
            return "Updated for ip6tables";
        });
        return [v4, v6].join(", ");
    }
}

export const iptablesExec = new IptablesExecutor();
