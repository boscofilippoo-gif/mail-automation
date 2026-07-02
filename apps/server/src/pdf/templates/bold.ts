import type { ExtractedDocument, TemplateSettings } from "../../types.js";
import { DOC_LABEL, NERO, PORCELLANA, defaultAccent, esc, money, safeColor } from "../helpers.js";

/** Bold: banda scura in testata, tipo documento oversize, righe zebrate. */
export function renderBold(doc: ExtractedDocument, s: TemplateSettings): string {
  const accent = safeColor(s.accent_color, defaultAccent(doc.doc_type));
  const label = DOC_LABEL[doc.doc_type] ?? "Documento";

  const rows = doc.line_items
    .map(
      (li, i) => `
      <tr${i % 2 === 1 ? ' class="alt"' : ""}>
        <td>${esc(li.description)}</td>
        <td class="num">${esc(li.quantity)}</td>
        <td class="num">${money(li.unit_price, doc.currency)}</td>
        <td class="num">${money(li.total, doc.currency)}</td>
      </tr>`,
    )
    .join("");

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
  .band { background: ${NERO}; color: ${PORCELLANA}; padding: 40px 56px 32px; }
  .band-top { display: flex; justify-content: space-between; align-items: center; }
  .brand { font-size: 18px; font-weight: 700; letter-spacing: 0.5px; }
  .brand small { display: block; font-size: 9px; font-weight: 500; text-transform: uppercase; letter-spacing: 2px; opacity: 0.55; margin-top: 3px; }
  .doc-type { margin-top: 18px; font-size: 42px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: ${accent}; line-height: 1; }
  .band .sub { margin-top: 8px; font-size: 11px; opacity: 0.65; }
  .page { padding: 36px 56px 48px; }
  .parties { display: flex; justify-content: space-between; gap: 32px; }
  .party h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #6b6357; margin: 0 0 6px; }
  .party p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 32px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: ${PORCELLANA}; background: ${NERO}; padding: 10px; }
  th.num, td.num { text-align: right; }
  td { padding: 11px 10px; }
  tr.alt td { background: #f2ede4; }
  .totals-box { margin-top: 28px; margin-left: auto; width: 300px; background: ${NERO}; color: ${PORCELLANA}; border-radius: 8px; padding: 18px 20px; }
  .totals-box .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; opacity: 0.75; }
  .totals-box .row.grand { opacity: 1; font-size: 18px; font-weight: 800; margin-top: 8px; padding-top: 12px; border-top: 2px solid ${accent}; color: ${accent}; }
  .notes { margin-top: 32px; padding: 16px; border: 1px solid #e4ddd0; border-left: 4px solid ${accent}; border-radius: 4px; color: #4a4438; }
  footer { margin-top: 48px; font-size: 10px; color: #9a9182; text-align: center; }
</style>
</head>
<body>
  <div class="band">
    <div class="band-top">
      <div class="brand">
        ${esc(s.company_name ?? "BORU studio")}
        <small>${s.company_name ? [s.company_vat ? `P.IVA ${s.company_vat}` : null, s.company_phone].filter(Boolean).map((x) => esc(x)).join(" · ") : "Mail Automation"}</small>
      </div>
      ${s.logo_data_url ? `<img src="${esc(s.logo_data_url)}" alt="" style="max-height:52px;max-width:180px;object-fit:contain" />` : ""}
    </div>
    <div class="doc-type">${esc(label)}</div>
    <div class="sub">
      ${[doc.document_number ? `N. ${esc(doc.document_number)}` : null, doc.document_date ? esc(doc.document_date) : null].filter(Boolean).join(" · ")}
    </div>
  </div>

  <div class="page">
    <div class="parties">
      <div class="party">
        <h3>Destinatario</h3>
        <p><strong>${esc(doc.customer_name) || "—"}</strong></p>
        ${doc.customer_vat ? `<p>P.IVA / CF: ${esc(doc.customer_vat)}</p>` : ""}
        ${doc.customer_address ? `<p>${esc(doc.customer_address)}</p>` : ""}
        ${doc.customer_email ? `<p>${esc(doc.customer_email)}</p>` : ""}
      </div>
      ${
        s.company_address || s.company_email
          ? `<div class="party"><h3>Mittente</h3>
             ${s.company_address ? `<p>${esc(s.company_address)}</p>` : ""}
             ${s.company_email ? `<p>${esc(s.company_email)}</p>` : ""}</div>`
          : ""
      }
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

    <div class="totals-box">
      <div class="row"><span>Imponibile</span><span>${money(doc.subtotal, doc.currency)}</span></div>
      <div class="row"><span>Imposta</span><span>${money(doc.tax, doc.currency)}</span></div>
      <div class="row grand"><span>Totale</span><span>${money(doc.total, doc.currency)}</span></div>
    </div>

    ${doc.notes ? `<div class="notes">${esc(doc.notes)}</div>` : ""}

    <footer>${s.footer_note ? esc(s.footer_note) : "Documento generato automaticamente da BORU Mail Automation · dati estratti tramite AI, da verificare prima dell'uso ufficiale."}</footer>
  </div>
</body>
</html>`;
}
