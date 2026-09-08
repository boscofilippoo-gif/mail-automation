import { LegalLayout, LegalSection } from "./LegalLayout";

const linkCls = "underline decoration-dotted underline-offset-4 hover:text-foreground";

/*
 * NOTA: testo informativo redatto sul modello della privacy policy di borustudio.it,
 * NON un parere legale. Prima dell'uso commerciale su larga scala far validare da un
 * professionista, in particolare la sezione sull'accesso ai dati Google (necessaria
 * per l'eventuale verifica dell'app OAuth).
 */
export function PrivacyApp() {
  return (
    <LegalLayout title="Informativa sulla privacy" updated="settembre 2026">
      <p>
        La presente informativa descrive come <strong>BORU studio</strong> di Carlotta Rubinato
        (P.IVA IT02713260061, di seguito «Titolare») tratta i dati personali degli utenti del
        servizio Mail Automation (l'«App»), ai sensi del Regolamento UE 2016/679 (GDPR). Per il
        sito vetrina borustudio.it vale invece la{" "}
        <a href="https://www.borustudio.it/privacy.html" target="_blank" rel="noopener" className={linkCls}>
          relativa informativa
        </a>
        .
      </p>

      <LegalSection n="1" title="Titolare del trattamento">
        <p>
          Titolare del trattamento è BORU studio di Carlotta Rubinato, P.IVA IT02713260061,
          Via Roma 189, 15033 Casale Monferrato (AL), Italia. Contatto per la privacy:{" "}
          <strong>info@borustudio.it</strong>.
        </p>
      </LegalSection>

      <LegalSection n="2" title="Dati che trattiamo">
        <p>A seconda di come usi l'App, trattiamo:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Dati di account</strong>: indirizzo email e, se accedi con Google, nome e
            identificativo dell'account, per creare e riconoscere il tuo profilo. Se accedi con il
            link via email, trattiamo solo l'indirizzo.
          </li>
          <li>
            <strong>Contenuto delle email commerciali</strong>: oggetto, mittente e corpo dei
            messaggi che l'App analizza per generare i documenti. In modalità Gmail sono letti in{" "}
            <strong>sola lettura</strong> dalla tua casella; in modalità inoltro sono i messaggi che
            tu stesso inoltri al tuo indirizzo personale dell'App.
          </li>
          <li>
            <strong>Dati che inserisci</strong>: parole chiave, impostazioni, dati e logo della tua
            azienda, listino prezzi, moduli d'ordine dei fornitori, firma, preferenze di notifica.
          </li>
          <li>
            <strong>Documenti generati</strong>: i PDF e i file Excel prodotti dall'App, i dati
            estratti e le tue modifiche, oltre al registro delle mail analizzate.
          </li>
          <li>
            <strong>Dati tecnici</strong>: log del server (indirizzo IP, data e ora, esito delle
            richieste) generati automaticamente per sicurezza e funzionamento.
          </li>
        </ul>
      </LegalSection>

      <LegalSection n="3" title="Accesso ai dati di Google — Limited Use">
        <p>
          Se scegli di collegare Google, l'uso e il trasferimento delle informazioni ricevute dalle
          API di Google da parte dell'App aderiscono alla{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener" className={linkCls}>
            Google API Services User Data Policy
          </a>
          , inclusi i requisiti di uso limitato («Limited Use»). In particolare:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>usiamo l'ambito <em>gmail.readonly</em> <strong>solo</strong> per leggere le email pertinenti e generare i documenti richiesti;</li>
          <li>usiamo l'ambito <em>gmail.compose</em> <strong>solo</strong> per creare bozze di risposta nella tua casella: l'App <strong>non invia mai</strong> email dal tuo account;</li>
          <li>usiamo l'ambito <em>spreadsheets.readonly</em> <strong>solo</strong> per leggere il foglio Google che indichi come listino prezzi;</li>
          <li><strong>non</strong> cediamo né vendiamo i dati Google a terzi;</li>
          <li><strong>non</strong> usiamo i dati Google per pubblicità né per addestrare modelli di intelligenza artificiale generici;</li>
          <li>nessun operatore umano legge le tue email, salvo tuo consenso esplicito, per motivi di sicurezza o legali, o su dati aggregati e anonimizzati.</li>
        </ul>
        <p>
          Il solo accesso con Google, senza collegare Gmail, richiede unicamente i dati di identità
          di base (email, nome, identificativo).
        </p>
      </LegalSection>

      <LegalSection n="4" title="Come usiamo l'intelligenza artificiale">
        <p>
          Il contenuto delle email pertinenti, il listino e i moduli d'ordine vengono inviati al
          fornitore di AI <strong>Anthropic (Claude)</strong> esclusivamente per classificare i
          messaggi, estrarre i dati dei documenti e abbinare i prodotti. Anthropic opera come
          responsabile del trattamento e non utilizza questi contenuti per addestrare i propri
          modelli.
        </p>
      </LegalSection>

      <LegalSection n="5" title="Finalità e base giuridica">
        <p>
          Trattiamo i dati per erogare il servizio che ci hai chiesto (base giuridica: esecuzione
          del contratto, art. 6.1.b GDPR), per la sicurezza dell'App (legittimo interesse) e per
          adempiere a obblighi di legge. Le notifiche via email sull'attività dell'App sono parte
          del servizio e puoi disattivarle in ogni momento dalle Impostazioni.
        </p>
      </LegalSection>

      <LegalSection n="6" title="Responsabili e destinatari">
        <p>
          I dati sono trattati da fornitori tecnici che agiscono come responsabili del trattamento:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Render</strong> (hosting dell'App e del database, regione Francoforte, UE);</li>
          <li><strong>Brevo</strong> (invio dei link di accesso e delle notifiche; ricezione delle email inoltrate in modalità inoltro);</li>
          <li><strong>Anthropic</strong> (elaborazione AI, vedi punto 4);</li>
          <li><strong>Google</strong> (solo se colleghi il tuo account Google, vedi punto 3).</li>
        </ul>
        <p>Non vendiamo né cediamo i tuoi dati a terzi per finalità di marketing.</p>
      </LegalSection>

      <LegalSection n="7" title="Conservazione">
        <p>
          I dati sono conservati per il tempo necessario a fornire il servizio. Puoi eliminare i
          singoli documenti dalla dashboard in ogni momento. Il contenuto delle email inoltrate è
          conservato per permetterti di rianalizzarle e di consultare la mail originale; i token di
          accesso Google vengono invalidati alla revoca. Su richiesta a info@borustudio.it
          cancelliamo l'intero account e i dati collegati. I log tecnici sono conservati per il
          tempo strettamente necessario.
        </p>
      </LegalSection>

      <LegalSection n="8" title="Sicurezza">
        <p>
          I token di accesso Google sono cifrati a riposo (AES-256-GCM). Le comunicazioni avvengono
          su connessione cifrata (HTTPS). L'accesso a Gmail è in sola lettura. I link di accesso via
          email valgono 15 minuti e una sola volta. Le email inoltrate arrivano su un indirizzo
          personale non indovinabile, tramite un canale autenticato.
        </p>
      </LegalSection>

      <LegalSection n="9" title="Cookie">
        <p>
          L'App utilizza un solo cookie tecnico di sessione, necessario a mantenerti connesso.
          Non usa cookie di profilazione, di analisi né di terze parti. Per il sito borustudio.it
          vedi la{" "}
          <a href="https://www.borustudio.it/cookie.html" target="_blank" rel="noopener" className={linkCls}>
            Cookie Policy
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection n="10" title="I tuoi diritti e la revoca dell'accesso">
        <p>
          Hai diritto di accesso, rettifica, cancellazione, limitazione, portabilità e opposizione
          (artt. 15-22 GDPR). Puoi revocare in ogni momento l'accesso dell'App al tuo account Google
          dalla pagina{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener" className={linkCls}>
            Autorizzazioni account Google
          </a>
          ; in modalità inoltro basta disattivare la regola di inoltro nella tua casella. Per
          esercitare i tuoi diritti scrivi a <strong>info@borustudio.it</strong>. Hai inoltre
          diritto di reclamo al Garante per la protezione dei dati personali.
        </p>
      </LegalSection>

      <LegalSection n="11" title="Modifiche">
        <p>
          Potremo aggiornare questa informativa; le modifiche saranno pubblicate su questa pagina
          con la relativa data.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
