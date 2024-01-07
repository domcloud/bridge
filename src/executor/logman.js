import {
    cat,
    executeLock,
    spawnSudoUtil,
    writeTo
} from '../util.js';
import { XMLParser } from "fast-xml-parser";
import { readFile } from "fs/promises";

class LogmanExecutor {
    PASSENGERLOG = '/var/log/nginx/passenger.log';
    constructor() {
        if (process.env.PASSENGERLOG) {
            this.PASSENGERLOG = process.env.PASSENGERLOG;
        }
    }
    /**
     * @param {any} domain
     * @param {string} type
     * @param {number} n
     */
    async getLog(domain, type, n) {
        switch (type) {
            case 'access':
                if (!domain['Access log']) {
                    return {
                        code: 255,
                        stderr: 'No access log found',
                    }
                }
                return await spawnSudoUtil("SHELL_SUDO", ["root",
                    "tail", "-n", n, domain['Access log']]);
            case 'error':
                if (!domain['Error log']) {
                    return {
                        code: 255,
                        stderr: 'No error log found',
                    }
                }
                return await spawnSudoUtil("SHELL_SUDO", ["root",
                    "tail", "-n", n, domain['Error log']]);
            case 'passenger':
                const user = domain['Username'];
                let peo;
                try {
                    const pe = process.env.NODE_ENV === 'development' ?
                        { stdout: await readFile('./test/passenger-status', { encoding: 'utf-8' }) } :
                        await spawnSudoUtil("SHELL_SUDO", [user,
                            "passenger-status", "--show=xml"]);
                    peo = pe.stdout.trim();
                } catch (error) {
                }
                if (!peo) {
                    return {
                        code: 255,
                        stderr: 'No passenger app is found or it\'s not initialized yet',
                    }
                }
                const parser = new XMLParser();
                let peom = parser.parse(peo);
                let peoma = peom?.info?.supergroups?.supergroup;
                if (!peoma) {
                    return {
                        code: 255,
                        stderr: 'incomplete response from passenger-status',
                        stdout: ''
                    }
                }
                let peomaa = Array.isArray(peoma) ? peoma : [peoma];
                let peomaps = peomaa.map(x => x.group).filter(x => x.processes);
                if (!peomaps.length) {
                    return {
                        code: 255,
                        stderr: 'No processes reported from passenger-status is running',
                        stdout: ''
                    }
                }
                let procs = peomaps.reduce((a, b) => {
                    let x = (Array.isArray(b.processes.process) ? b.processes.process : [b.processes.process]);
                    a[b.name] = x.map(y => y.pid).filter(y => typeof y === "number");
                    return a;
                }, {});
                let pids = Object.values(procs).flatMap(x => x).join('\\|');
                let pes = await spawnSudoUtil("SHELL_SUDO", ["root",
                    "bash", "-c", `grep -w "\\(^App\\|process\\) \\(${pids}\\)" "${this.PASSENGERLOG}" | tail -n ${n}`
                ]);
                if (pes.code == 0) {
                    // @ts-ignore
                    pes.processes = procs;
                }
                return pes;
            default:
                return {
                    code: 255,
                    stderr: 'Unknown log type ' + type
                }
        }
    }
}

export const logmanExec = new LogmanExecutor();
