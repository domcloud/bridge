import {
    cat,
    escapeShell,
    executeLock,
    spawnSudoUtil,
    spawnSudoUtilAsync,
    splitLimit,
    writeTo
} from "../util.js";
import path from 'path';
const tmpFile = path.join(process.cwd(), '/.tmp/virtual-server')

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
        /**
         * @type {Record<string, Record<string, string>>}
         */
        let result = {};
        /**
         * @type {Record<string, string>}
         */
        let nesval = {};
        let data = r.stdout.split('\n'),
            neskey = '';
        for (let line of data) {
            line = line.trimEnd();
            if (line.length >= 4 && line[0] === ' ') {
                let pair = splitLimit(line.trimStart(), /:/g, 2);
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
            return result[domain];
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
                let pair = /([\d-]+):.*web:(\d+)/.exec(line.trimStart());
                if (pair && pair.length === 3) {
                    nesval[pair[1]] = parseInt(pair[2]);
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
                    else if (Array.isArray(v))
                        v.forEach(e => {
                            if (Array.isArray(e)) {
                                p.push(escapeShell(k), ...e.map(ee => escapeShell(ee)));
                            } else {
                                p.push(escapeShell(k), escapeShell(e));
                            }
                        });
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

    /**
     * @param {string} id
     * @param {{ [s: string]: string; }} props
     */
    async pushVirtualServerConfig(id, props) {
        return await executeLock('virtual-server', () => {
            return new Promise((resolve, reject) => {
                spawnSudoUtil('VIRTUAL_SERVER_GET', [id]).then(() => {
                    const fileConf = cat(tmpFile);
                    const config = cat(tmpFile).trimEnd().split("\n");
                    for (const [key, value] of Object.entries(props)) {
                        let i = config.findIndex(x => x.startsWith(key + '='));
                        if (i >= 0) {
                            config[i] = key + '=' + value;
                        } else {
                            config.push(key + '=' + value)
                        }
                    }
                    config.push('');
                    const outConf = config.join("\n");
                    if (outConf != fileConf) {
                        writeTo(tmpFile, outConf);
                        spawnSudoUtil('VIRTUAL_SERVER_SET', [id]).then(() => {
                            resolve("Done updated\n");
                        }).catch((err) => {
                            reject(err);
                        })
                    } else {
                        resolve("Nothing changed\n");
                    }
                }).catch(reject);
            });
        })
    }
}

export const virtualminExec = new VirtualminExecutor();