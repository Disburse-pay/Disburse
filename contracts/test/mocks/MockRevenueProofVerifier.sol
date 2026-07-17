// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRevenueProofVerifier} from "../../src/credit/IRevenueProofVerifier.sol";

/**
 * Test stand-in for the bb-generated Solidity verifier. Returns a settable
 * result so CreditController's integration can be tested before the real
 * circuit/verifier exists. The real verifier implements the same interface and
 * drops in via CreditController.setVerifier.
 */
contract MockRevenueProofVerifier is IRevenueProofVerifier {
    bool public result = true;

    function setResult(bool r) external {
        result = r;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return result;
    }
}
