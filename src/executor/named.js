import { editNS, generateNS, parseNS } from '@domcloud/zone-editor';
import {
    cat,
    executeLock,
    spawnSudoUtil,
    writeTo
} from '../util.js';
import path from 'path';

const tmpFile = path.join(process.cwd(), '/.tmp/named')

class NamedExecutor {
    /**
     * @param {string} zone
     */
    async resync(zone) {
        await spawnSudoUtil('NAMED_SYNC', [zone]);
    }
    /**
     * @param {string} zone
     */
    async show(zone) {
        return await executeLock('named', async () => {
            await spawnSudoUtil('NAMED_GET', [zone]);
            const file = await cat(tmpFile);
            return {
                ...parseNS(file),
                raw: file
            };
        });
    }
    /**
     * @param {string} zone
     * @param {import('@domcloud/zone-editor').DNSChange[]} mods
     */
    async set(zone, mods) {
        return await executeLock('named', async () => {
            await spawnSudoUtil('NAMED_GET', ["" + zone]);
            if (!Array.isArray(mods)) {
                mods = [mods];
            }
            var file = parseNS(await cat(tmpFile));
            var changecount = editNS(file, mods, { zone });
            if (changecount === 0) {
                return "Done unchanged";
            }
            var result = generateNS(file);
            await writeTo(tmpFile, result);
            await spawnSudoUtil('NAMED_SET', ["" + zone]);
            return `Done updating ${changecount} records\n${result}`;
        });
    }
}

export const namedExec = new NamedExecutor();