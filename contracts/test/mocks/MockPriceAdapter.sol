// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Stand-in for PythPriceAdapter. Returns a settable 1e18-scaled USD price per
 * 1 unit of the collateral asset, letting tests move the price to drive a
 * borrower in and out of liquidation without wiring up a mock Pyth feed.
 */
contract MockPriceAdapter {
    uint256 public price;

    constructor(uint256 _price) {
        price = _price;
    }

    function setPrice(uint256 _price) external {
        price = _price;
    }

    function getPrice() external view returns (uint256) {
        return price;
    }
}
