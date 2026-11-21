/** Nom du produit + signature de la société (logo QS2H). */
export function Brand() {
  return (
    <header className="brand">
      <h1 className="wordmark">
        PILOT<span>'</span>TRESO
      </h1>
      <img className="brand-logo" src="/qs2h-logo.png" alt="by QS2H — Solutions digitales" width="180" height="53" />
      <p className="brand-tag">Votre trésorerie, pilotée à la voix</p>
    </header>
  );
}
