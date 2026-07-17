// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RevenueRegistry} from "../src/credit/RevenueRegistry.sol";

contract RevenueRegistryTest is Test {
    RevenueRegistry internal registry;
    address internal issuer = address(0x155E);
    address internal stranger = address(0xDEAD);
    bytes32 internal root = keccak256("root-1");

    function setUp() public {
        registry = new RevenueRegistry(issuer);
    }

    function test_PostRoot_OnlyIssuer() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("Registry: not issuer"));
        registry.postRoot(root);
    }

    function test_PostRoot_RecordsAndIsKnown() public {
        assertFalse(registry.isKnownRoot(root));
        vm.prank(issuer);
        registry.postRoot(root);
        assertTrue(registry.isKnownRoot(root));
        assertGt(registry.rootPostedAt(root), 0);
    }

    function test_PostRoot_RevertOnDuplicate() public {
        vm.startPrank(issuer);
        registry.postRoot(root);
        vm.expectRevert(bytes("Registry: root exists"));
        registry.postRoot(root);
        vm.stopPrank();
    }

    function test_PostRoot_RevertOnZeroRoot() public {
        vm.prank(issuer);
        vm.expectRevert(bytes("Registry: zero root"));
        registry.postRoot(bytes32(0));
    }

    function test_RevokeRoot_OnlyOwnerAndClears() public {
        vm.prank(issuer);
        registry.postRoot(root);

        vm.prank(stranger);
        vm.expectRevert(bytes("Registry: not owner"));
        registry.revokeRoot(root);

        registry.revokeRoot(root); // owner = test contract
        assertFalse(registry.isKnownRoot(root));
    }

    function test_SetIssuer_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("Registry: not owner"));
        registry.setIssuer(stranger);

        registry.setIssuer(stranger);
        assertEq(registry.issuer(), stranger);
    }
}
