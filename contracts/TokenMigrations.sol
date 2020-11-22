pragma solidity ^0.4.23;

contract TokenMigrations {
  address public owner;
  uint public last_completed_migration_value;

  constructor() public {
    owner = msg.sender;
  }

  modifier restricted() {
    if (msg.sender == owner) _;
  }

  function setCompleted(uint completed) public restricted {
    last_completed_migration = completed;
  }

  function upgrade(address new_address) public restricted {
    TokenMigrations upgraded = TokenMigrations(new_address);
    upgraded.setCompleted(last_completed_migration_value);
  }
}
