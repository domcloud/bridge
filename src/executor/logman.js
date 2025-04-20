import {
    cat,
    executeLock,
    spawnSudoUtil,
    writeTo
} from '../util.js';
import { XMLParser } from "fast-xml-parser";
import { readFile } from "fs/promises";

class LogmanExecutor {
    constructor() {
    }
    /**
     * @param {string} user
     * @param {string} type
     * @param {string} sub
     * @param {number} n
     */
    async getLog(user, type, sub, n) {
        let home = `/home/${user}`;
        if (sub) {
            home += `/domains/${sub}`
        }
        switch (type) {
            case 'access':
                return await spawnSudoUtil("SHELL_SUDO", ["root",
                    "tail", "-n", n + '', `${home}/logs/access_log`]);
            case 'error':
                return await spawnSudoUtil("SHELL_SUDO", ["root",
                    "tail", "-n", n + '', `${home}/logs/error_log`]);
            case 'php':
                return await spawnSudoUtil("SHELL_SUDO", ["root",
                    "tail", "-n", n + '', `${home}/logs/php_log`]);
            case 'proxfix':
                return await spawnSudoUtil("SHELL_SUDO", ["root",
                    "tail", "-n", n + '', `/home/${user}/tmp/app.log`]);
            case 'passenger':
                const procs = await this.getPassengerPids(user);
                if (procs.code !== 0) {
                    return procs;
                }
                let pids = Object.values(procs.stdout).flatMap(x => x).join('\\|');
                let pes = await spawnSudoUtil("PASSENGERLOG_GET", [pids, n + '']);
                if (pes.code == 0) {
                    // @ts-ignore
                    pes.processes = procs;
                }
                return pes;
            default:
                return {
                    code: 255,
                    stderr: 'Unknown log type ' + type,
                    stdout: '',
                }
        }
    }
    /**
     * @param {any} domain
     */
    async restartPassenger(domain) {
        const user = domain['Username'];
        const procs = await this.getPassengerPids(user);
        if (procs.code !== 0) {
            return procs.stderr;
        }
        let pids = Object.values(procs.stdout).flatMap(x => x);
        if (pids) {
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "kill", "-9", ...pids
            ]);
            return "Sent SIGKILL to processes " + pids;
        }
        return "No processes currently running.";
    }
    /**
     * @param {string} user
     * @param {string} name
     */
    async getPassengerPids(user, name = null) {
        let peo, pe;
        try {
            pe = process.env.NODE_ENV === 'development' ?
                { stdout: await readFile(name ? './test/passenger-status' : './test/passenger-status-multi', { encoding: 'utf-8' }), stderr: '' } :
                await spawnSudoUtil("SHELL_SUDO", name ? [user,
                    "passenger-status", name, "--show=xml"]: [user,
                    "passenger-status", "--show=xml"]);
            peo = (pe.stdout + pe.stderr).trim();
        } catch (error) {
        }
        if (!peo) {
            return {
                code: 255,
                stderr: 'No passenger app is found or it\'s not initialized yet ' + (name || ''),
                stdout: {},
                raw: pe,
            }
        }
        if (peo.startsWith('It appears that multiple Phusion Passenger(R) instances are running') && !name) {
            var pids = peo.match(/^\w{8}\b/gm)
            var objs = {};
            for (const p of pids) {
                Object.assign(objs, (await this.getPassengerPids(user, p)).stdout);
            }
            return {
                code: 0,
                stderr: '',
                stdout: objs
            }

        }
        const parser = new XMLParser();
        let peom = parser.parse(peo);
        let peoma = peom?.info?.supergroups?.supergroup;
        if (!peoma) {
            return {
                code: 255,
                stderr: 'incomplete response from passenger-status',
                stdout: {}
            }
        }
        let peomaa = Array.isArray(peoma) ? peoma : [peoma];
        let peomaps = peomaa.map(x => x.group).filter(x => x.processes);
        if (!peomaps.length) {
            return {
                code: 255,
                stderr: 'No processes reported from passenger-status is running',
                stdout: {}
            }
        }
        let procs = peomaps.reduce((a, b) => {
            let x = (Array.isArray(b.processes.process) ? b.processes.process : [b.processes.process]);
            a[b.name] = x.map(y => y.pid).filter(y => typeof y === "number");
            return a;
        }, {});
        return {
            code: 0,
            stderr: '',
            stdout: procs
        };
    }
}

export const logmanExec = new LogmanExecutor();
