import type { ExtractedDocument, TemplateSettings } from "../../types.js";
import { DOC_LABEL, NERO, defaultAccent, esc, money, safeColor } from "../helpers.js";

/** Minimal: bianco, molta aria, filetti sottili, tipografia in maiuscoletto. */
export function renderMinimal(doc: ExtractedDocument, s: TemplateSettings): string {
  const accent = safeColor(s.accent_color, defaultAccent(doc.doc_type));
  const label = DOC_LABEL[doc.doc_type] ?? "Documento";

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

  const senderLine = [s.company_address, s.company_vat ? `P.IVA ${s.company_vat}` : null, s.company_email, s.company_phone]
    .filter(Boolean)
    .map((x) => esc(x))
    .join(" · ");

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
    background: #ffffff;
    font-size: 12.5px;
    line-height: 1.65;
  }
  .page { padding: 64px 72px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; }
  .company { font-size: 13px; font-weight: 600; letter-spacing: 0.4px; }
  .company .line { margin-top: 4px; font-size: 10px; color: #8a8276; font-weight: 400; }
  .doc-label { font-size: 11px; text-transform: uppercase; letter-spacing: 4px; color: ${NERO}; padding-bottom: 6px; border-bottom: 2px solid ${accent}; }
  .meta { margin-top: 40px; display: flex; gap: 56px; }
  .meta div h4 { margin: 0 0 4px; font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: #8a8276; font-weight: 600; }
  .meta div p { margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 48px; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: #8a8276; font-weight: 600; padding: 0 8px 10px; border-bottom: 1px solid #e8e4dc; }
  th.num, td.num { text-align: right; }
  td { padding: 12px 8px; border-bottom: 1px solid #f1eee8; }
  .totals { margin-top: 28px; margin-left: auto; width: 260px; font-size: 12.5px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 8px; color: #6b6357; }
  .totals .row.grand { color: ${NERO}; font-size: 15px; font-weight: 600; margin-top: 8px; padding-top: 12px; border-top: 1px solid ${accent}; }
  .notes { margin-top: 48px; font-size: 11px; color: #8a8276; max-width: 420px; }
  footer { margin-top: 72px; font-size: 9px; letter-spacing: 0.5px; color: #b3aca0; text-align: center; }
</style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div class="company">
        ${s.logo_data_url ? `<img src="${esc(s.logo_data_url)}" alt="" style="max-height:44px;max-width:170px;object-fit:contain;display:block;margin-bottom:8px" />` : ""}
        ${esc(s.company_name ?? "BORU studio")}
        ${senderLine ? `<div class="line">${senderLine}</div>` : ""}
      </div>
      <div class="doc-label">${esc(label)}</div>
    </div>

    <div class="meta">
      <div>
        <h4>Destinatario</h4>
        <p><strong>${esc(doc.customer_name) || "—"}</strong></p>
        ${doc.customer_address ? `<p>${esc(doc.customer_address)}</p>` : ""}
        ${doc.customer_vat ? `<p>P.IVA ${esc(doc.customer_vat)}</p>` : ""}
        ${doc.customer_email ? `<p>${esc(doc.customer_email)}</p>` : ""}
      </div>
      <div>
        ${doc.document_number ? `<h4>Numero</h4><p>${esc(doc.document_number)}</p>` : ""}
      </div>
      <div>
        ${doc.document_date ? `<h4>Data</h4><p>${esc(doc.document_date)}</p>` : ""}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Descrizione</th>
          <th class="num">Q.tà</th>
          <th class="num">Prezzo</th>
          <th class="num">Totale</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="4" style="color:#b3aca0">Nessuna riga estratta dal testo.</td></tr>`}
      </tbody>
    </table>

    <div class="totals">
      <div class="row"><span>Imponibile</span><span>${money(doc.subtotal, doc.currency)}</span></div>
      <div class="row"><span>Imposta</span><span>${money(doc.tax, doc.currency)}</span></div>
      <div class="row grand"><span>Totale</span><span>${money(doc.total, doc.currency)}</span></div>
    </div>

    ${doc.notes ? `<div class="notes">${esc(doc.notes)}</div>` : ""}

    <footer>${s.footer_note ? esc(s.footer_note) : "Documento generato automaticamente · dati estratti tramite AI, da verificare prima dell'uso ufficiale"}</footer>
  </div>
</body>
</html>`;
}
