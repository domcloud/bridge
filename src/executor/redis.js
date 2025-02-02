import { cat, executeLock, spawnSudoUtil } from "../util.js";
import path from "path";
import { createClient } from "@redis/client";
import { exec } from "child_process";
import { ShellString } from "shelljs";

const tmpFile = path.join(process.cwd(), "/.tmp/redis-acl");

const aclSetUser = (user, pass) =>
  `>${pass} ~${user}:* &${user}: sanitize-payload ` +
  `-@all +@connection +@read +@write +@keyspace -KEYS ` +
  `+@transaction +@geo +@hash +@set +@sortedset +@bitmap +@pubsub`;

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
  getClient() {
    return createClient({
      url: process.env.REDIS_URL,
    });
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
   */
  async add(user, name) {
    let redCon = this.getClient();
    await redCon.ping();
    const uid = await this.getUid(user);
    return await executeLock("redis", async () => {
      await spawnSudoUtil("REDIS_GET", []);
      var lines = cat(tmpFile).trim().split("\n");
      var existsUserSame = false;
      var exists = lines.some((e) => {
        const parts = e.split(":");
        if (parts.length != 2) {
          return;
        }
        if (parts[1] == name) {
          existsUserSame = parts[0] == uid;
          return true;
        }
        return false;
      });
      if (exists) {
        if (existsUserSame) {
          return "This account is already exists on this domain";
        } else {
          throw new Error(
            "Error: This account is already exists and belongs to other domain"
          );
        }
      }
      lines.push(uid + ":" + name);
      const pass = await redCon.aclGenPass();
      await redCon.aclSetUser(name, aclSetUser(name, pass).split(" "));
      ShellString(lines.join("\n") + "\n").to(tmpFile);
      await spawnSudoUtil("REDIS_SET", []);
      return "Done created account " + name + ", password is:\n" + pass;
    });
  }
  /**
   * @param {string} user
   * @param {string} name
   */
  async del(user, name) {
    let redCon = this.getClient();
    await redCon.ping();
    const uid = await this.getUid(user);
    const res = await executeLock("redis", async () => {
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
        throw new Error("Error: This user and key is not exists");
      }
      lines.splice(exists, 1);
      await redCon.aclDelUser(name);
      ShellString(lines.join("\n") + "\n").to(tmpFile);
      await spawnSudoUtil("REDIS_SET", []);
      return "Done delete account " + name;
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
   * @param {string} newpasswd
   * @returns
   */
  async passwd(user, name, newpasswd) {
    let redCon = this.getClient();
    await redCon.ping();
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
        throw new Error("Error: This user and key is not exists");
      }
      await redCon.aclSetUser(name, [">" + newpasswd]);
      return "Done set account password " + name;
    });
  }
}

export const redisExec = new RedisExecutor();
