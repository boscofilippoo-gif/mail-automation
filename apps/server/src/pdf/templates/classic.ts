import type { ExtractedDocument, TemplateSettings } from "../../types.js";
import {
  AZZURRO,
  DOC_LABEL,
  NERO,
  PORCELLANA,
  defaultAccent,
  esc,
  money,
  safeColor,
} from "../helpers.js";

/** Blocco "Mittente" coi dati azienda, solo se almeno un campo è compilato. */
function senderBlock(s: TemplateSettings): string {
  const rows = [
    s.company_name ? `<p><strong>${esc(s.company_name)}</strong></p>` : "",
    s.company_vat ? `<p>P.IVA / CF: ${esc(s.company_vat)}</p>` : "",
    s.company_address ? `<p>${esc(s.company_address)}</p>` : "",
    s.company_email ? `<p>${esc(s.company_email)}</p>` : "",
    s.company_phone ? `<p>${esc(s.company_phone)}</p>` : "",
  ].join("");
  if (!rows) return "";
  return `<div class="party"><h3>Mittente</h3>${rows}</div>`;
}

export function renderClassic(doc: ExtractedDocument, s: TemplateSettings): string {
  const accent = safeColor(s.accent_color, defaultAccent(doc.doc_type));
  // colore del titolo: con accento custom usiamo l'accento stesso; altrimenti
  // le tinte scure storiche leggibili su porcellana
  const titleColor = s.accent_color
    ? accent
    : accent === AZZURRO
      ? "#2b6f8c"
      : "#b5446a";
  const label = DOC_LABEL[doc.doc_type] ?? "Documento";

  const brandHtml = s.logo_data_url
    ? `<img src="${esc(s.logo_data_url)}" alt="" style="max-height:56px;max-width:200px;object-fit:contain;display:block" />`
    : `<div class="brand">${esc(s.company_name ?? "BORU studio")}<small>${s.company_name ? "" : "Mail Automation"}</small></div>`;

  const rows = doc.line_items
    .map(
      (li) => `
      <tr>
        <td>${esc(li.description)}</td>
        <td class="num">${esc(li.quantity)}</td>
        <td class="num">${money(li.unit_price, doc.currency)}</td>
        <td class="num">${money(li.total, doc.currency)}</td>
      </tr>`,
    )
    .join("");

  const footerText = s.footer_note
    ? esc(s.footer_note)
    : "Documento generato automaticamente da BORU Mail Automation a partire da un'email. I dati sono estratti tramite AI e vanno verificati prima dell'uso ufficiale.";

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: ${NERO};
    background: ${PORCELLANA};
    font-size: 13px;
    line-height: 1.5;
  }
  .page { padding: 48px 56px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${accent}; padding-bottom: 20px; }
  .brand { font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
  .brand small { display: block; font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 2px; color: #6b6357; margin-top: 4px; }
  .doc-meta { text-align: right; }
  .doc-type { font-size: 26px; font-weight: 700; text-transform: uppercase; color: ${titleColor}; }
  .doc-meta .sub { color: #6b6357; font-size: 12px; }
  .parties { display: flex; justify-content: space-between; margin: 32px 0; gap: 32px; }
  .party h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #6b6357; margin: 0 0 6px; }
  .party p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #6b6357; border-bottom: 2px solid #e4ddd0; padding: 8px 10px; }
  th.num, td.num { text-align: right; }
  td { padding: 10px; border-bottom: 1px solid #ece6da; }
  .totals { margin-top: 20px; margin-left: auto; width: 280px; }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 0; }
  .totals .row.grand { border-top: 2px solid ${accent}; margin-top: 6px; padding-top: 12px; font-size: 16px; font-weight: 700; }
  .notes { margin-top: 32px; padding: 16px; background: #fff; border-left: 3px solid ${accent}; border-radius: 4px; color: #4a4438; }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e4ddd0; font-size: 10px; color: #9a9182; text-align: center; }
</style>
</head>
<body>
  <div class="page">
    <header>
      ${brandHtml}
      <div class="doc-meta">
        <div class="doc-type">${esc(label)}</div>
        <div class="sub">${doc.document_number ? "N. " + esc(doc.document_number) : ""}</div>
        <div class="sub">${doc.document_date ? esc(doc.document_date) : ""}</div>
      </div>
    </header>

    <div class="parties">
      ${senderBlock(s)}
      <div class="party">
        <h3>Destinatario</h3>
        <p><strong>${esc(doc.customer_name) || "—"}</strong></p>
        ${doc.customer_vat ? `<p>P.IVA / CF: ${esc(doc.customer_vat)}</p>` : ""}
        ${doc.customer_address ? `<p>${esc(doc.customer_address)}</p>` : ""}
        ${doc.customer_email ? `<p>${esc(doc.customer_email)}</p>` : ""}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Descrizione</th>
          <th class="num">Q.tà</th>
          <th class="num">Prezzo unit.</th>
          <th class="num">Totale</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="4" style="color:#9a9182">Nessuna riga estratta dal testo.</td></tr>`}
      </tbody>
    </table>

    <div class="totals">
      <div class="row"><span>Imponibile</span><span>${money(doc.subtotal, doc.currency)}</span></div>
      <div class="row"><span>Imposta</span><span>${money(doc.tax, doc.currency)}</span></div>
      <div class="row grand"><span>Totale</span><span>${money(doc.total, doc.currency)}</span></div>
    </div>

    ${doc.notes ? `<div class="notes">${esc(doc.notes)}</div>` : ""}

    <footer>${footerText}</footer>
  </div>
</body>
</html>`;
}
