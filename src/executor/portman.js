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
      var port = parseInt(x[1]);
      var user = users.get(x[0]);
      if (port && user) {
        return [user, port, listens.has(port)]
      } else {
        return null;
      }
    }).filter(x => x);
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
