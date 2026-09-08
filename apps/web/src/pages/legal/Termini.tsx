import { LegalLayout, LegalSection } from "./LegalLayout";

/*
 * NOTA: testo informativo, NON un parere legale. Far validare prima dell'uso
 * commerciale su larga scala.
 */
export function TerminiApp() {
  return (
    <LegalLayout title="Termini di servizio" updated="settembre 2026">
      <p>
        Utilizzando il servizio Mail Automation (l'«App») fornito da <strong>BORU studio</strong> di
        Carlotta Rubinato (P.IVA IT02713260061, Via Roma 189, 15033 Casale Monferrato (AL)) accetti
        i presenti termini.
      </p>

      <LegalSection n="1" title="Cosa fa il servizio">
        <p>
          L'App analizza le email commerciali che ricevi, ne estrae i dati tramite intelligenza
          artificiale e genera documenti (preventivi, ordini, fatture) in PDF e, se configurati,
          moduli d'ordine Excel per i tuoi fornitori. Le email possono arrivare all'App in due modi,
          a tua scelta: collegando la casella Gmail in sola lettura, oppure inoltrando i messaggi a
          un indirizzo personale che ti assegniamo. L'App può preparare bozze di risposta nella tua
          casella Gmail o un testo da copiare, e può avvisarti via email dell'attività svolta.
          L'App <strong>non invia mai</strong> email ai tuoi clienti al posto tuo.
        </p>
      </LegalSection>

      <LegalSection n="2" title="Uso corretto">
        <p>
          Ti impegni a usare l'App solo per caselle e dati di cui hai titolo, nel rispetto della
          legge e dei diritti di terzi. Sei responsabile dei documenti generati e del loro utilizzo
          verso clienti e fornitori, così come delle regole di inoltro che configuri nella tua
          casella.
        </p>
      </LegalSection>

      <LegalSection n="3" title="Accuratezza dei documenti">
        <p>
          I dati sono estratti automaticamente tramite AI e <strong>possono contenere errori od
          omissioni</strong>: prezzi, quantità, riferimenti o l'abbinamento dei prodotti ai moduli
          dei fornitori. Ogni documento va verificato prima dell'uso ufficiale: l'App è uno
          strumento di supporto, non un sostituto del controllo umano. Il Titolare non risponde di
          decisioni prese sulla base di documenti non verificati.
        </p>
      </LegalSection>

      <LegalSection n="4" title="Disponibilità del servizio">
        <p>
          L'App è fornita «così com'è», senza garanzia di continuità o assenza di errori. Il
          servizio può essere sospeso, modificato o interrotto. Conserva sempre una copia dei
          documenti importanti: l'App non è un sistema di archiviazione fiscale né sostituisce il
          tuo gestionale.
        </p>
      </LegalSection>

      <LegalSection n="5" title="Servizi di terzi">
        <p>
          L'App si appoggia a fornitori esterni (hosting, invio e ricezione email, intelligenza
          artificiale, servizi Google) indicati nell'informativa sulla privacy. Un'interruzione o
          una modifica di questi servizi può influire sul funzionamento dell'App.
        </p>
      </LegalSection>

      <LegalSection n="6" title="Limitazione di responsabilità">
        <p>
          Nei limiti consentiti dalla legge, il Titolare non è responsabile per danni indiretti,
          perdita di dati o mancati guadagni derivanti dall'uso dell'App.
        </p>
      </LegalSection>

      <LegalSection n="7" title="Trattamento dei dati">
        <p>
          Il trattamento dei dati personali è disciplinato dall'
          <a href="/privacy" className="underline decoration-dotted underline-offset-4 hover:text-foreground">Informativa sulla privacy</a>.
        </p>
      </LegalSection>

      <LegalSection n="8" title="Contatti e legge applicabile">
        <p>
          Per qualsiasi comunicazione: <strong>info@borustudio.it</strong>. I presenti termini sono
          regolati dalla legge italiana; per le controversie è competente il foro del Titolare,
          salvo il foro inderogabile del consumatore ove applicabile.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
