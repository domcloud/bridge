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
   * @returns {Promise<[string, string, string?, string?][]>}
   */
  async listPorts() {
    let result = await spawnSudoUtil("PORTS_LIST");
    // @ts-ignore
    return result.stdout
      .trim()
      .split("\n")
      .map((x) => splitLimit(x, ":", 4))
      .filter(x => x.length >= 2);
  }

  async listPortsExtended() {
    let ports = await this.listPorts();
    let users = await getUnameMap();
    let listens = await getListeningPorts();

    return ports.map(x => {
      // [username, port, isListening, domain, service]
      return [
        users.get(x[0]) || x[0], 
        x[1], 
        listens.has(x[1]),
        x[2] || "", // domain
        x[3] || ""  // service
      ];
    });
  }
  /**
   * @param {string} uid
   * @param {{port: number, domain: string, service: string}[]} allocatedItems
   */
  async writePorts(uid, allocatedItems) {
    return await executeLock("ports", async () => {
      await spawnSudoUtil("PORTS_GET", []);
      var lines = (await cat(portsTmpFile)).trim().split("\n").filter(x => x);
      let changed = false;
      
      for (const item of allocatedItems) {
        // Format: UID:PORT:DOMAIN:SERVICE
        const findPrefix = uid + ":" + item.port + ":";
        const newLine = `${uid}:${item.port}:${item.domain}:${item.service}`;
        
        // If this exact port isn't tracked yet, add it
        if (!lines.some(x => x.startsWith(findPrefix))) {
          lines.push(newLine);
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
