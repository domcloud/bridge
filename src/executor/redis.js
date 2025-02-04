import { cat, executeLock, spawnSudoUtil } from "../util.js";
import path from "path";
import { createClient } from "@redis/client";
import { exec } from "child_process";
import { ShellString } from "shelljs";

const tmpFile = path.join(process.cwd(), "/.tmp/redis-acl");

const aclSetUser = (user, pass) =>
  `on >${pass} ~${user}:* &${user}: sanitize-payload ` +
  `-@all +@connection +@read +@write +@keyspace -KEYS ` +
  `+@transaction +@geo +@hash +@set +@sortedset +@bitmap +@pubsub ` +
  `+config|get +info +acl|whoami +acl|cat +acl|genpass`;

const luaDelKeys = `
      local keys = redis.call('KEYS', KEYS[1])
      for _, key in ipairs(keys) do
          redis.call('DEL', key)
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
      return "Done database account for key " + name;
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
    const res = await executeLock("redis", async () => {
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
      return "Done delete database " + name;
    });

    await redCon.eval(luaDelKeys, {
      keys: [`${user}:*`],
    });

    return res;
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
