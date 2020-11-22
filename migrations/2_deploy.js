const ANADotBridge = artifacts.require("./ANADotBridge.sol");
const DotERC20 = artifacts.require("./DotERC20.sol");
const MockERC20Token = artifacts.require("./MockERC20Token.sol");
const ValidatorTransferableSet = artifacts.require("./ValidatorTransferableSet.sol");

module.exports = function(deployer) {
  deployer.deploy(Bridge, [], []);
};
