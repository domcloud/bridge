import {
  cat,
  executeLock,
  getListeningPorts,
  getUnameMap,
  spawnSudoUtil,
  splitLimit,
  writeTo,
} from '../util.js';
import path from 'path';

const portsTmpFile = path.join(process.cwd(), '/.tmp/ports')

class PortmanExecutor {
  /**
   * 
   * @returns {Promise<[string, string][]>}
   */
  async listPorts() {
    let result = await spawnSudoUtil("PORTS_LIST");
    // @ts-ignore
    return result.stdout
      .trim()
      .split("\n")
      .map((x) => splitLimit(x, ":", 2))
      .filter(x => x.length == 2);
  }
  async listPortsExtended() {
    let ports = await this.listPorts();
    let users = await getUnameMap();
    let listens = await getListeningPorts();

    return ports.map(x => {
      return [users.get(x[0]) || x[0], x[1], listens.has(x[1])]
    });
  }
  /**
   * @param {string} uid
   * @param {number[]} ports
   */
  async writePorts(uid, ports) {
    return await executeLock("ports", async () => {
      await spawnSudoUtil("PORTS_GET", []);
      var lines = (await cat(portsTmpFile)).trim().split("\n");
      let changed = false;
      for (const port of ports) {
        const findLine = uid + ":" + port;
        if (lines.findIndex(x => x == findLine) == -1) {
          lines.push(findLine);
          changed = true;
        }
      }
      if (changed) {
        await writeTo(portsTmpFile, lines.join("\n") + "\n");
        await spawnSudoUtil("PORTS_SET", []);
        return "Ports allocation added";
      } else {
        return "Ports allocation unchanged";
      }
    });
  }
}

export const portmanExec = new PortmanExecutor();
