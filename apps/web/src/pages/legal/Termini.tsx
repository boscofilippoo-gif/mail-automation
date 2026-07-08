import { LegalLayout, LegalSection } from "./LegalLayout";

/*
 * NOTA: bozza informativa, NON un parere legale. Far validare prima dell'uso
 * commerciale. Completare i placeholder [ ] con i dati reali del titolare.
 */
export function TerminiApp() {
  return (
    <LegalLayout title="Termini di servizio" updated="luglio 2026">
      <p>
        Utilizzando il servizio Mail Automation (l'«App») fornito da <strong>BORU studio</strong>
        ([Nome Cognome], P.IVA [P.IVA]) accetti i presenti termini.
      </p>

      <LegalSection n="1" title="Cosa fa il servizio">
        <p>
          L'App legge, in sola lettura, le email del tuo account Google che corrispondono ai criteri
          che imposti, ne estrae i dati tramite intelligenza artificiale e genera documenti (es.
          preventivi, fatture, ordini) in PDF. Può creare bozze di risposta nella tua casella. L'App
          <strong> non invia mai</strong> email al posto tuo.
        </p>
      </LegalSection>

      <LegalSection n="2" title="Uso corretto">
        <p>
          Ti impegni a usare l'App solo per account e dati di cui hai titolo, nel rispetto della
          legge. Sei responsabile dei documenti generati e del loro utilizzo verso terzi.
        </p>
      </LegalSection>

      <LegalSection n="3" title="Accuratezza dei documenti">
        <p>
          I dati sono estratti automaticamente tramite AI e <strong>possono contenere errori od
          omissioni</strong>. Ogni documento va verificato prima dell'uso ufficiale: l'App è uno
          strumento di supporto, non un sostituto del controllo umano. Il Titolare non risponde di
          decisioni prese sulla base di documenti non verificati.
        </p>
      </LegalSection>

      <LegalSection n="4" title="Disponibilità del servizio">
        <p>
          L'App è fornita «così com'è», senza garanzia di continuità o assenza di errori. Il
          servizio può essere sospeso o modificato. Nella fase attuale i dati potrebbero non essere
          conservati in modo permanente: conserva copia dei documenti importanti.
        </p>
      </LegalSection>

      <LegalSection n="5" title="Limitazione di responsabilità">
        <p>
          Nei limiti consentiti dalla legge, il Titolare non è responsabile per danni indiretti,
          perdita di dati o mancati guadagni derivanti dall'uso dell'App.
        </p>
      </LegalSection>

      <LegalSection n="6" title="Trattamento dei dati">
        <p>
          Il trattamento dei dati personali è disciplinato dall'<a href="/privacy" className="underline decoration-dotted underline-offset-4 hover:text-foreground">Informativa sulla privacy</a>.
        </p>
      </LegalSection>

      <LegalSection n="7" title="Contatti e legge applicabile">
        <p>
          Per qualsiasi comunicazione: <strong>info@borustudio.it</strong>. I presenti termini sono
          regolati dalla legge italiana.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
