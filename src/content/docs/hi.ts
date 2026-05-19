import { ARC_CHAIN_ID, ARC_RPC_URL, ARC_RPC_ENDPOINTS, TOKENS } from "../../lib/arc";
import { PAYMENT_VALIDITY_MINUTES } from "../../lib/payments";
import { PRODUCTION_DOCS_HOSTNAME } from "../../lib/routing";
import type { DocsSection, DocsSummaryItem } from "./types";

export const docsSectionsHi: DocsSection[] = [
  {
    title: "प्रोजेक्ट का दायरा",
    body: [
      "Disburse Arc Testnet के लिए non-custodial भुगतान कंसोल है. यह दो कामों के लिए बनाया गया है: injected wallet से stablecoin transfer भेजना, और QR भुगतान अनुरोध बनाना जिसे दूसरा wallet खोलकर भुगतान कर सके.",
      "मौजूदा build जानबूझकर सीमित है. यह balance नहीं रखता, private key नहीं लेता, और custodial account नहीं चलाता. Browser अनुरोध तैयार करता है, wallet transaction sign करता है, और payment status Arc Testnet data से verify होता है."
    ],
    points: [
      "मुख्य app routes: /payments, /qr-payments, और /pay.",
      `Documentation ${PRODUCTION_DOCS_HOSTNAME} से serve होती है.`,
      "Supported actions: wallet connection, Arc Testnet switching, gas estimation, ERC-20 transfers, QR request creation, transfer verification, import/export, और invoice download.",
      "इस release के बाहर: custodial balances, Permit2, backend-enforced 402 flows, MPP rails, और server-side replay protection."
    ]
  },
  {
    title: "भुगतान flow",
    body: [
      "Disburse immediate transfers और request-based payments को अलग रखता है. Direct Payments तब उपयोग होते हैं जब sender recipient, token और amount पहले से जानता है. QR Payments तब उपयोग होते हैं जब requester किसी और से भुगतान लेने के लिए fixed request publish करना चाहता है.",
      "Scanned QR request payer page खोलता है जहां request details locked रहती हैं. Payer wallet connect कर सकता है, transfer estimate कर सकता है, transaction submit कर सकता है, result verify कर सकता है, और confirmation के बाद invoice download कर सकता है."
    ],
    points: [
      "Payments: sender recipient, token और amount भरता है, फिर wallet transfer sign करता है.",
      "QR Payments: requester recipient, token, amount, label, note और invoice date भरता है, फिर request URL को QR code के रूप में share करता है.",
      "Direct Payments local ledger में QR request records नहीं बनाते."
    ]
  },
  {
    title: "नेटवर्क और asset",
    body: [
      "App Arc Testnet पर pinned है. Native gas को 18 decimals वाले USDC की तरह दिखाया जाता है, जबकि supported ERC-20 payment amounts 6 decimals उपयोग करते हैं.",
      "RPC access एक छोटी failover list से संभाला जाता है. Interface active endpoint, latest block, safe gas price, chain id और token decimal checks दिखाता है ताकि user signing से पहले network path की health देख सके."
    ],
    points: [
      `Chain ID: ${ARC_CHAIN_ID}`,
      `RPC: ${new URL(ARC_RPC_URL).host}`,
      `Failover endpoints: ${ARC_RPC_ENDPOINTS.length}`,
      `USDC: ${TOKENS.USDC.address}`,
      `EURC: ${TOKENS.EURC.address}`
    ]
  },
  {
    title: "QR अनुरोध payload",
    body: [
      "QR code में /pay URL होता है जिसमें r query parameter पर base64url JSON payload रहता है. Payload सिर्फ portable request description है; इसमें private key, wallet approval, token balance या signed transaction कभी नहीं होता.",
      "Request token, amount, recipient, label, creation time और start block रिकॉर्ड करता है. Start block verification को उन transfers तक सीमित करता है जो request बनने के बाद हुए."
    ],
    points: [
      "Required fields: version, id, recipient, token, amount, label, createdAt, और startBlock.",
      "Optional fields: note, invoiceDate, expiresAt, और dueAt.",
      `Default expiry: creation के ${PAYMENT_VALIDITY_MINUTES} मिनट बाद. Expiry से पहले शुरू हुआ submitted payment attempt बाद में भी verify हो सकता है.`
    ],
    code: "/pay?r=<base64url({ version, id, recipient, token, amount, label, note?, invoiceDate?, expiresAt?, dueAt?, createdAt, startBlock })>"
  },
  {
    title: "Wallet execution",
    body: [
      "Payments connected wallet द्वारा signed standard ERC-20 transfer calls हैं. App viem से gas estimate करता है, Arc gas-price floor लागू करता है, wallet transaction hash submit होते ही save करता है, और confirmation का wait करता है.",
      "Signing की authority wallet के पास रहती है. Disburse calldata तैयार करता है और checks दिखाता है, लेकिन final approval wallet के अंदर होता है."
    ],
    points: [
      "Connect: eth_requestAccounts.",
      "Network: wallet_switchEthereumChain, Arc Testnet के लिए wallet_addEthereumChain fallback के साथ.",
      "Transfer: selected USDC या EURC contract पर ERC-20 transfer(recipient, parsedAmount) calldata के साथ eth_sendTransaction.",
      "Gas: estimates display और balance checks के लिए इस्तेमाल होते हैं; wallet signing के समय final transaction gas तय करता है."
    ]
  },
  {
    title: "Local ledger और realtime",
    body: [
      "QR requests और receipts browser localStorage में stored हैं ताकि requester account बनाए बिना काम manage कर सके. Ledger backup या migration के लिए JSON export और import support करता है.",
      "Supabase configured होने पर QR requests Vercel API functions के जरिए भी लिखे जा सकते हैं. Realtime events requester view में QR code को close कर सकते हैं जब payer request submit, confirm, fail या expire करता है."
    ],
    points: [
      "Storage keys: disburse.requests और disburse.receipts.",
      "Legacy keys अभी भी read होते हैं: arc-pay-desk.requests और arc-pay-desk.receipts.",
      "Requests request id से keyed होते हैं. Receipts request id या transaction hash से upsert होते हैं.",
      "Imported explorer URLs verified Arcscan transaction hash से regenerate होते हैं."
    ]
  },
  {
    title: "Invoice output",
    body: [
      "Payer confirmation और Arc Testnet data से transfer verification के बाद pay page local PDF invoice generate कर सकता है.",
      "Invoices browser में बनते हैं. इस build में app उन्हें upload नहीं करता और server email नहीं भेजता."
    ],
    points: [
      "Invoice में tx hash, block, amount, label, note, invoice date, payer, recipient, confirmation time और Arcscan link शामिल हैं.",
      "Invoice date display metadata है, payment expiry नहीं.",
      "इस build में कोई server invoice files store या email नहीं करता."
    ]
  },
  {
    title: "Verification",
    body: [
      "Verification पहले known transaction hash check करता है. अगर hash नहीं है, तो request start block से latest तक 10,000-block windows में ERC-20 Transfer logs scan करता है और recipient plus exact token amount compare करता है.",
      "Request सिर्फ तब paid mark होती है जब token contract, recipient और amount match करते हैं. सही recipient को अलग amount वाले transfers अलग दिखाए जाते हैं ताकि user review कर सके."
    ],
    points: [
      "Paid: requested token amount के लिए recipient को exact transfer.",
      "Possible match: recipient को transfer मिला, लेकिन amount अलग है.",
      "Open: request start block से कोई matching transfer नहीं मिला."
    ],
    code: "match = log.address == token && log.args.to == recipient && log.args.value == parseUnits(amount, token.decimals)"
  }
];

export const docsSummaryItemsHi: DocsSummaryItem[] = [
  {
    label: "नेटवर्क",
    value: `Arc Testnet ${ARC_CHAIN_ID}`
  },
  {
    label: "एसेट",
    value: "USDC और EURC"
  },
  {
    label: "कस्टडी",
    value: "वॉलेट-signed, non-custodial"
  },
  {
    label: "रसीदें",
    value: "Arc Testnet logs से verified"
  }
];
