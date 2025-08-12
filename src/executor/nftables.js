import {
    appendIfRecordNotExist,
    deleteIfRecordExist,
    encodeIptablesDoc,
    genRules, parseIptablesDoc
} from '../helpers/nftables.js';
import {
    cat,
    executeLock,
    spawnSudoUtil,
    writeTo
} from '../util.js';
import path from 'path';
const tmpFile = path.join(process.cwd(), '/.tmp/nftables')

class IptablesExecutor {
    /**
     * @param {string[]} parsed
     * @param {string} userName
     */
    getByUser(parsed, userName, userID = "") {
        const setRules = genRules(userName, userID);
        return parsed.some((x) => setRules.includes(x));
    }
    async getParsed() {
        await executeLock('nftables', async () => {
            await spawnSudoUtil('FIREWALL_GET');
        });
        return parseIptablesDoc(await cat(tmpFile));
    }
    async setAddUser(userName, userID = "") {
        return await executeLock('nftables', async () => {
            await spawnSudoUtil('FIREWALL_GET');
            var rules = parseIptablesDoc(await cat(tmpFile));
            const setRules = genRules(userName, userID);

            if (!appendIfRecordNotExist(rules, setRules)) {
                return "Done unchanged for nftables";
            }
            await writeTo(tmpFile, encodeIptablesDoc(rules));
            await spawnSudoUtil('FIREWALL_SET');
            return "Updated for nftables";
        });
    }
    async setDelUser(userName, userID = "") {
        return await executeLock('nftables', async () => {
            await spawnSudoUtil('FIREWALL_GET');
            var rules = parseIptablesDoc(await cat(tmpFile));
            const setRules = genRules(userName, userID);

            if (!deleteIfRecordExist(rules, setRules)) {
                return "Done unchanged for nftables";
            }
            await writeTo(tmpFile, encodeIptablesDoc(rules));
            await spawnSudoUtil('FIREWALL_SET');
            return "Updated for nftables";
        });
    }
}

export const nftablesExec = new IptablesExecutor();
