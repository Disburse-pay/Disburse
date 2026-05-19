import { ARC_CHAIN_ID, ARC_RPC_URL, ARC_RPC_ENDPOINTS, TOKENS } from "../../lib/arc";
import { PAYMENT_VALIDITY_MINUTES } from "../../lib/payments";
import { PRODUCTION_DOCS_HOSTNAME } from "../../lib/routing";
import type { DocsSection, DocsSummaryItem } from "./types";

export const docsSectionsId: DocsSection[] = [
  {
    title: "Ruang lingkup proyek",
    body: [
      "Disburse adalah konsol pembayaran non-kustodial untuk Arc Testnet. Aplikasi ini dibuat untuk dua tugas praktis: mengirim transfer stablecoin dari wallet yang terhubung, dan membuat permintaan pembayaran QR yang bisa dibuka dan dibayar oleh wallet lain.",
      "Build saat ini sengaja dibuat fokus. Aplikasi tidak menyimpan saldo, mengambil private key, atau menjalankan akun kustodial. Browser menyiapkan permintaan, wallet menandatangani transaksi, dan status pembayaran diverifikasi dari data Arc Testnet."
    ],
    points: [
      "Route aplikasi utama: /payments, /qr-payments, dan /pay.",
      `Dokumentasi disajikan dari ${PRODUCTION_DOCS_HOSTNAME}.`,
      "Aksi yang didukung: koneksi wallet, perpindahan ke Arc Testnet, estimasi gas, transfer ERC-20, pembuatan permintaan QR, verifikasi transfer, import/export, dan unduhan invoice.",
      "Di luar cakupan release ini: saldo kustodial, Permit2, alur 402 yang ditegakkan backend, rail MPP, dan perlindungan replay di server."
    ]
  },
  {
    title: "Alur pembayaran",
    body: [
      "Disburse memisahkan transfer langsung dari pembayaran berbasis permintaan. Pembayaran Langsung dipakai saat pengirim sudah tahu penerima, token, dan jumlah. Pembayaran QR dipakai saat requester ingin menerbitkan permintaan tetap untuk dibayar orang lain.",
      "Permintaan QR yang dipindai membuka halaman payer dengan detail yang terkunci. Payer dapat menghubungkan wallet, memperkirakan transfer, mengirim transaksi, memverifikasi hasil, dan mengunduh invoice setelah konfirmasi."
    ],
    points: [
      "Payments: pengirim mengisi penerima, token, dan jumlah, lalu menandatangani transfer wallet.",
      "QR Payments: requester mengisi penerima, token, jumlah, label, catatan, dan tanggal invoice, lalu membagikan URL permintaan sebagai QR code.",
      "Pembayaran Langsung tidak membuat record permintaan QR di ledger lokal."
    ]
  },
  {
    title: "Jaringan dan aset",
    body: [
      "Aplikasi dipasang untuk Arc Testnet. Gas native direpresentasikan sebagai USDC dengan 18 desimal, sedangkan jumlah pembayaran ERC-20 yang didukung memakai 6 desimal.",
      "Akses RPC ditangani lewat daftar failover kecil. Antarmuka menampilkan endpoint aktif, blok terbaru, harga gas aman, chain id, dan pemeriksaan desimal token agar pengguna bisa melihat apakah jalur jaringan sehat sebelum menandatangani."
    ],
    points: [
      `Chain ID: ${ARC_CHAIN_ID}`,
      `RPC: ${new URL(ARC_RPC_URL).host}`,
      `Endpoint failover: ${ARC_RPC_ENDPOINTS.length}`,
      `USDC: ${TOKENS.USDC.address}`,
      `EURC: ${TOKENS.EURC.address}`
    ]
  },
  {
    title: "Payload permintaan QR",
    body: [
      "QR code berisi URL /pay dengan payload JSON base64url pada parameter query r. Payload hanya deskripsi permintaan portabel; tidak pernah berisi private key, approval wallet, saldo token, atau transaksi yang sudah ditandatangani.",
      "Permintaan menyimpan token, jumlah, penerima, label, waktu pembuatan, dan blok awal. Blok awal itu membatasi verifikasi ke transfer yang terjadi setelah permintaan dibuat."
    ],
    points: [
      "Field wajib: version, id, recipient, token, amount, label, createdAt, dan startBlock.",
      "Field opsional: note, invoiceDate, expiresAt, dan dueAt.",
      `Kedaluwarsa default: ${PAYMENT_VALIDITY_MINUTES} menit setelah dibuat. Percobaan pembayaran yang dimulai sebelum kedaluwarsa tetap bisa diverifikasi.`
    ],
    code: "/pay?r=<base64url({ version, id, recipient, token, amount, label, note?, invoiceDate?, expiresAt?, dueAt?, createdAt, startBlock })>"
  },
  {
    title: "Eksekusi wallet",
    body: [
      "Pembayaran adalah pemanggilan transfer ERC-20 standar yang ditandatangani oleh wallet terhubung. Aplikasi memperkirakan gas dengan viem, menerapkan batas bawah harga gas Arc, menyimpan hash transaksi wallet segera setelah dikirim, lalu menunggu konfirmasi.",
      "Wallet tetap menjadi otoritas untuk tanda tangan. Disburse menyiapkan calldata dan menampilkan pemeriksaan, tetapi approval akhir terjadi di dalam wallet."
    ],
    points: [
      "Connect: eth_requestAccounts.",
      "Jaringan: wallet_switchEthereumChain, dengan fallback wallet_addEthereumChain untuk Arc Testnet.",
      "Transfer: eth_sendTransaction dengan calldata ERC-20 transfer(recipient, parsedAmount) pada kontrak USDC atau EURC yang dipilih.",
      "Gas: estimasi dipakai untuk tampilan dan pemeriksaan saldo; wallet menentukan gas transaksi akhir saat signing."
    ]
  },
  {
    title: "Ledger lokal dan realtime",
    body: [
      "Permintaan QR dan receipt disimpan di localStorage browser agar requester bisa mengelola pekerjaan tanpa membuat akun. Ledger mendukung export dan import JSON untuk backup atau migrasi.",
      "Saat Supabase dikonfigurasi, permintaan QR juga bisa ditulis melalui fungsi API Vercel. Event realtime membuat tampilan requester dapat menutup QR code ketika payer mengirim, mengonfirmasi, menggagalkan, atau membuat permintaan kedaluwarsa."
    ],
    points: [
      "Storage key: disburse.requests dan disburse.receipts.",
      "Key lama tetap dibaca: arc-pay-desk.requests dan arc-pay-desk.receipts.",
      "Permintaan diindeks memakai request id. Receipt di-upsert memakai request id atau transaction hash.",
      "URL explorer hasil import dibuat ulang dari hash transaksi Arcscan yang sudah diverifikasi."
    ]
  },
  {
    title: "Output invoice",
    body: [
      "Setelah payer mengonfirmasi dan transfer diverifikasi dari data Arc Testnet, halaman bayar dapat membuat invoice PDF lokal.",
      "Invoice dibuat di browser. File tidak diunggah oleh aplikasi dan tidak dikirim lewat email oleh server pada build ini."
    ],
    points: [
      "Invoice berisi tx hash, blok, jumlah, label, catatan, tanggal invoice, payer, penerima, waktu konfirmasi, dan link Arcscan.",
      "Tanggal invoice adalah metadata tampilan, bukan waktu kedaluwarsa pembayaran.",
      "Tidak ada server yang menyimpan atau mengirim file invoice lewat email pada build ini."
    ]
  },
  {
    title: "Verifikasi",
    body: [
      "Verifikasi pertama memeriksa hash transaksi yang diketahui. Jika tidak ada hash, aplikasi memindai log Transfer ERC-20 dalam jendela 10.000 blok dari blok awal permintaan sampai blok terbaru dan membandingkan penerima serta jumlah token yang tepat.",
      "Permintaan ditandai lunas hanya ketika kontrak token, penerima, dan jumlah cocok. Transfer ke penerima yang benar dengan jumlah berbeda ditampilkan terpisah agar pengguna bisa meninjaunya tanpa memperlakukannya sebagai settled."
    ],
    points: [
      "Lunas: transfer tepat ke penerima untuk jumlah token yang diminta.",
      "Kemungkinan cocok: transfer ke penerima ada, tetapi jumlah berbeda.",
      "Terbuka: tidak ditemukan transfer yang cocok dari blok awal permintaan."
    ],
    code: "match = log.address == token && log.args.to == recipient && log.args.value == parseUnits(amount, token.decimals)"
  }
];

export const docsSummaryItemsId: DocsSummaryItem[] = [
  {
    label: "Jaringan",
    value: `Arc Testnet ${ARC_CHAIN_ID}`
  },
  {
    label: "Aset",
    value: "USDC dan EURC"
  },
  {
    label: "Kustodi",
    value: "Ditandatangani wallet, non-kustodial"
  },
  {
    label: "Receipt",
    value: "Diverifikasi dari log Arc Testnet"
  }
];
