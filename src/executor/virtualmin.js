import shelljs from "shelljs";
import {
    spawnSudoUtil
} from "../util.js";
const {
    cat
} = shelljs;

class VirtualminExecutor {
    async getDomainInfo(domain) {
        try {
            let r = await virtualminExec.execFormatted("list-domains", {
                domain,
                multiline: true
            });
            if (process.env.NODE_ENV === 'development')
                r = {
                    code: 0,
                    stdout: cat('./test/info'),
                    stderr: '',
                }
            if (r.code !== 0)
                throw r;
            return r.stdout.split('\n')
                .filter(l => l.startsWith('    '))
                .map(l => l.split(':', 2).map(x => x.trim()))
                .reduce((c, k) => {
                    if (k.length === 2)
                        c[k[0]] = k[1]
                    return c;
                }, {});
        } catch (error) {
            return null;
        }
    }
    async execFormatted(program, ...opts) {
        let p = [program];
        Object.entries(Object.assign({}, ...(opts.filter(x => x && typeof x === 'object')))).forEach(([k, v]) => {
            if (v) {
                if (typeof v === 'boolean')
                    p.push("--" + k);
                else
                    p.push("--" + k, v);
            }
        });
        return await this.exec(...p);
    }
    /**
     * @param {string[]} command
     */
    async exec(...command) {
        return await spawnSudoUtil('VIRTUALMIN', command);
    }
}

export const virtualminExec = new VirtualminExecutor();