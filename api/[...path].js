const { handleRequest } = require("../server");

module.exports = async function ticketAppApi(req, res) {
  await handleRequest(req, res);
};

module.exports.default = module.exports;
