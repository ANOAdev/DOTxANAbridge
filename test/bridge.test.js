'use strict';

const utils = require('./utils.js');
const web3 = global.web3;
const DotERC20 = artifacts.require("./../contracts/DotERC20.sol");
const ANADotBridge = artifacts.require("./../contracts/ANADotBridge.sol");
const MockERC20Token = artifacts.require("./../contracts/MockERC20Token.sol");
const createKeccakHash = require('keccak');
const ethUtils = require('ethereumjs-util');
const BigNumber = require('bignumber.js');

contract('Bridge', function(accounts) {
  const args = {
    _default: accounts[0],
    _account_one: accounts[1],
    _account_two: accounts[2],
    _address0: "0x0000000000000000000000000000000000000000"
  };

  let validators, standardTokenMock;
  let _account_one = args._account_one;
  let _account_two = args._account_two;
  let _address0 = args._address0;


  before('Setup Validators', async function() {
    validators = utils.createValidators(20);
  });

  describe('Bridge(address[],uint64[]', function () {
    let res, bridge;

    before ('Sets up Bridge contract', async function () {
      bridge = await Bridge.new(validators.addresses, validators.powers, {from: args._default});
    });

    it ('Correctly verifies ValSet signatures', async function () {
      let hashData = String(await bridge.hashValidatorArrays.call(validators.addresses, validators.powers));
      let signatures = await utils.createSigns(validators, hashData);

      res = await bridge.verifyValidators.call(hashData, signatures.signers, signatures.vArray, signatures.rArray, signatures.sArray);
      assert.isTrue(res, "Should have successfully verified signatures");
    });
  });

  describe('newDotERC20(string,uint,uint[],uint8[],bytes32[],bytes32[]', function () {
    let res, bridge, polkadotTokenAddress, polkadotToken;

    before ('Creates new Polkadot ERC20 token', async function () {
      bridge = await Bridge.new(validators.addresses, validators.powers, {from: args._default});

      let hashData = String(await bridge.hashNewDotERC20.call('PolkadotToken', 18));
      let signatures = await utils.createSigns(validators, hashData);

      polkadotTokenAddress = await bridge.newDotERC20.call('PolkadotToken', 18, signatures.signers, signatures.vArray, signatures.rArray, signatures.sArray);
      res = await bridge.newDotERC20('PolkadotToken', 18, signatures.signers, signatures.vArray, signatures.rArray, signatures.sArray);
      polkadotToken = await DotERC20.at(polkadotTokenAddress);
    });

    it('Adds new token to polkadotToken mapping', async function () {
      assert.equal(await bridge.getPolkadotTokenAddress('PolkadotToken'), polkadotTokenAddress);
    });

    it('Adds address to polkadotTokensAddresses set', async function () {
      assert.isTrue(await bridge.isPolkadotTokenAddress(polkadotTokenAddress));
    });

    it('Emits NewDotERC20 event', async function () {
      assert.strictEqual(res.logs.length, 1);
      assert.strictEqual(res.logs[0].event, "NewDotERC20", "Successful execution should have logged the NewDotERC20 event");
      assert.strictEqual(res.logs[0].args.name, 'PolkadotToken');
      assert.strictEqual(res.logs[0].args.tokenAddress, polkadotTokenAddress);
    });

    it('Is controller of new DotERC20', async function () {
      assert.equal(await polkadotToken.controller.call(), bridge.address);
    });

    it('Fails if same name is resubmitted', async function () {
      let hashData = String(await bridge.hashNewDotERC20.call('PolkadotToken', 10));
      let signatures = await utils.createSigns(validators, hashData);

      await utils.expectRevert(bridge.newDotERC20('PolkadotToken', 10, signatures.signers, signatures.vArray, signatures.rArray, signatures.sArray));
    });
  });

  describe('lock(bytes,address,uint64)', function () {
    let res, bridge, polkadotTokenAddress, standardTokenMock;

    beforeEach('Sets up Bridge contract', async function () {
      bridge = await Bridge.new(validators.addresses, validators.powers, {from: args._default});
    });

    it('Receives Normal ERC20 and emits Lock event', async function () {
      let standardTokenMock = await MockERC20Token.new(_account_one, 10000, {from: args._default});
      await standardTokenMock.approve(bridge.address, 1000, {from: args._account_one});
      let res = await bridge.lock("0xdeadbeef", standardTokenMock.address, 1000, {from: args._account_one});

      assert.strictEqual((await standardTokenMock.balanceOf(bridge.address)).toNumber(), 1000);
      assert.strictEqual(res.logs.length, 1);
      assert.strictEqual(res.logs[0].event, "Lock");
      assert.strictEqual(String(res.logs[0].args.to), '0xdeadbeef');
      assert.strictEqual(res.logs[0].args.token, standardTokenMock.address);
      assert.strictEqual(res.logs[0].args.value.toNumber(), 1000);
    });

    it('Burns DotERC20 and emits Lock event', async function () {
      let hashData = String(await bridge.hashNewDotERC20.call('PolkadotToken', 18));
      let signatures = await utils.createSigns(validators, hashData);
      let polkadotTokenAddress = await bridge.newDotERC20.call('PolkadotToken', 18, signatures.signers, signatures.vArray, signatures.rArray, signatures.sArray);
      await bridge.newDotERC20('PolkadotToken', 18, signatures.signers, signatures.vArray, signatures.rArray, signatures.sArray);
      let polkadotToken = await DotERC20.at(polkadotTokenAddress);
      hashData = await bridge.hashUnlock(_account_one, polkadotTokenAddress, 1000);
      signatures = await utils.createSigns(validators, hashData);
      await bridge.unlock(_account_one, polkadotTokenAddress, 1000, signatures.signers, signatures.vArray, signatures.rArray, signatures.sArray);

      let res = await bridge.lock("0xdeadbeef", polkadotTokenAddress, 500, {from: args._account_one});

      {
        assert.notInstanceOf(polkadotToken, Promise);
        assert.isFunction(polkadotToken.balanceOf);
        const balance = await polkadotToken.balanceOf(_account_one);
        assert.notInstanceOf(balance, Promise);
        assert.strictEqual(balance.toNumber(), 500);
      }
      assert.strictEqual(res.logs.length, 1);
      assert.strictEqual(res.logs[0].event, "Lock");
      assert.strictEqual(String(res.logs[0].args.to), '0xdeadbeef');
      assert.strictEqual(res.logs[0].args.token, polkadotTokenAddress);
      assert.strictEqual(res.logs[0].args.value.toNumber(), 500);
    });

    it('Sends Ether when token is 0 address and emits Lock event', async function () {

      let res = await bridge.lock("0xdeadbeef", _address0, 1000, {from: args._account_one, value: 1000});

      let ethBalance = await web3.eth.getBalance(bridge.address);

      assert.strictEqual(ethBalance, '1000');
      assert.strictEqual(res.logs.length, 1);
      assert.strictEqual(res.logs[0].event, "Lock");
      assert.strictEqual(String(res.logs[0].args.to), '0xdeadbeef');
      assert.strictEqual(res.logs[0].args.token, _address0);
      assert.strictEqual(res.logs[0].args.value.toNumber(), 1000);
    });
  });

  describe('unlock(address,address,uint64,uint[],uint8[],bytes32[],bytes32[])', function () {
    let bridge, res;

    beforeEach('Sets up Bridge contract', async function () {
      bridge = await Bridge.new(validators.addresses, validators.powers, {from: args._default});
    });

    it('Sends Normal ERC20 and emits Unlock event', async function () {
      let standardTokenMock = await MockERC20Token.new(bridge.address, 10000, {from: args._default});
      let hashData = await bridge.hashUnlock(_account_one, standardTokenMock.address, 1000);
      let signatures = await utils.createSigns(validators, hashData);

      res = await bridge.unlock(args._account_one, standardTokenMock.address, 1000, signatures.signers, signatures.vArray, signatures.rArray, signatures.sArray);
      assert.strictEqual((await standardTokenMock.balanceOf(_account_one)).toNumber(), 1000);

      assert.strictEqual(res.logs.length, 1);
      assert.strictEqual(res.logs[0].event, "Unlock");
      assert.strictEqual(String(res.logs[0].args.to), args._account_one);
      assert.strictEqual(res.logs[0].args.token, standardTokenMock.address);
      assert.strictEqual(res.logs[0].args.value.toNumber(), 1000);
    });

    it('Mints polkadot ERC20 and emits Unlock event', async function () {

      let hashData = String(await bridge.hashNewDotERC20.call('PolkadotToken', 18));
      let signatures = await utils.createSigns(validators, hashData);
      let polkadotTokenAddress = await bridge.newDotERC20.call('PolkadotToken', 18, signatures.signers, signatures.vArray, signatures.rArray, signatures.sArray);
      await bridge.newDotERC20('PolkadotToken', 18, signatures.signers, signatures.vArray, signatures.rArray, signatures.sArray);
      let polkadotToken = await DotERC20.at(polkadotTokenAddress);

      hashData = await bridge.hashUnlock(_account_one, polkadotTokenAddress, 1000);
      signatures = await utils.createSigns(validators, hashData);

      res = await bridge.unlock(_account_one, polkadotTokenAddress, 1000, signatures.signers, signatures.vArray, signatures.rArray, signatures.sArray);
      assert.strictEqual((await polkadotToken.balanceOf(_account_one)).toNumber(), 1000);

      assert.strictEqual(res.logs.length, 1);
      assert.strictEqual(res.logs[0].event, "Unlock");
      assert.strictEqual(String(res.logs[0].args.to), args._account_one);
      assert.strictEqual(res.logs[0].args.token, polkadotTokenAddress);
      assert.strictEqual(res.logs[0].args.value.toNumber(), 1000);
    });

    it('Sends Ether when token is address 0x0 and emits Unlock event', async function () {
      // fund the Bridge contract with a little bit of ether
      await bridge.lock("0xdeadbeef", _address0, 5000, {from: args._account_two, value: 5000});
      const oldBalance = await web3.eth.getBalance(_account_one);
      assert.isString(oldBalance);
      const hashData = await bridge.hashUnlock(_account_one, _address0, 1000);
      const signatures = await utils.createSigns(validators, hashData);
      res = await bridge.unlock(args._account_one, args._address0, 1000, signatures.signers, signatures.vArray, signatures.rArray, signatures.sArray);
      const newBalance = await web3.eth.getBalance(_account_one);
      assert.isString(newBalance);
      assert.strictEqual(BigNumber(newBalance).minus(oldBalance).toString(), '1000');
      assert.strictEqual(res.logs.length, 1);
      assert.strictEqual(res.logs[0].event, "Unlock");
      assert.strictEqual(String(res.logs[0].args.to), args._account_one);
      assert.strictEqual(res.logs[0].args.token, args._address0);
      assert.strictEqual(res.logs[0].args.value.toNumber(), 1000);
    });
  });
});
