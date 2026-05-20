import { getContractAddress } from "viem";

const DEPLOYER = "0xDFfac1E2149B547DC71C081ea32b78595e6153A4";

// Per scripts/deploy-markets.mjs order: OutcomeToken (n), AdminResolver (n+1),
// Exchange (n+2), MarketFactory (n+3). Factory nonce = 11.
const FACTORY_NONCE = 11n;

const outcomeToken = getContractAddress({ from: DEPLOYER, nonce: FACTORY_NONCE - 3n });
const adminResolver = getContractAddress({ from: DEPLOYER, nonce: FACTORY_NONCE - 2n });
const exchange = getContractAddress({ from: DEPLOYER, nonce: FACTORY_NONCE - 1n });
const factory = getContractAddress({ from: DEPLOYER, nonce: FACTORY_NONCE });

console.log("predicted OutcomeToken: ", outcomeToken, "  (expected 0x9c48BD5eCee82AB078534EfAa0c11F00b3f7e204)");
console.log("predicted AdminResolver:", adminResolver);
console.log("predicted Exchange:     ", exchange);
console.log("predicted Factory:      ", factory, "  (expected 0xa899FB4F1533496D76670703a5b2fa3437420F5A)");
