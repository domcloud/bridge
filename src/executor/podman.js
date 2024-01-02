import {
    cat,
    executeLock,
    spawnSudoUtil,
    writeTo
} from '../util.js';
import { writeFile } from 'fs/promises';

const killIgnoreFile = '.killignore'

class PodmanExecutor {
    constructor() {
    }
    /**
     * @param {string} user
     */
    checkPodmanEnabled(user) {
        try {
            return cat(killIgnoreFile).split('\n').includes(user);
        } catch (err) {
            if (err.code === 'ENOENT') {
                writeTo(killIgnoreFile, "root\n");
            } else {
                throw err;
            }
            return false;
        }
    }
    /**
     * @param {string} user
     */
    async enablePodman(user) {
        if (this.checkPodmanEnabled(user)) {
            return "Done unchanged";
        }
        return await executeLock('podman', async () => {
            const content = cat(killIgnoreFile).trim() + `\n${user}\n`;
            await writeFile(killIgnoreFile, content, {
                encoding: 'utf-8'
            });
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "usermod", "--add-subuids", "100000-165535",
                "--add-subgids", "100000-165535", user]);
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
            var content = cat(killIgnoreFile).trim().split('\n').filter(x => x !== user);
            await writeFile(killIgnoreFile, content.join("\n") + "\n", {
                encoding: 'utf-8'
            });
            await spawnSudoUtil("SHELL_SUDO", ["root",
                "usermod", "--del-subuids", "100000-165535",
                "--del-subgids", "100000-165535", user]);
            return "Updated for podman";
        });
    }
}

export const podmanExec = new PodmanExecutor();
