const packageJson = require('../../package.json');
const json = require('./swagger.json');
json.info.version = packageJson.version;
module.exports = json;
