import shelljs from "shelljs";
import {
    escapeShell,
    spawnSudoUtil
} from "../util.js";
const {
    cat
} = shelljs;

class VirtualminExecutor {
    async getDomainInfo(domain = '', simple = true) {
        try {
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
                } else if (line.length >= 1) {
                    if (neskey) {
                        result[neskey] = nesval;
                        nesval = {};
                    }
                    neskey = line;
                } else {
                    nesval[neskey] = line;
                    break;
                }
            }
            if (domain) {
                result = result[domain];
            }
            return result;
        } catch (error) {
            console.log(error);
            return null;
        }
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
                    else
                        p.push(escapeShell(k), escapeShell(v));
                }
            });
        try {
            return await this.exec(...p);
        } catch (error) {
            return error;
        }
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
}

export const virtualminExec = new VirtualminExecutor();