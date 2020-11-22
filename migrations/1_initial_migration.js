const TokenMigrations = artifacts.require("./TokenMigrations.sol");

module.exports = function(deployer) {
  deployer.deploy(TokenMigrations);
};
