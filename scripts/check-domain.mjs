import { keccak256, encodeAbiParameters, stringToBytes } from "viem";

const domainTypehash = keccak256(stringToBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
const nameHash = keccak256(stringToBytes("Disburse Markets"));
const versionHash = keccak256(stringToBytes("1"));
const chainId = 5042002n;
const exchange = "0xACC7D7441d869080EFf853E4edF6A836C49172Fb";

const domainSeparator = keccak256(encodeAbiParameters(
  [
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "uint256" },
    { type: "address" },
  ],
  [domainTypehash, nameHash, versionHash, chainId, exchange]
));
console.log("computed DOMAIN_SEPARATOR:", domainSeparator);
console.log("on-chain DOMAIN_SEPARATOR: 0xc2bc8480b86d29181c8d1d90e9a5d2f3aa286e2c9cab39887ccae1a4c3aa33d4");

// also ORDER_TYPEHASH
const orderTypehash = keccak256(stringToBytes("Order(address maker,address market,uint8 outcome,uint8 side,uint256 price,uint256 size,uint64 expiry,uint256 salt)"));
console.log("computed ORDER_TYPEHASH:", orderTypehash);
console.log("on-chain ORDER_TYPEHASH: 0x895b7d4bec4697b2797ab386d462270bf4ad466c09915986f3398d08701c8777");
