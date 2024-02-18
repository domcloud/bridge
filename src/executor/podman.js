import {
    executeLock,
    spawnSudoUtil,
} from '../util.js';
import { existsSync } from 'fs';

class PodmanExecutor {
    LOGINLINGERDIR =  '/var/lib/systemd/linger';
    constructor() {
        if (process.env.LOGINLINGERDIR) {
            this.LOGINLINGERDIR = '/var/lib/systemd/linger';
        }
    }
    /**
     * @param {string} user
     */
    checkPodmanEnabled(user) {
        return existsSync(this.LOGINLINGERDIR + '/' + user);
    }
    /**
     * @param {string} user
     */
    async enablePodman(user) {
        if (this.checkPodmanEnabled(user)) {
            return "Done unchanged";
        }
        return await executeLock('podman', async () => {
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "usermod", "--add-subuids", "100000-165535",
                "--add-subgids", "100000-165535", user]);
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "loginctl", "enable-linger", user]);
            return "Updated for podman";
        });
    }
    /**
     * @param {string} user
     */
    async disablePodman(user) {
        if (!this.checkPodmanEnabled(user)) {
            return "Done unchanged";
        }
        return await executeLock('podman', async () => {
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "usermod", "--del-subuids", "100000-165535",
                "--del-subgids", "100000-165535", user]);
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "loginctl", "disable-linger", user]);
            return "Updated for podman";
        });
    }
}

export const podmanExec = new PodmanExecutor();
