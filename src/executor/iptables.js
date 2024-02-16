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
        const setRules = [
            `-A OUTPUT -m owner --uid-owner ${userID} -j REJECT -m comment --comment "${userName}"`,
            `-A OUTPUT -m owner --uid-owner ${userName} -j REJECT`,
        ]

        return parsed.filter.some((x) => setRules.includes(x));
    }
    /**
     * 
     * @param {string} doc 
     * @returns {Record<string, string[]>}
     */
    parseIptablesDoc(doc = '') {
        return doc.split('*').slice(1)
            .map(block => '*' + block.trim())
            .map(block => block.split("\n").filter(x => !x.startsWith('#')))
            .reduce((obj, block) => {
                obj[block[0].substring(1)] = block;
                return obj;
            }, {});
    }
    encodeIptablesDoc(doc) {
        return Object.values(doc).map(x => x.join('\n')).join('\n\n') + '\n';
    }
    async getParsed() {
        await executeLock('iptables', async () => {
            await spawnSudoUtil('IPTABLES_GET');
        });
        return this.parseIptablesDoc(cat(tmpFile));
    }
    async setAddUser(userName, userID = "") {
        const v4 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IPTABLES_GET');
            var p = this.parseIptablesDoc(cat(tmpFile));
            const rules = p.filter;

            const setRules = [
                `-A OUTPUT -m owner --uid-owner ${userID} -j REJECT -m comment --comment "${userName}"`,
                `-A OUTPUT -m owner --uid-owner ${userName} -j REJECT`,
            ]

            if (!appendIfNotExist(rules, setRules)) {
                return "Done unchanged for iptables";
            }
            writeTo(tmpFile, this.encodeIptablesDoc(p));
            await spawnSudoUtil('IPTABLES_SET');
            return "Updated for iptables";
        });
        const v6 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IP6TABLES_GET');
            var p = this.parseIptablesDoc(cat(tmpFile6));
            const rules = p.filter;

            const setRules = [
                `-A OUTPUT -m owner --uid-owner ${userID} -j REJECT -m comment --comment "${userName}"`,
                `-A OUTPUT -m owner --uid-owner ${userName} -j REJECT`,
            ]

            if (!appendIfNotExist(rules, setRules)) {
                return "Done unchanged for iptables";
            }
            writeTo(tmpFile6, this.encodeIptablesDoc(p));
            await spawnSudoUtil('IP6TABLES_SET');
            return "Updated for ip6tables";
        });
        return [v4, v6].join(", ");
    }
    async setDelUser(userName, userID = "") {
        const v4 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IPTABLES_GET');
            var p = this.parseIptablesDoc(cat(tmpFile));
            const rules = p.filter;

            const setRules = [
                `-A OUTPUT -m owner --uid-owner ${userID} -j REJECT -m comment --comment "${userName}"`,
                `-A OUTPUT -m owner --uid-owner ${userName} -j REJECT`,
            ]

            if (!deleteIfExist(rules, setRules)) {
                return "Done unchanged for iptables";
            }
            writeTo(tmpFile, this.encodeIptablesDoc(p));
            await spawnSudoUtil('IPTABLES_SET');
            return "Updated for iptables";
        });
        const v6 = await executeLock('iptables', async () => {
            await spawnSudoUtil('IP6TABLES_GET');
            var p = this.parseIptablesDoc(cat(tmpFile6));
            const rules = p.filter;

            const setRules = [
                `-A OUTPUT -m owner --uid-owner ${userID} -j REJECT -m comment --comment "${userName}"`,
                `-A OUTPUT -m owner --uid-owner ${userName} -j REJECT`,
            ]

            if (!deleteIfExist(rules, setRules)) {
                return "Done unchanged for iptables";
            }
            writeTo(tmpFile6, this.encodeIptablesDoc(p));
            await spawnSudoUtil('IP6TABLES_SET');
            return "Updated for ip6tables";
        });
        return [v4, v6].join(", ");
    }
}

export const iptablesExec = new IptablesExecutor();
