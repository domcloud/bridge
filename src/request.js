import http from "node:http";
import https from "node:https";
/**
 * @template T
 * @typedef {{data: T, headers: import('http').IncomingHttpHeaders, statusCode: number}} Response
 */

/**
 * @template T
 * @param {string | URL} url
 * @param {import('https').RequestOptions & {data?: string, followRedirects?: boolean}} [options]
 * @return {Promise<Response<T>>}
 */
const request = (url, { data = '', followRedirects = false, ...options } = {}) => {
    return new Promise((resolve, reject) => {
        try {
            url = new URL(url);
        }
        catch (err) {
            return reject(err);
        }
        (url.protocol == 'https:' ? https : http).request(url, options, res => {
            const { statusCode, headers } = res;
            /**
             * @type {any}
             */
            let data = '';
            res
                .on('data', chunk => {
                    data += chunk;
                })
                .once('end', () => {
                    if (headers['content-type']?.includes('application/json')) {
                        try {
                            data = JSON.parse(data);
                        }
                        catch (err) {
                            reject(err);
                            return;
                        }
                    }
                    if (timeoutHandler) {
                        clearTimeout(timeoutHandler);
                    }
                    if (statusCode >= 300 && statusCode < 400 && followRedirects) {
                        request(headers['location'], {
                            data, followRedirects, ...options,
                        }).then(resolve).catch(reject)
                    } else {
                        resolve({ data, headers, statusCode: statusCode || 0 });
                    }
                })
                .once('error', reject);
        })
            .once('error', reject)
            .end(data);
        let timeoutHandler = setTimeout(() => {
            const method = options.method || 'GET';
            reject(new Error(`${method} request to "${url}" timed out`));
        }, 10e3);
        timeoutHandler.unref();
    });
};
export default request;
