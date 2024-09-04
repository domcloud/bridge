import fs from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import request from "../request.js";
const __dirname = dirname(fileURLToPath(import.meta.url));

const pythonConstants = {
  // https://raw.githubusercontent.com/indygreg/python-build-standalone/latest-release/latest-release.json
  tag: "20240107",
  // NOTE: x86_64_v3 requires AVX2 CPU support
  match: {
    x64: /cpython-(\d+\.\d+\.\d+)\+\d+-x86_64_v3-unknown-linux-gnu-pgo\+lto-full\.tar\.zst/g,
    arm64:
      /cpython-(\d+\.\d+\.\d+)\+\d+-aarch64-unknown-linux-gnu-lto-full\.tar\.zst/g,
  },
  index() {
    return `https://github.com/indygreg/python-build-standalone/releases/expanded_assets/${this.tag}`;
  },
  latestTagUrl() {
    return "https://raw.githubusercontent.com/indygreg/python-build-standalone/latest-release/latest-release.json";
  },
  /**
   * @param {string} filename
   */
  asset_url(filename) {
    return `https://github.com/indygreg/python-build-standalone/releases/download/${this.tag}/${filename}`;
  },
};
export const initUtils = async () => {
  // TODO: detect OS/arch?

  const result = {};

  for (const arch of ["x64", "arm64"]) {
    const archLinux = {
      x64: "x64",
      arm64: "aarch64",
    };
    // https://packagist.org/php-statistics
    let rubyVersionsList = [];
    let pythonVersionsList = [];
    let javaVersionsList = [];
    /**
     * @type {Record<string, string>}
     */
    let pythonVersionsMap = {};
    /**
     * @type {Record<string, string>}
     */
    let javaVersionsMap = {};
    await request("https://rvm_io.global.ssl.fastly.net/binaries/centos/9/x86_64/")  // currently aarch64 have to rebuilt
      .then((res) => {
        // @ts-ignore
        var matches = [
          ...("" + res.data).matchAll(/href="ruby-([.\d]+).tar.bz2"/g),
        ];
        for (const match of matches) {
          if (!rubyVersionsList.includes(match[1])) {
            rubyVersionsList.push(match[1]);
          }
        }
        rubyVersionsList = sortSemver(rubyVersionsList).reverse();
      })
      .catch((err) => {
        console.error("error fetching Ruby releases", err.message);
      });

    await request(pythonConstants.latestTagUrl()).then((res) => {
      res.data = JSON.parse(res.data)
      if (res.data && res.data.tag) {
        pythonConstants.tag = res.data.tag;
      } else {
        console.warn("unable get latest python tag");
      }
    });
    await request(pythonConstants.index(), {
      headers: {
        'user-agent': 'curl/7.81.0',
        'Host': 'github.com',
        'accept': '*/*',
      }
    })
      .then((res) => {
        // @ts-ignore
        var matches = [
          ...("" + res.data).matchAll(pythonConstants.match[arch]),
        ];
        for (const match of matches) {
          if (!pythonVersionsMap[match[1]]) {
            pythonVersionsMap[match[1]] = pythonConstants.asset_url(match[0]);
            pythonVersionsList.push(match[1]);
          }
        }
        pythonVersionsList = sortSemver(pythonVersionsList).reverse();
      })
      .catch((err) => {
        console.error("error fetching Python releases", err.message);
      });
    await request("https://api.adoptium.net/v3/info/available_releases")
      .then(async (res) => {
        for (const ver of res.data.available_releases) {
          await request(
              `https://api.adoptium.net/v3/assets/latest/${ver}/hotspot?architecture=${archLinux[arch]}&image_type=jdk&os=linux&vendor=eclipse`
            )
            .then((x) => {
              for (const binary of x.data) {
                javaVersionsMap[binary.version.semver] =
                  binary.binary.package.link;
              }
            });
        }
        javaVersionsList = sortSemver(Object.keys(javaVersionsMap)).reverse();
      });

    result[arch] = {
      rubyVersionsList,
      pythonVersionsList,
      javaVersionsList,
      pythonVersionsMap,
      javaVersionsMap,
    };
  }

  fs.writeFileSync(
    __dirname + "/metadata.json",
    JSON.stringify(result, null, 2)
  );
};

// https://stackoverflow.com/a/40201629/3908409
/**
 * @param {string[]} arr
 */
export function sortSemver(arr) {
  return arr
    .map((a) => a.replace(/\d+/g, (n) => +n + 100000 + ""))
    .sort()
    .map((a) => a.replace(/\d+/g, (n) => +n - 100000 + ""));
}

initUtils().then(() => console.log("metadata written"));
