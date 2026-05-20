import { recoverTypedDataAddress, verifyTypedData } from "viem";

const order = {
  maker: "0xB34320441203505B78B04b89Fe39Bc87256Bb09E",
  market: "0x8F84A5a63667013e53ae37c885B57D77c77B25Af",
  outcome: 0,
  side: 1,
  price: 520000n,
  size: 1000000n,
  expiry: 1779296254n,
  salt: 99234746762849811675693178006273724518500959075930552079535071940934314193063n,
};
const signature = "0x0c39a9d8841915d55d851553069b38e59d98a4fd1f6915672763d63585a038330193c0f2e8ee6b8bfa56c30b237334a2c04ac13b4b601f82f834ed26ad48c6851c";

const types = {
  Order: [
    { name: "maker", type: "address" },
    { name: "market", type: "address" },
    { name: "outcome", type: "uint8" },
    { name: "side", type: "uint8" },
    { name: "price", type: "uint256" },
    { name: "size", type: "uint256" },
    { name: "expiry", type: "uint64" },
    { name: "salt", type: "uint256" },
  ],
};
const domain = {
  name: "Disburse Markets",
  version: "1",
  chainId: 5042002,
  verifyingContract: "0xACC7D7441d869080EFf853E4edF6A836C49172Fb",
};

const recovered = await recoverTypedDataAddress({
  domain,
  types,
  primaryType: "Order",
  message: order,
  signature,
});
console.log("recovered:", recovered);
console.log("expected: ", order.maker);
console.log("match:    ", recovered.toLowerCase() === order.maker.toLowerCase());

const ok = await verifyTypedData({
  address: order.maker,
  domain,
  types,
  primaryType: "Order",
  message: order,
  signature,
});
console.log("verify:   ", ok);
