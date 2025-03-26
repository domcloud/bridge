import { cat, executeLock, spawnSudoUtil } from "../util.js";
import path from "path";
import { createClient } from "@redis/client";
import { exec } from "child_process";
import { ShellString } from "shelljs";

const tmpFile = path.join(process.cwd(), "/.tmp/redis-acl");

const aclSetUser = (user, pass) =>
  `on >${pass} ~${user}:* &${user}:* sanitize-payload ` +
  `-@all +@connection +@read +@write +@scripting +@keyspace -KEYS ` +
  `+@transaction +@geo +@hash +@set +@sortedset +@bitmap +@pubsub ` +
  `+config|get +info +time +acl|whoami +acl|cat +acl|genpass`;

const luaDelKeys = `
local cursor = 0
local keys = {}

repeat
    local result = redis.call('SCAN', cursor, 'MATCH', KEYS[1])
    cursor = tonumber(result[1])
    local chunkKeys = result[2]

    for _, key in ipairs(chunkKeys) do
        table.insert(keys, key)
    end
until cursor == 0

if #keys > 0 then
    redis.call('UNLINK', unpack(keys))
end

return #keys
`;

class RedisExecutor {
  /**
   * @param {string} user
   * @returns {Promise<string>}
   */
  async getUid(user) {
    return await new Promise((resolve, reject) => {
      exec(`id -u ${user}`, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.toString().trim());
      });
    });
  }
  /**
   * @param {string} name
   */
  checkNameValid(name) {
    if (name.length > 256 || !/^[a-z][a-z0-9_]+$/.test(name)) {
      throw new Error(
        "Name only accept lowercase alphanumeric and underscore and less than 256 bytes long"
      );
    }
  }
  async getClient() {
    const client = createClient({
      url: process.env.REDIS_URL,
    });
    await client.connect();
    await client.ping();
    return client;
  }
  /**
   * @param {string} user
   */
  async show(user) {
    let uid = await this.getUid(user);
    let result = await spawnSudoUtil("REDIS_GETUSER", [uid]);
    return result.stdout
      .trim()
      .split("\n")
      .filter(x => x)
      .map((x) => x.substring(uid.length + 1));
  }
  /**
   * @param {string} user
   * @param {string} name
   * @param {{pass: string}} passRef
   */
  async add(user, name, passRef) {
    this.checkNameValid(name);
    let redCon = await this.getClient();
    const uid = await this.getUid(user);
    return await executeLock("redis", async () => {
      await spawnSudoUtil("REDIS_GET", []);
      var lines = cat(tmpFile).trim().split("\n");
      var line = lines.find((e) => {
        const parts = e.split(":");
        return parts.length >= 2 && parts[1] == name;
      });
      if (line) {
        let lineParts = line.split(":");
        if (lineParts[0] === uid) {
          passRef.pass = lineParts[2];
          return `Database ${name} is already created`;
        } else {
          throw new Error(
            "Error: This database is already exists and belongs to other domain"
          );
        }
      }
      const pass = await redCon.aclGenPass();
      lines.push([uid, name, pass].join(":"));
      await redCon.aclSetUser(name, aclSetUser(name, pass).split(" "));
      ShellString(lines.join("\n") + "\n").to(tmpFile);
      await spawnSudoUtil("REDIS_SET", []);
      await redCon.aclSave();
      passRef.pass = pass;
      return "Database " + name + " created";
    });
  }
  /**
   * @param {string} user
   * @param {string} name
   */
  async del(user, name) {
    this.checkNameValid(name);
    let redCon = await this.getClient();
    const uid = await this.getUid(user);
    return await executeLock("redis", async () => {
      await spawnSudoUtil("REDIS_GET", []);
      var lines = cat(tmpFile).trim().split("\n");
      var exists = lines.findIndex((e) => {
        const parts = e.split(":");
        if (parts.length < 2) {
          return;
        }
        return parts[0] == uid && parts[1] == name;
      });
      if (exists == -1) {
        throw new Error("Error: Database is not exists");
      }
      lines.splice(exists, 1);
      await redCon.aclDelUser(name);
      ShellString(lines.join("\n") + "\n").to(tmpFile);
      await spawnSudoUtil("REDIS_SET", []);
      await redCon.aclSave();
      return  "Database " + name + " dropped";
    });
  }

  /**
   * @param {string} name
   */
  async prune(name) {
    this.checkNameValid(name);
    let redCon = await this.getClient();
    let count = await redCon.eval(luaDelKeys, {
      keys: [`${name}:*`],
    });
    return `Database ${name} pruned with ${count} total keys`
  }

  /**
   *
   * @param {string} user
   * @param {string} name
   * @param {{pass: string}} passRef
   * @returns
   */
  async passwd(user, name, passRef) {
    this.checkNameValid(name);
    let redCon = await this.getClient();
    const uid = await this.getUid(user);
    return await executeLock("redis", async () => {
      await spawnSudoUtil("REDIS_GET", []);
      var lines = cat(tmpFile).trim().split("\n");
      var exists = lines.findIndex((e) => {
        const parts = e.split(":");
        if (parts.length != 2) {
          return;
        }
        return parts[0] == uid && parts[1] == name;
      });
      if (exists == -1) {
        throw new Error("Error: This database is not exists");
      }
      const lineSplit = lines[exists].split(":");
      const pass = await redCon.aclGenPass();
      lineSplit[2] = pass;
      ShellString(lines.join("\n") + "\n").to(tmpFile);
      await spawnSudoUtil("REDIS_SET", []);
      await redCon.aclSetUser(name, ["nopass", ">" + pass]);
      await redCon.aclSave();
      passRef.pass = pass;
      return "Done set new database password for key " + name;
    });
  }
}

export const redisExec = new RedisExecutor();
