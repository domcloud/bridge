import path from 'path';
import {
    executeLock,
    spawnSudoUtil,
    splitLimit,
    writeTo,
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
            await writeTo(tmpFile, body);
            return await spawnSudoUtil("UNIT_SET", [path]);
        });
    }
    /**
     * @param {string} path
     * @returns {Promise<{code: string | number, stdout: string, stderr: string}>}
     */
    async del(path) {
        return await spawnSudoUtil("UNIT_DEL", [path]);
    }
    sandbox(config, domainname, domain) {
        let username = domain['Username'];
        let wd = (config['app_root'] || (domain['Parent domain'] ? `domains/${domainname}/public_html` : 'public_html'));
        wd = `/home/${username}/${wd}`.replace(/\/+/g, '/');
        wd.endsWith('/') && (wd = wd.substring(0, -1));
        let logbase = domain['Parent domain'] ? `/home/${username}/domains/${domainname}/logs` : `/home/${username}/logs`;
        let result = {
            "type": "external",
            "working_directory": wd,
            "executable": "/usr/local/bin/port",
            "stdout": `${logbase}/unit_stdout_log`,
            "stderr": `${logbase}/unit_stderr_log`,
            "user": username,
            "group": username,
            "arguments": [
                "bash",
                "-c",
                config['app_start_command']
            ],
            processes: {
                "max": 1,
                "spare": 0,
                "idle_timeout": 900
            }
        };

        if (Array.isArray(config.env_var_list) && config.env_var_list.length > 0) {
            let envMap = {};
            config.env_var_list.forEach((/** @type {String} */ v) => {
                var splt = splitLimit(v, /[= ]/g, 2);
                if (splt.length == 2) {
                    envMap[splt[0]] = splt[1];
                }
            });
            result.environment = envMap;
        }

        return result;
    }
    unsandbox(config) {
        if (!config || !config.working_directory) {
            return {};
        }
        return {
            app_start_command: config.arguments[2],
            app_root: config.working_directory.split('/').slice(3).join('/'),
            env_var_list: Object.entries(config.environment || {}).map(([k, v]) => `${k}=${v}`)
        }
    }
    async setDomain(domainname, config, domaindata) {
        if (!config.app_start_command) {
            return await this.del('/config/applications/' + domainname);
        }
        let data = this.sandbox(config, domainname, domaindata);
        return await this.set('/config/applications/' + domainname, JSON.stringify(data));
    }
}

export const unitExec = new UnitExecutor();
