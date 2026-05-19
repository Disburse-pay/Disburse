import { ARC_CHAIN_ID, ARC_RPC_URL, ARC_RPC_ENDPOINTS, TOKENS } from "../../lib/arc";
import { PAYMENT_VALIDITY_MINUTES } from "../../lib/payments";
import { PRODUCTION_DOCS_HOSTNAME } from "../../lib/routing";
import type { DocsSection, DocsSummaryItem } from "./types";

export const docsSectionsDe: DocsSection[] = [
  {
    title: "Projektumfang",
    body: [
      "Disburse ist eine nicht-kustodiale Zahlungskonsole für Arc Testnet. Sie deckt zwei praktische Aufgaben ab: eine Stablecoin-Überweisung aus einer injected Wallet senden und eine QR-Zahlungsanfrage erstellen, die eine andere Wallet öffnen und bezahlen kann.",
      "Der aktuelle Build ist bewusst eng gehalten. Die App hält keine Guthaben, sammelt keine Private Keys und betreibt kein Verwahrkonto. Der Browser bereitet die Anfrage vor, die Wallet signiert die Transaktion, und der Zahlungsstatus wird gegen Arc-Testnet-Daten verifiziert."
    ],
    points: [
      "Primäre App-Routen: /payments, /qr-payments und /pay.",
      `Dokumentation wird von ${PRODUCTION_DOCS_HOSTNAME} ausgeliefert.`,
      "Unterstützt werden Wallet-Verbindung, Wechsel zu Arc Testnet, Gas-Schätzung, ERC-20-Transfers, QR-Anfragen, Transferverifizierung, Import/Export und Rechnungsdownload.",
      "Nicht enthalten in diesem Release: kustodiale Guthaben, Permit2, backend-erzwungene 402-Flows, MPP-Rails und serverseitiger Replay-Schutz."
    ]
  },
  {
    title: "Zahlungsabläufe",
    body: [
      "Disburse trennt direkte Überweisungen von anfragebasierten Zahlungen. Direkte Zahlungen werden genutzt, wenn Sender, Empfänger, Token und Betrag bereits bekannt sind. QR-Zahlungen werden genutzt, wenn ein Anforderer eine feste Anfrage veröffentlichen will.",
      "Eine gescannte QR-Anfrage öffnet die Zahlerseite mit gesperrten Details. Der Zahler kann eine Wallet verbinden, den Transfer schätzen, die Transaktion senden, das Ergebnis verifizieren und nach der Bestätigung die Rechnung herunterladen."
    ],
    points: [
      "Payments: Der Sender gibt Empfänger, Token und Betrag ein und signiert eine Wallet-Überweisung.",
      "QR Payments: Der Anforderer gibt Empfänger, Token, Betrag, Label, Notiz und Rechnungsdatum ein und teilt die Anfrage-URL als QR-Code.",
      "Direkte Zahlungen erzeugen keine QR-Anfragedatensätze im lokalen Ledger."
    ]
  },
  {
    title: "Netzwerk und Assets",
    body: [
      "Die App ist auf Arc Testnet festgelegt. Native Gas wird als USDC mit 18 Dezimalstellen dargestellt, während unterstützte ERC-20-Zahlungsbeträge 6 Dezimalstellen verwenden.",
      "RPC-Zugriff läuft über eine kleine Failover-Liste. Die Oberfläche zeigt aktiven Endpoint, neuesten Block, sicheren Gaspreis, Chain-ID und Token-Dezimalprüfungen, damit der Nutzer den Netzwerkpfad vor dem Signieren prüfen kann."
    ],
    points: [
      `Chain ID: ${ARC_CHAIN_ID}`,
      `RPC: ${new URL(ARC_RPC_URL).host}`,
      `Failover-Endpunkte: ${ARC_RPC_ENDPOINTS.length}`,
      `USDC: ${TOKENS.USDC.address}`,
      `EURC: ${TOKENS.EURC.address}`
    ]
  },
  {
    title: "QR-Anfrage-Payload",
    body: [
      "Ein QR-Code enthält eine /pay-URL mit einem base64url-JSON-Payload im Query-Parameter r. Der Payload ist nur eine portable Anfragebeschreibung; er enthält niemals Private Keys, Wallet-Freigaben, Token-Guthaben oder signierte Transaktionen.",
      "Die Anfrage speichert Token, Betrag, Empfänger, Label, Erstellungszeit und Startblock. Dieser Startblock begrenzt die Verifizierung auf Transfers, die nach der Erstellung passiert sind."
    ],
    points: [
      "Pflichtfelder: version, id, recipient, token, amount, label, createdAt und startBlock.",
      "Optionale Felder: note, invoiceDate, expiresAt und dueAt.",
      `Standardablauf: ${PAYMENT_VALIDITY_MINUTES} Minuten nach Erstellung. Ein vor Ablauf gestarteter Zahlungsversuch kann weiterhin verifiziert werden.`
    ],
    code: "/pay?r=<base64url({ version, id, recipient, token, amount, label, note?, invoiceDate?, expiresAt?, dueAt?, createdAt, startBlock })>"
  },
  {
    title: "Wallet-Ausführung",
    body: [
      "Zahlungen sind standardmäßige ERC-20-transfer-Aufrufe, die von der verbundenen Wallet signiert werden. Die App schätzt Gas mit viem, wendet den Arc-Gaspreis-Floor an, speichert den Transaktionshash sofort nach dem Senden und wartet dann auf Bestätigung.",
      "Die Wallet bleibt die Autorität für Signaturen. Disburse bereitet Calldata vor und zeigt Prüfungen an, aber die finale Freigabe passiert in der Wallet."
    ],
    points: [
      "Connect: eth_requestAccounts.",
      "Netzwerk: wallet_switchEthereumChain, mit wallet_addEthereumChain als Fallback für Arc Testnet.",
      "Transfer: eth_sendTransaction mit ERC-20 transfer(recipient, parsedAmount) calldata auf dem gewählten USDC- oder EURC-Kontrakt.",
      "Gas: Schätzungen werden für Anzeige und Saldo-Prüfungen genutzt; die Wallet finalisiert das Transaktionsgas beim Signieren."
    ]
  },
  {
    title: "Lokales Ledger und Realtime",
    body: [
      "QR-Anfragen und Belege werden im localStorage des Browsers gespeichert, damit der Anforderer ohne Konto arbeiten kann. Das Ledger unterstützt JSON-Export und -Import für Backup oder Migration.",
      "Wenn Supabase konfiguriert ist, können QR-Anfragen auch über Vercel-API-Funktionen geschrieben werden. Realtime-Events schließen den QR-Code in der Anfordereransicht, wenn der Zahler sendet, bestätigt, fehlschlägt oder eine Anfrage abläuft."
    ],
    points: [
      "Storage-Keys: disburse.requests und disburse.receipts.",
      "Legacy-Keys werden weiter gelesen: arc-pay-desk.requests und arc-pay-desk.receipts.",
      "Anfragen werden nach request id gespeichert. Belege werden nach request id oder transaction hash upserted.",
      "Importierte Explorer-URLs werden aus dem verifizierten Arcscan-Transaktionshash neu erzeugt."
    ]
  },
  {
    title: "Rechnungsausgabe",
    body: [
      "Nachdem der Zahler bestätigt und der Transfer aus Arc-Testnet-Daten verifiziert wurde, kann die Zahlungsseite eine lokale PDF-Rechnung erstellen.",
      "Rechnungen werden im Browser erzeugt. Sie werden in diesem Build weder von der App hochgeladen noch vom Server per E-Mail versendet."
    ],
    points: [
      "Die Rechnung enthält Tx-Hash, Block, Betrag, Label, Notiz, Rechnungsdatum, Zahler, Empfänger, Bestätigungszeit und Arcscan-Link.",
      "Das Rechnungsdatum ist Anzeige-Metadatum, nicht der Ablauf der Zahlung.",
      "Kein Server speichert oder versendet Rechnungsdateien in diesem Build."
    ]
  },
  {
    title: "Verifizierung",
    body: [
      "Die Verifizierung prüft zuerst einen bekannten Transaktionshash. Wenn kein Hash vorliegt, scannt sie ERC-20-Transfer-Logs in 10.000-Block-Fenstern vom Startblock bis zum neuesten Block und vergleicht Empfänger plus exakten Tokenbetrag.",
      "Eine Anfrage wird nur dann als bezahlt markiert, wenn Token-Kontrakt, Empfänger und Betrag übereinstimmen. Transfers an den richtigen Empfänger mit anderem Betrag werden separat angezeigt."
    ],
    points: [
      "Bezahlt: exakter Transfer an den Empfänger für den angeforderten Tokenbetrag.",
      "Möglicher Treffer: Transfer an den Empfänger existiert, aber der Betrag ist anders.",
      "Offen: kein passender Transfer ab dem Startblock gefunden."
    ],
    code: "match = log.address == token && log.args.to == recipient && log.args.value == parseUnits(amount, token.decimals)"
  }
];

export const docsSummaryItemsDe: DocsSummaryItem[] = [
  {
    label: "Netzwerk",
    value: `Arc Testnet ${ARC_CHAIN_ID}`
  },
  {
    label: "Assets",
    value: "USDC und EURC"
  },
  {
    label: "Verwahrung",
    value: "Wallet-signiert, nicht-kustodial"
  },
  {
    label: "Belege",
    value: "Aus Arc-Testnet-Logs verifiziert"
  }
];
