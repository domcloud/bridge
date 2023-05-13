import { spawnSudoUtil } from "../util.js";

class ScreendExecutor {
    /**
     * @param {string} user
     * @returns {Promise<any[]>}
     */
    async list(user) {
        var p = await spawnSudoUtil('SHELL_SUDO', [user, 'screend', 'list', '--format', 'json'])
        if (p.code !== 0) {
            throw new Error(p.stderr.toString());
        }
        return p.stdout.toString().split('\n').filter(x => x.trim()).map(x => JSON.parse(x));
    }
    /**
     * @param {string} user
     * @param {"start" | "restart" | "stop" | "remove" | "add"} command
     * @param {(string | string[])?} program
     */
    execute(user, command, program = null) {
        const cmds = [user, 'screend', command]
        if (program) {
            if (Array.isArray(program)) {
                cmds.push(...program)
            } else {
                cmds.push(program)
            }
        }
        return spawnSudoUtil('SHELL_SUDO', cmds)
    }
}

export const screendExecutor = new ScreendExecutor();