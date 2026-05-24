// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * AUsdc — minimal ERC20 share token for USDC suppliers in the LendingPool.
 *
 * Non-rebasing (Compound cToken style):
 *   - balanceOf returns SHARES, not USDC.
 *   - 1 share ↔ X USDC where X = LendingPool.supplyIndex / 1e18 (X grows
 *     monotonically with accrued interest).
 *   - Use LendingPool.balanceOfUnderlying(user) to get the USDC value of a
 *     user's holdings. The UI should display that, not balanceOf.
 *
 * Mint / burn are pool-only. Transfer / approve / transferFrom are open
 * standard ERC20 so users can move their position around (e.g. send shares
 * to a multisig).
 *
 * Decimals: 6 to match USDC. This matters for wallet displays — although
 * 1 aUSDC ≠ 1 USDC by value, having matching decimals makes integer counts
 * line up exactly at issuance (1 USDC deposited = 1 aUSDC minted, scaled
 * up over time only via the underlying conversion).
 */
contract AUsdc {
    // ───── ERC20 metadata ─────
    string public constant name = "Disburse Lending - Supplied USDC";
    string public constant symbol = "aUSDC";
    uint8 public constant decimals = 6;

    // ───── ERC20 state ─────
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ───── Pool binding ─────
    /// Only the pool can mint or burn. Set to deployer (the LendingPool
    /// contract address) at construction; immutable thereafter.
    address public immutable pool;

    // ───── Events ─────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        // The deploying contract becomes pool. LendingPool deploys this in
        // its own constructor, so msg.sender there is the pool itself.
        pool = msg.sender;
    }

    modifier onlyPool() {
        require(msg.sender == pool, "aUSDC: not pool");
        _;
    }

    // ───── Pool-only mint / burn ─────

    function mint(address to, uint256 amount) external onlyPool {
        require(to != address(0), "aUSDC: mint to zero");
        totalSupply += amount;
        unchecked {
            // Cannot overflow since totalSupply tracks it.
            balanceOf[to] += amount;
        }
        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external onlyPool {
        uint256 bal = balanceOf[from];
        require(bal >= amount, "aUSDC: insufficient balance");
        unchecked {
            balanceOf[from] = bal - amount;
            totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    // ───── ERC20 transfers ─────

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 current = allowance[from][msg.sender];
        if (current != type(uint256).max) {
            require(current >= amount, "aUSDC: insufficient allowance");
            unchecked {
                allowance[from][msg.sender] = current - amount;
            }
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        require(to != address(0), "aUSDC: transfer to zero");
        uint256 bal = balanceOf[from];
        require(bal >= amount, "aUSDC: insufficient balance");
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
        return true;
    }
}
