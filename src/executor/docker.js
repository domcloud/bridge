import {
    executeLock,
    spawnSudoUtil,
} from '../util.js';
import { existsSync } from 'fs';

class DockerExecutor {
    LOGINLINGERDIR =  '/var/lib/systemd/linger';
    constructor() {
        if (process.env.LOGINLINGERDIR) {
            this.LOGINLINGERDIR = process.env.LOGINLINGERDIR;
        }
    }
    /**
     * @param {string} user
     */
    checkDockerEnabled(user) {
        return existsSync(this.LOGINLINGERDIR + '/' + user);
    }
    /**
     * @param {string} user
     */
    async enableDocker(user) {
        if (this.checkDockerEnabled(user)) {
            return "Done unchanged";
        }
        return await executeLock('docker', async () => {
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "usermod", "--add-subuids", "100000-165535",
                "--add-subgids", "100000-165535", user]);
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "loginctl", "enable-linger", user]);
            return "Updated for docker";
        });
    }
    /**
     * @param {string} user
     */
    async disableDocker(user) {
        if (!this.checkDockerEnabled(user)) {
            return "Done unchanged";
        }
        return await executeLock('docker', async () => {
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "usermod", "--del-subuids", "100000-165535",
                "--del-subgids", "100000-165535", user]);
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "loginctl", "disable-linger", user]);
            return "Updated for docker";
        });
    }
}

export const dockerExec = new DockerExecutor();
