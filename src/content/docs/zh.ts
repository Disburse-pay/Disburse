import { ARC_CHAIN_ID, ARC_RPC_URL, ARC_RPC_ENDPOINTS, TOKENS } from "../../lib/arc";
import { PAYMENT_VALIDITY_MINUTES } from "../../lib/payments";
import { PRODUCTION_DOCS_HOSTNAME } from "../../lib/routing";
import type { DocsSection, DocsSummaryItem } from "./types";

export const docsSectionsZh: DocsSection[] = [
  {
    title: "项目范围",
    body: [
      "Disburse 是 Arc Testnet 的非托管付款控制台。它面向两个实际任务：从注入式钱包发送稳定币转账，以及创建可由其他钱包打开并支付的 QR 付款请求。",
      "当前版本刻意保持聚焦。它不持有余额、不收集私钥，也不运营托管账户。浏览器准备请求，钱包签署交易，付款状态从 Arc Testnet 数据中验证。"
    ],
    points: [
      "主要应用路由：/payments、/qr-payments 和 /pay。",
      `文档由 ${PRODUCTION_DOCS_HOSTNAME} 提供。`,
      "支持的钱包连接、Arc Testnet 切换、gas 估算、ERC-20 转账、QR 请求创建、转账验证、导入/导出和发票下载。",
      "本版本不包含：托管余额、Permit2、后端强制的 402 流程、MPP rails 和服务端 replay 防护。"
    ]
  },
  {
    title: "付款流程",
    body: [
      "Disburse 将即时转账和基于请求的付款分开。直接付款用于发送方已知道收款人、token 和金额的场景。QR 付款用于请求方发布固定请求，让他人付款。",
      "扫描 QR 请求会打开付款页面，并锁定请求详情。付款人可以连接钱包、估算转账、提交交易、验证结果，并在确认后下载发票。"
    ],
    points: [
      "Payments：发送方输入收款人、token 和金额，然后签署钱包转账。",
      "QR Payments：请求方输入收款人、token、金额、标签、备注和发票日期，然后将请求 URL 作为 QR 码分享。",
      "直接付款不会在本地账本中创建 QR 请求记录。"
    ]
  },
  {
    title: "网络和资产",
    body: [
      "应用固定在 Arc Testnet。Native gas 显示为 18 位小数的 USDC，受支持的 ERC-20 付款金额使用 6 位小数。",
      "RPC 访问通过小型 failover 列表处理。界面展示当前 endpoint、最新区块、安全 gas 价格、chain id 和 token decimal 检查，便于用户签名前判断网络路径是否正常。"
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
    title: "QR 请求 payload",
    body: [
      "QR 码包含 /pay URL，并在 r 查询参数中放入 base64url JSON payload。payload 只是可携带的请求描述；它不会包含私钥、钱包授权、token 余额或已签名交易。",
      "请求记录 token、金额、收款人、标签、创建时间和起始区块。起始区块将验证范围限制在请求创建之后发生的转账。"
    ],
    points: [
      "必填字段：version、id、recipient、token、amount、label、createdAt 和 startBlock。",
      "可选字段：note、invoiceDate、expiresAt 和 dueAt。",
      `默认过期时间：创建后 ${PAYMENT_VALIDITY_MINUTES} 分钟。过期前已开始的付款尝试仍可验证。`
    ],
    code: "/pay?r=<base64url({ version, id, recipient, token, amount, label, note?, invoiceDate?, expiresAt?, dueAt?, createdAt, startBlock })>"
  },
  {
    title: "钱包执行",
    body: [
      "付款是由已连接钱包签署的标准 ERC-20 transfer 调用。应用使用 viem 估算 gas，应用 Arc 的 gas-price floor，提交后立即保存钱包交易哈希，然后等待确认。",
      "钱包仍然是签名的最终授权方。Disburse 准备 calldata 并展示检查结果，但最终 approval 发生在钱包内。"
    ],
    points: [
      "Connect: eth_requestAccounts.",
      "Network: wallet_switchEthereumChain，并使用 wallet_addEthereumChain 作为 Arc Testnet fallback。",
      "Transfer: 在所选 USDC 或 EURC 合约上使用 ERC-20 transfer(recipient, parsedAmount) calldata 调用 eth_sendTransaction。",
      "Gas: 估算用于展示和余额检查；钱包在签名时最终确定交易 gas。"
    ]
  },
  {
    title: "本地账本和 realtime",
    body: [
      "QR 请求和收据存储在浏览器 localStorage 中，请求方无需创建账户即可管理工作。账本支持 JSON 导出和导入，用于备份或迁移。",
      "配置 Supabase 后，QR 请求也可以通过 Vercel API 函数写入。Realtime 事件可在付款人提交、确认、失败或请求过期时关闭请求方视图中的 QR 码。"
    ],
    points: [
      "Storage keys: disburse.requests 和 disburse.receipts。",
      "仍会读取旧 key: arc-pay-desk.requests 和 arc-pay-desk.receipts。",
      "请求按 request id 存储。收据按 request id 或 transaction hash upsert。",
      "导入的 explorer URL 会从已验证的 Arcscan transaction hash 重新生成。"
    ]
  },
  {
    title: "发票输出",
    body: [
      "付款人确认且转账从 Arc Testnet 数据验证后，付款页面可以生成本地 PDF 发票。",
      "发票在浏览器中生成。本版本不会由应用上传，也不会由服务器通过邮件发送。"
    ],
    points: [
      "发票包含 tx hash、区块、金额、标签、备注、发票日期、付款人、收款人、确认时间和 Arcscan 链接。",
      "发票日期是展示元数据，不是付款过期时间。",
      "本版本没有服务器存储或发送发票文件。"
    ]
  },
  {
    title: "验证",
    body: [
      "验证会先检查已知交易哈希。如果没有哈希，它会从请求起始区块到最新区块按 10,000 区块窗口扫描 ERC-20 Transfer logs，并比较收款人和精确 token 金额。",
      "只有 token 合约、收款人和金额全部匹配时，请求才会标记为已支付。发送到正确收款人但金额不同的转账会单独显示，供用户复核。"
    ],
    points: [
      "已支付：向收款人转入请求的精确 token 金额。",
      "可能匹配：存在转给收款人的转账，但金额不同。",
      "未完成：从请求起始区块起未找到匹配转账。"
    ],
    code: "match = log.address == token && log.args.to == recipient && log.args.value == parseUnits(amount, token.decimals)"
  }
];

export const docsSummaryItemsZh: DocsSummaryItem[] = [
  {
    label: "网络",
    value: `Arc Testnet ${ARC_CHAIN_ID}`
  },
  {
    label: "资产",
    value: "USDC 和 EURC"
  },
  {
    label: "托管",
    value: "钱包签名，非托管"
  },
  {
    label: "收据",
    value: "从 Arc Testnet logs 验证"
  }
];
