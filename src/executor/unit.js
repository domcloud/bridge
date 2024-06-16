import { ShellString } from 'shelljs';
import path from 'path';
import {
    executeLock,
    spawnSudoUtil,
} from '../util.js';

const tmpFile = path.join(process.cwd(), '/.tmp/unit')

class UnitExecutor {
    constructor() {
    }
    /**
     * @param {string} path
     * @returns {Promise<{code: string | number, stdout: string, stderr: string}>}
     */
    async get(path) {
        return await spawnSudoUtil("UNIT_GET", [path]);
    }
    /**
     * @param {string} path
     * @param {string} body
     * @returns {Promise<{code: string | number, stdout: string, stderr: string}>}
     */
    async set(path, body) {
        return await executeLock('unit', async () => {
            ShellString(body).to(tmpFile);
            return await spawnSudoUtil("UNIT_SET", [path]);
        });
    }
}

export const unitExec = new UnitExecutor();
