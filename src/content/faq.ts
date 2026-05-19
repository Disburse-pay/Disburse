export const faqItems = [
  {
    question: "What is the difference between Payments and QR Payments?",
    answer:
      "Payments is for a wallet owner sending funds to another address. QR Payments is for creating a fixed request that another wallet scans and pays."
  },
  {
    question: "Does this app custody funds?",
    answer:
      "The app never receives private keys. Arc-native payments go wallet-to-recipient; cross-chain testnet routes use a source escrow contract plus prefunded Arc settlement liquidity."
  },
  {
    question: "Which network does Disburse use?",
    answer:
      "Disburse is configured for Arc Testnet, chain ID 5042002, using Arc RPC failover and Arcscan for transaction review."
  },
  {
    question: "What is stored in the browser?",
    answer:
      "QR requests and verified receipts are stored in localStorage. Direct Payments only keep their latest transaction hash in the current browser session."
  },
  {
    question: "What is a Portable Settlement Proof?",
    answer:
      "A PSP is a signed JSON receipt for a settled Arc Testnet payment. It can be fetched by UID or request id and verified with the API, CLI, or on-chain verifier."
  }
];
