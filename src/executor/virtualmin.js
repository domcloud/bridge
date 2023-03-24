import shelljs from "shelljs";
import {
    escapeShell,
    spawnSudoUtil,
    spawnSudoUtilAsync
} from "../util.js";
const {
    cat
} = shelljs;

class VirtualminExecutor {
    /**
     * @param {string | string[]} domain
     */
    async getDomainInfo(domain, simple = true) {
        let r = await virtualminExec.execFormatted("list-domains", {
            domain,
            [simple ? 'simple-multiline' : 'multiline']: true
        });
        if (process.env.NODE_ENV === 'development')
            r = {
                code: 0,
                stdout: cat('./test/info'),
                stderr: '',
            }
        if (r.code === 255)
            throw r;
        let data = r.stdout.split('\n'),
            result = {},
            neskey = '',
            nesval = {};
        for (let line of data) {
            line = line.trimEnd();
            if (line.length >= 4 && line[0] === ' ') {
                let pair = line.trimStart().split(':', 2);
                if (pair.length === 2) {
                    nesval[pair[0]] = pair[1].trimStart();
                }
            } else if (line.length >= 1 && !line.includes(' ')) {
                if (neskey) {
                    result[neskey] = nesval;
                    nesval = {};
                }
                neskey = line;
            }
        }
        result[neskey] = nesval;
        if (typeof domain === 'string') {
            result = result[domain];
        }
        return result;
    }
    /**
     * @param {string | string[]} domain
     */
    async getBandwidthInfo(domain) {
        let r = await virtualminExec.execFormatted("list-bandwidth", {
            domain,
        });
        if (process.env.NODE_ENV === 'development')
            r = {
                code: 0,
                stdout: cat('./test/bandwidth'),
                stderr: '',
            }
        if (r.code === 255)
            throw r;
        let data = r.stdout.split('\n'),
            result = {},
            neskey = '',
            nesval = {};
        for (let line of data) {
            line = line.trimEnd();
            if (line.length >= 4 && line[0] === ' ') {
                let pair = line.trimStart().split(':', 3);
                if (pair.length === 3) {
                    nesval[pair[0]] = parseInt(pair[2].trim());
                }
            } else if (line.length >= 1 && !line.includes(' ')) {
                if (neskey) {
                    result[neskey] = nesval;
                    nesval = {};
                }
                neskey = line.replace(/:|\r/g, '');
            }
        }
        result[neskey] = nesval;
        if (typeof domain === 'string') {
            result = result[domain];
        }
        return result;
    }
    /**
     * @param {string} program
     * @param {object[]} opts
     */
    async execFormatted(program, ...opts) {
        let p = [program];
        Object.entries(Object.assign({}, ...(opts.filter(x => x && typeof x === 'object'))))
            .forEach(([k, v]) => {
                if (v) {
                    k = "--" + k;
                    if (typeof v === 'boolean')
                        p.push(escapeShell(k));
                    else if (Array.isArray(v))
                        v.forEach(e => {
                            p.push(escapeShell(k), escapeShell(e));
                        });
                    else
                        p.push(escapeShell(k), escapeShell(v));
                }
            });
        return await this.exec(...p);
    }
    /**
     * @param {string} program
     * @param {object[]} opts
     */
    execFormattedAsync(program, ...opts) {
        let p = [program];
        Object.entries(Object.assign({}, ...(opts.filter(x => x && typeof x === 'object'))))
            .forEach(([k, v]) => {
                if (v) {
                    k = "--" + k;
                    if (typeof v === 'boolean')
                        p.push(escapeShell(k));
                    else
                        p.push(escapeShell(k), escapeShell(v));
                }
            });
        return this.execAsync(...p);
    }
    /**
     * @param {string[]} command
     */
    async exec(...command) {
        let str = await spawnSudoUtil('VIRTUALMIN', command);
        // virtualmin often produce extra blank lines
        str.stdout = ('' + str.stdout).replace(/^\s*\n/gm, '');
        str.stderr = ('' + str.stderr).replace(/^\s*\n/gm, '');
        return str;
    }

    /**
     * @param {string[]} command
     */
    execAsync(...command) {
        return spawnSudoUtilAsync('VIRTUALMIN', command);
    }
}

export const virtualminExec = new VirtualminExecutor();