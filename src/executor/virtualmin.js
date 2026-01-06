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
                stdout: await cat('./test/info'),
                stderr: '',
            }
        if (r.code === 255)
            throw r;
        let result = extractYaml(r.stdout);
        // workaround postgres bug
        for (const domainName of Object.keys(result)) {
            const pgVal = result[domainName]['Password for postgres'];
            if (/^'.+'$/.test(pgVal)) {
                result[domainName]['Password for postgres'] = pgVal.substring(1, pgVal.length - 1);
            }
        }
        if (typeof domain === 'string') {
            return result[domain];
        }
        return result;
    }
    /**
     * @param {string} user
     */
    async getDomainName(user) {
        let r = await virtualminExec.execFormatted("list-domains", {
            user,
            toplevel: true,
            'name-only': true,
        });
        if (process.env.NODE_ENV === 'development')
            r = {
                code: 0,
                stdout: await cat('./test/info'),
                stderr: '',
            }
        if (r.code === 255)
            throw r;
        return r.stdout.split('\n').filter(x => x);
    }
    /**
     * @param {string} domain
     */
    async getDomainParentInfo(domain) {
        let r = await virtualminExec.execFormatted("list-domains", {
            parent: domain,
            'name-only': true
        });
        if (process.env.NODE_ENV === 'development')
            r = {
                code: 0,
                stdout: 'example.com\n',
                stderr: '',
            }
        if (r.code === 255)
            throw r;
        return r.stdout.split('\n').filter(x => x);
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
                stdout: await cat('./test/bandwidth'),
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
     * @param {string} domain
     */
    async getDatabaseInfo(domain) {
        let r = await virtualminExec.execFormatted("list-databases", {
            domain,
            multiline: true,
        });
        if (process.env.NODE_ENV === 'development')
            r = {
                code: 0,
                stdout: await cat('./test/database'),
                stderr: '',
            }
        if (r.code === 255)
            throw r;
        r.stdout = r.stdout.trim();
        if (r.stdout == "") {
            return {};
        }
        return extractYaml(r.stdout);
    }
    /**
     * @param {string} domain
     */
    async getUserInfo(domain) {
        let r = await virtualminExec.execFormatted("list-users", {
            domain,
            multiline: true,
            'include-owner': true,
        });
        if (process.env.NODE_ENV === 'development')
            r = {
                code: 0,
                stdout: await cat('./test/user'),
                stderr: '',
            }
        if (r.code === 255)
            throw r;
        return extractYaml(r.stdout);
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
    formatExec(program, ...opts) {
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
        return p;
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
        return await executeLock('virtual-server', async () => {
            await spawnSudoUtil('VIRTUAL_SERVER_GET', [id]);
            const fileConf = await cat(tmpFile);
            const config = fileConf.trimEnd().split("\n");
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
                await writeTo(tmpFile, outConf);
                await spawnSudoUtil('VIRTUAL_SERVER_SET', [id]);
                return "Done updated\n";
            } else {
                return "Nothing changed\n";
            }
        })
    }
}

export const virtualminExec = new VirtualminExecutor();

/**
 * @param {string} str
 */
function extractYaml(str) {
    /**
     * @type {Record<string, Record<string, string>>}
     */
    let result = {};
    /**
     * @param {string} neskey
     */
    function check(neskey) {
        if (result[neskey]) {
            for (let i = 2; i < 1000; i++) {
                if (!result[neskey + ":" + i]) {
                    return neskey + ":" + i;
                }
            }
        }
        return neskey;
    }
    /**
     * @type {Record<string, string>}
     */
    let nesval = {};
    let data = str.split('\n'), neskey = '';
    for (let line of data) {
        line = line.trimEnd();
        if (line.length >= 4 && line[0] === ' ') {
            let pair = splitLimit(line.trimStart(), /:/g, 2);
            if (pair.length === 2) {
                nesval[pair[0]] = pair[1].trimStart();
            }
        } else if (line.length >= 1 && !line.includes(' ')) {
            if (neskey) {
                result[check(neskey)] = nesval;
                nesval = {};
            }
            neskey = line;
        }
    }
    result[check(neskey)] = nesval;
    return result;
}
