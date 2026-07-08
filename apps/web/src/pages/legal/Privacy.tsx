import { LegalLayout, LegalSection } from "./LegalLayout";

/*
 * NOTA: bozza informativa, NON un parere legale. Prima dell'uso commerciale con
 * clienti reali far validare da un professionista — in particolare la sezione
 * sull'accesso ai dati Google, necessaria per la verifica dell'app OAuth.
 * Completare i placeholder [ ] con i dati reali del titolare.
 */
export function PrivacyApp() {
  return (
    <LegalLayout title="Informativa sulla privacy" updated="luglio 2026">
      <p>
        La presente informativa descrive come <strong>BORU studio</strong> di Carlotta Rubinato
        (P.IVA IT02713260061, di seguito «Titolare») tratta i dati personali degli utenti del
        servizio Mail Automation (l'«App»), ai sensi del Regolamento UE 2016/679 (GDPR).
      </p>

      <LegalSection n="1" title="Titolare del trattamento">
        <p>
          Titolare del trattamento è BORU studio di Carlotta Rubinato, P.IVA IT02713260061,
          Via Roma 189, 15033 Casale Monferrato (AL), Italia. Per qualsiasi richiesta relativa
          alla privacy: <strong>info@borustudio.it</strong>.
        </p>
      </LegalSection>

      <LegalSection n="2" title="Dati che trattiamo">
        <p>Utilizzando l'App tramite accesso con Google, trattiamo:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Dati di identità Google</strong>: indirizzo email, nome e identificativo dell'account, per creare e riconoscere il tuo account.</li>
          <li><strong>Contenuto delle email</strong>: oggetto, mittente e corpo dei messaggi che rientrano nei criteri di ricerca che imposti, letti in <strong>sola lettura</strong> per generare i documenti.</li>
          <li><strong>Dati che inserisci</strong>: parole chiave, impostazioni, dati aziendali, listino prezzi, firma.</li>
          <li><strong>Documenti generati</strong>: i PDF prodotti dall'App e i relativi dati estratti.</li>
        </ul>
      </LegalSection>

      <LegalSection n="3" title="Accesso ai dati di Google (Gmail) — Limited Use">
        <p>
          L'uso e il trasferimento delle informazioni ricevute dalle API di Google da parte dell'App
          aderiscono alla{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener" className="underline decoration-dotted underline-offset-4 hover:text-foreground">
            Google API Services User Data Policy
          </a>
          , inclusi i requisiti di uso limitato («Limited Use»). In particolare:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>usiamo l'accesso a Gmail (ambito <em>gmail.readonly</em>) <strong>solo</strong> per leggere le email pertinenti e generare i documenti richiesti;</li>
          <li>usiamo l'ambito <em>gmail.compose</em> <strong>solo</strong> per creare bozze di risposta nella tua casella; l'App <strong>non invia mai</strong> email automaticamente;</li>
          <li><strong>non</strong> cediamo né vendiamo i dati Gmail a terzi;</li>
          <li><strong>non</strong> usiamo i dati Gmail per pubblicità né per addestrare modelli di intelligenza artificiale generici;</li>
          <li>nessun operatore umano legge le tue email, salvo tuo consenso esplicito, per motivi di sicurezza/legali o dati aggregati e anonimizzati.</li>
        </ul>
      </LegalSection>

      <LegalSection n="4" title="Come usiamo l'intelligenza artificiale">
        <p>
          Il contenuto delle email pertinenti viene inviato al fornitore di AI <strong>Anthropic
          (Claude)</strong> esclusivamente per estrarre i dati del documento e classificare i
          messaggi. Anthropic opera come responsabile del trattamento e non utilizza questi
          contenuti per addestrare i propri modelli.
        </p>
      </LegalSection>

      <LegalSection n="5" title="Finalità e base giuridica">
        <p>
          Trattiamo i dati per erogare il servizio che ci hai chiesto (base giuridica: esecuzione
          del contratto / tue richieste, art. 6.1.b GDPR) e per adempiere a obblighi di legge.
        </p>
      </LegalSection>

      <LegalSection n="6" title="Conservazione">
        <p>
          I dati sono conservati per il tempo necessario a fornire il servizio. Puoi eliminare i
          documenti e revocare l'accesso in qualsiasi momento (vedi punto 8); alla revoca, i token
          di accesso vengono invalidati e i dati collegati possono essere rimossi su richiesta.
        </p>
      </LegalSection>

      <LegalSection n="7" title="Sicurezza">
        <p>
          I token di accesso Google sono cifrati a riposo. Le comunicazioni avvengono su
          connessione cifrata (HTTPS). L'accesso a Gmail è in sola lettura.
        </p>
      </LegalSection>

      <LegalSection n="8" title="I tuoi diritti e la revoca dell'accesso">
        <p>
          Hai diritto di accesso, rettifica, cancellazione, limitazione, portabilità e opposizione
          (artt. 15-22 GDPR). Puoi revocare in ogni momento l'accesso dell'App al tuo account Google
          dalla pagina{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener" className="underline decoration-dotted underline-offset-4 hover:text-foreground">
            Autorizzazioni account Google
          </a>
          . Per esercitare i tuoi diritti scrivi a <strong>info@borustudio.it</strong>. Hai inoltre
          diritto di reclamo al Garante per la protezione dei dati personali.
        </p>
      </LegalSection>

      <LegalSection n="9" title="Modifiche">
        <p>
          Potremo aggiornare questa informativa; le modifiche saranno pubblicate su questa pagina
          con la data di aggiornamento.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
