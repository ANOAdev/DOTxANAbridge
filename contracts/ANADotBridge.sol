pragma solidity ^0.4.24;

import "./DotERC20.sol";
import "./ValidatorTransferableSet.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

contract ANADotBridge is ValidatorSet {

    mapping (string => address) polkadotTokens;
    mapping (address => bool) polkadotTokenAddresses;

    event NewPolkadotERC20(string name, address tokenAddress);
    event Lock(bytes to, address token, uint64 value);
    event Unlock(address to, address token, uint64 value);

    constructor(address[] memory initAddress, uint64[] memory initPowers)
        public
        ValidatorSet(initAddress, initPowers) {
    }

    function hashNewPolkadotERC20(string memory name, uint decimals) public pure returns (bytes32 hash) {
      return keccak256(abi.encodePacked(name, decimals));
    }

    function hashUnlock(address to, address token, uint64 amount) public pure returns (bytes32 hash) {
      return keccak256(abi.encodePacked(to, token, amount));
    }

    function getPolkadotTokenAddress(string memory name) public view returns (address addr) {
      return polkadotTokens[name];
    }

    function isPolkadotTokenAddress(address addr) public view returns (bool isCosmosAddr) {
      return polkadotTokenAddresses[addr];
    }

    /**
     * @dev             Locks received funds to the consensus of the peg zone
     * @param to        bytes representation of destination address
     * @param amount    value of transference
     * @param tokenAddr token address in origin chain
     */
    function lock(bytes memory to, address tokenAddr, uint64 amount) public payable returns (bool) {
        if (msg.value != 0) {
          require(tokenAddr == address(0), "Error: Can only send currency to the zero token");
          require(msg.value == amount, "Error: Invalid lock amount");
        } else if (polkadotTokenAddresses[tokenAddr]) {
          PolkadotERC20(tokenAddr).burn(msg.sender, amount);
        } else {
          require(ERC20(tokenAddr).transferFrom(msg.sender, address(this), amount), "Transfer failed");
        }
        emit Lock(to, tokenAddr, amount);
        return true;
    }

    // Unlocks Polkadot <-> ERC20 tokens according to the information from the pegzone. Called by the relayers
    /**
     * @param to          bytes representation of destination address
     * @param amount      value of transference
     * @param token       token address in origin chain
     * @ param chain      bytes respresentation of the destination chain (not used in MVP, for incentivization of relayers)
     * @param signers     indexes of each validator
     * @param v           array of recoverys id
     * @param r           array of outputs of ECDSA signature
     * @param s           array of outputs of ECDSA signature
     */
    function unlock(address to, address token, uint64 amount, uint[] signers, uint8[] v, bytes32[] r, bytes32[] s) external returns (bool) {
        bytes32 hashData = keccak256(abi.encodePacked(to, token, amount));
        require(ValidatorSet.verifyValidators(hashData, signers, v, r, s), "Error: Validator verification failed");
        if (token == address(0)) {
          to.transfer(amount);
        } else if (polkadotTokenAddresses[token]) {
          PolkadotERC20(token).mint(to, amount);
        } else {
          require(ERC20(token).transfer(to, amount), "Error: ERC token transfer failed");
        }
        emit Unlock(to, token, amount);
        return true;
    }

    function newPolkadotERC20(string name, uint decimals, uint[] signers, uint8[] v, bytes32[] r, bytes32[] s) external returns (address addr) {
        require(polkadotTokens[name] == address(0), "Error: Polkadot ERC20 token already exists");

        bytes32 hashData = keccak256(abi.encodePacked(name, decimals));
        require(ValidatorSet.verifyValidators(hashData, signers, v, r, s), "Error: Validator verification failed");

        PolkadotERC20 newToken = new PolkadotERC20();

        polkadotTokens[name] = newToken;
        polkadotTokenAddresses[newToken] = true;

        emit NewPolkadotERC20(name, newToken);
        return newToken;
    }
}
