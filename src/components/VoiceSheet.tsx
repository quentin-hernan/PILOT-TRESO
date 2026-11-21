import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccountType, Category, Operation, OperationDraft, OperationKind } from '../types';
import { categoriesFor } from '../data/categories';
import { centsToInput, formatEuros, parseEurosToCents } from '../lib/money';
import { makeDate, parisYMD, type YMD } from '../lib/dates';
import { parseCommand, type ParsedCommand } from '../voice/parseCommand';
import {
  createRecognizer,
  getPreferredEngine,
  giveOnDeviceConsent,
  hasOnDeviceConsent,
  isBrowserEngineAvailable,
  isMicAllowedContext,
  isOnDeviceModelCached,
  isOnDeviceStorageVolatile,
  isVoiceSetupDone,
  markVoiceSetupDone,
  requestPersistentStorage,
  setPreferredEngine,
  ONDEVICE_MODEL_MB,
  VOICE_ERROR_MESSAGES,
  type RecognizerStatus,
  type VoiceEngine,
  type VoiceErrorKind,
  type VoiceRecognizer,
} from '../voice/recognizer';
import { Icon } from './Icon';

const pad = (n: number) => String(n).padStart(2, '0');
const ymdToStr = (p: YMD) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;

const HINTS: Record<AccountType, string[]> = {
  particulier: ["J'ai dépensé 50 euros de carburant", "J'ai reçu mon salaire de 2 500 euros", "J'ai payé 75 euros d'électricité"],
  professionnel: ["J'ai vendu pour 100 euros", "J'ai dépensé 50 euros de carburant", "J'ai acheté pour 210 euros de matériel"],
};

interface Props {
  account: AccountType;
  /** voice : dictée ; manual : formulaire vide ; edit : modification d'une opération existante. */
  mode: 'voice' | 'manual' | 'edit';
  /** L'opération à modifier (mode edit). */
  initial?: Operation;
  /** L'employé ne peut saisir que des dépenses. */
  expenseOnly?: boolean;
  /** Option « enregistrement direct » : pas de fenêtre de confirmation quand la phrase est complète. */
  directSave?: boolean;
  onDirectSaveChange?: (value: boolean) => void;
  onConfirm: (draft: OperationDraft) => Promise<void>;
  /** Enregistrement direct (sans confirmation). */
  onDirect?: (draft: OperationDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export function VoiceSheet({
  account,
  mode,
  initial,
  expenseOnly,
  directSave,
  onDirectSaveChange,
  onConfirm,
  onDirect,
  onDelete,
  onClose,
}: Props) {
  const categories = useMemo(() => categoriesFor(account), [account]);
  const hint = useMemo(() => HINTS[account][Math.floor(Math.random() * HINTS[account].length)], [account]);

  const todayStr = ymdToStr(parisYMD(new Date()));
  const yesterdayStr = ymdToStr(parisYMD(new Date(Date.now() - 86_400_000)));
  const originalStr = initial ? ymdToStr(parisYMD(initial.date)) : null;

  const [step, setStep] = useState<'listening' | 'review' | 'error' | 'setup' | 'setupHeard' | 'setupDone'>(
    mode === 'voice' ? 'listening' : 'review',
  );
  // true pendant la configuration : on écoute pour TESTER le micro, rien n'est enregistré.
  const testRef = useRef(false);
  const [testing, setTesting] = useState(false);
  const [testHeard, setTestHeard] = useState('');
  const [engine, setEngine] = useState<VoiceEngine>(() => getPreferredEngine());
  const [status, setStatus] = useState<RecognizerStatus | null>(null);
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState('');
  const [heard, setHeard] = useState<ParsedCommand | null>(null);
  const [voiceError, setVoiceError] = useState<VoiceErrorKind | null>(null);
  const [errorCode, setErrorCode] = useState('');
  const [started, setStarted] = useState(false);

  const [kind, setKind] = useState<OperationKind>(initial?.kind ?? 'depense');
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amountCents) : '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [dateStr, setDateStr] = useState(originalStr ?? todayStr);
  const [label, setLabel] = useState(initial?.label ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const recognizer = useRef<VoiceRecognizer | null>(null);
  // Les rappels du moteur de reconnaissance ne doivent pas rester figés sur d'anciennes valeurs.
  const latest = useRef({ directSave, expenseOnly, onDirect });
  latest.current = { directSave, expenseOnly, onDirect };

  /** Utilise la meilleure variante proposée par le moteur : la première qui donne montant + catégorie. */
  const analyse = useCallback(
    (text: string, alternatives: string[]): ParsedCommand => {
      const all = [text, ...alternatives.filter((a) => a !== text)].map((t) => parseCommand(t, account));
      return all.find((p) => p.amountCents && p.categoryId) ?? all.find((p) => p.amountCents) ?? all[0];
    },
    [account],
  );

  const handleFinal = useCallback(
    async (text: string, alternatives: string[]) => {
      const p = analyse(text, alternatives);
      const forcedKind: OperationKind = latest.current.expenseOnly ? 'depense' : p.kind;
      const dayStr = ymdToStr(parisYMD(p.date));

      setHeard(p);
      setKind(forcedKind);
      setAmount(p.amountCents ? centsToInput(p.amountCents) : '');
      setCategoryId(p.categoryId ?? '');
      setDateStr(dayStr);
      setLabel(p.label);

      const cat = categories.find((c) => c.id === p.categoryId);
      const complete = Boolean(p.amountCents && cat && cat.kind === forcedKind && !(latest.current.expenseOnly && p.kind === 'recette') && dayStr <= todayStr);
      if (latest.current.directSave && latest.current.onDirect && complete && p.amountCents && cat) {
        setStep('review');
        setBusy(true);
        try {
          await latest.current.onDirect({ kind: forcedKind, amountCents: p.amountCents, categoryId: cat.id, label: p.label || cat.label, date: p.date });
          return;
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Une erreur est survenue.');
          setBusy(false);
        }
      }
      setStep('review');
    },
    [analyse, categories, todayStr],
  );

  const fail = useCallback((kind: VoiceErrorKind, code: string) => {
    setVoiceError(kind);
    setErrorCode(code);
    setStep('error');
  }, []);

  /** Lance l'écoute avec le moteur demandé (par défaut : le moteur préféré). */
  const startListening = useCallback(
    (forced?: VoiceEngine, test?: boolean) => {
      if (test !== undefined) testRef.current = test;
      setTesting(testRef.current);
      setInterim('');
      setHeard(null);
      setVoiceError(null);
      setStarted(false);
      setStatus(null);
      setLevel(0);
      setError(null);
      recognizer.current?.abort();

      if (!isMicAllowedContext()) {
        fail('insecure', window.isSecureContext ? 'no-mediaDevices' : 'insecure-context');
        return;
      }
      const chosen = forced ?? getPreferredEngine();
      setEngine(chosen);

      // Première utilisation de ce moteur : configuration unique (téléchargement si besoin + test du micro),
      // qui n'enregistre rien. Ensuite, le micro écoute directement.
      const needsDownloadConsent = chosen === 'ondevice' && !isOnDeviceModelCached() && !hasOnDeviceConsent();
      if (!testRef.current && (!isVoiceSetupDone(chosen) || needsDownloadConsent)) {
        setStep('setup');
        return;
      }

      setStep('listening');
      const r = createRecognizer(chosen);
      recognizer.current = r;
      r.start({
        onStart: () => setStarted(true),
        onStatus: setStatus,
        onLevel: setLevel,
        onInterim: setInterim,
        onFinal: (text, alts) => {
          if (testRef.current) {
            setTestHeard(text);
            setStep('setupHeard');
          } else {
            void handleFinal(text, alts);
          }
        },
        onError: fail,
      });
    },
    [handleFinal, fail],
  );

  /** Bascule vers l'autre moteur (et le mémorise). */
  const switchEngine = (next: VoiceEngine) => {
    setPreferredEngine(next);
    startListening(next);
  };

  /** Démarre la configuration : accord de téléchargement (moteur sur l'appareil), puis test du micro. */
  const startSetup = () => {
    if (engine === 'ondevice') {
      giveOnDeviceConsent();
      void requestPersistentStorage();
    }
    setPreferredEngine(engine);
    startListening(engine, true);
  };

  const finishSetup = () => {
    markVoiceSetupDone(engine);
    testRef.current = false;
    setTesting(false);
    setStep('setupDone');
  };

  // Démarre l'écoute dès l'ouverture en mode dictée.
  useEffect(() => {
    if (mode !== 'voice') return;
    const t = setTimeout(() => startListening(), 50);
    return () => {
      clearTimeout(t);
      recognizer.current?.abort();
    };
  }, []);

  // Chien de garde (moteur du navigateur) : s'il ne démarre pas l'écoute, on le dit au lieu de rester bloqué.
  useEffect(() => {
    if (step !== 'listening' || started || engine !== 'browser') return;
    const t = setTimeout(() => {
      recognizer.current?.abort();
      fail('unknown', 'le micro ne démarre pas (délai dépassé)');
    }, 6000);
    return () => clearTimeout(t);
  }, [step, started, engine, fail]);

  const close = useCallback(() => {
    recognizer.current?.abort();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const goManual = () => {
    recognizer.current?.abort();
    setStep('review');
  };

  const visibleCats: Category[] = categories.filter((c) => c.kind === kind);
  const effectiveCategory = visibleCats.some((c) => c.id === categoryId) ? categoryId : '';
  const cents = parseEurosToCents(amount);
  const futureDate = dateStr > todayStr;
  const valid = cents !== null && effectiveCategory !== '' && dateStr !== '' && !futureDate;

  /** Date ISO à enregistrer : on garde l'heure d'origine si la date n'a pas changé. */
  const toISO = (): string => {
    if (initial && dateStr === originalStr) return initial.date;
    if (dateStr === todayStr) return new Date().toISOString();
    const [y, m, d] = dateStr.split('-').map(Number);
    return makeDate(y, m, d).toISOString();
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur est survenue.');
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!valid) return;
    const cat = categories.find((c) => c.id === effectiveCategory)!;
    void run(() => onConfirm({ kind, amountCents: cents, categoryId: effectiveCategory, label: label.trim() || cat.label, date: toISO() }));
  };

  const title = mode === 'edit' ? "Modifier l'opération" : heard ? 'Vérifiez avant d’enregistrer' : 'Nouvelle opération';
  const missing: string[] = [];
  if (heard && !heard.amountCents) missing.push('le montant');
  if (heard && !heard.categoryId) missing.push('la catégorie');

  return (
    <div className="sheet-backdrop" onClick={close}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        {step === 'listening' && (
          <div className="listening">
            <div className="wave" aria-hidden="true">
              {Array.from({ length: 9 }).map((_, i) => (
                <span key={i} style={{ animationDelay: `${i * 0.09}s` }} />
              ))}
            </div>
            <p className="listening-title" aria-live="polite">
              {status?.phase === 'loading'
                ? `Chargement du moteur vocal… ${status.percent} %`
                : status?.phase === 'transcribing'
                  ? 'Transcription…'
                  : started
                    ? engine === 'ondevice'
                      ? 'Parlez maintenant…'
                      : 'Je vous écoute…'
                    : 'Démarrage du micro…'}
            </p>
            {status?.phase === 'loading' && (
              <>
                <div className="progress" role="progressbar" aria-valuenow={status.percent} aria-valuemin={0} aria-valuemax={100} style={{ width: '100%' }}>
                  <div className="progress-fill ok" style={{ width: `${status.percent}%` }} />
                </div>
                <p className="sim-note">
                  {isOnDeviceModelCached()
                    ? 'Chargement du moteur vocal depuis votre appareil (quelques secondes).'
                    : `Téléchargement unique du moteur vocal (≈ ${ONDEVICE_MODEL_MB} Mo). Ensuite, il reste sur votre appareil.`}
                </p>
                {isOnDeviceStorageVolatile() && (
                  <p className="hint-warn">
                    Votre navigateur ne conserve pas le moteur (mode privé ou nettoyage automatique) : il sera retéléchargé à chaque fois. Désactivez le
                    nettoyage des données du site pour éviter cela.
                  </p>
                )}
              </>
            )}
            {engine === 'ondevice' && started && status?.phase !== 'transcribing' && (
              <div className="meter" aria-label="Niveau du micro">
                <span style={{ width: `${Math.min(100, Math.round(level * 700))}%` }} />
              </div>
            )}
            {status?.phase !== 'loading' && (
              <p className="phrase" aria-live="polite">
                {interim ? (
                  <>« {interim} »</>
                ) : testing ? (
                  <span className="muted small">
                    Test du micro : dites par exemple « {hint} ». <b>Rien ne sera enregistré.</b>
                  </span>
                ) : (
                  <span className="muted small">Parlez, puis marquez une courte pause (ou appuyez sur Terminer).</span>
                )}
              </p>
            )}
            <div className="listening-actions">
              <button className="btn btn-primary" disabled={!started} onClick={() => recognizer.current?.stop()}>
                <Icon name="check" size={18} /> Terminer
              </button>
              <button className="btn btn-ghost" onClick={goManual}>
                <Icon name="edit" size={18} /> Saisir à la main
              </button>
            </div>
            {onDirectSaveChange && !testing && (
              <label className="switch">
                <input type="checkbox" checked={Boolean(directSave)} onChange={(e) => onDirectSaveChange(e.target.checked)} />
                <span>Enregistrement direct, sans confirmation</span>
              </label>
            )}
            {engine === 'browser' ? (
              <button className="link" onClick={() => switchEngine('ondevice')}>
                Utiliser la dictée sur l'appareil
              </button>
            ) : (
              isBrowserEngineAvailable() && (
                <button className="link" onClick={() => switchEngine('browser')}>
                  Utiliser la dictée du navigateur (plus rapide)
                </button>
              )
            )}
          </div>
        )}

        {/* Configuration unique : téléchargement (moteur sur l'appareil) + test du micro. Rien n'est enregistré. */}
        {step === 'setup' && (
          <div className="listening">
            <p className="listening-title">Configuration de la dictée</p>
            <p className="phrase small">
              Une seule fois : un <b>test du micro</b>
              {engine === 'ondevice' && !isOnDeviceModelCached() ? ' et le téléchargement du moteur vocal' : ''}. <b>Rien ne sera enregistré</b> pendant ce
              test. Ensuite, le micro écoutera directement, sans rien redemander.
            </p>
            {engine === 'ondevice' ? (
              <p className="sim-note">
                {isOnDeviceModelCached()
                  ? 'Le moteur vocal est déjà sur votre appareil : votre voix est transcrite localement, le son n’est envoyé à personne.'
                  : `Votre voix est transcrite directement sur votre appareil : le son n’est envoyé à personne. Le moteur (≈ ${ONDEVICE_MODEL_MB} Mo) se télécharge une seule fois : mieux vaut être en Wi-Fi.`}
              </p>
            ) : (
              <p className="sim-note">Ce navigateur transcrit votre voix via un service en ligne (Google, Microsoft ou Apple).</p>
            )}
            <div className="listening-actions">
              <button className="btn btn-primary" onClick={startSetup}>
                {engine === 'ondevice' && !isOnDeviceModelCached() ? 'Télécharger et tester le micro' : 'Tester le micro'}
              </button>
              <button className="btn btn-ghost" onClick={goManual}>
                <Icon name="edit" size={18} /> Saisie manuelle
              </button>
            </div>
          </div>
        )}

        {step === 'setupHeard' && (
          <div className="listening">
            <p className="listening-title">Test du micro</p>
            <p className="phrase">« {testHeard} »</p>
            <p className="sim-note">
              {(() => {
                const p = analyse(testHeard, []);
                const cat = categories.find((c) => c.id === p.categoryId);
                return p.amountCents
                  ? `Compris : ${formatEuros(p.amountCents)}${cat ? ` · ${cat.label}` : ''}. Le micro fonctionne.`
                  : 'Le micro fonctionne. (Pour ce test, dites par exemple « J’ai dépensé 50 euros de carburant ».)';
              })()}
            </p>
            <div className="listening-actions">
              <button className="btn btn-primary" onClick={finishSetup}>
                <Icon name="check" size={18} /> Terminer la configuration
              </button>
              <button className="btn btn-ghost" onClick={() => startListening(engine, true)}>
                Refaire le test
              </button>
            </div>
          </div>
        )}

        {step === 'setupDone' && (
          <div className="listening">
            <p className="listening-title">Dictée prête</p>
            <p className="phrase small">
              La configuration est terminée : elle ne vous sera plus demandée. Appuyez sur le micro pour dicter une opération.
            </p>
            <div className="listening-actions">
              <button className="btn btn-primary" onClick={() => startListening(engine, false)}>
                Dicter une opération
              </button>
              <button className="btn btn-ghost" onClick={goManual}>
                <Icon name="edit" size={18} /> Saisie manuelle
              </button>
            </div>
          </div>
        )}

        {step === 'error' && voiceError && (
          <div className="listening">
            <p className="listening-title">Dictée interrompue</p>
            <p className="form-error">{VOICE_ERROR_MESSAGES[voiceError]}</p>
            <p className="sim-note">Code technique : {errorCode || voiceError}</p>
            <div className="listening-actions">
              {engine === 'browser' && voiceError !== 'permission' && voiceError !== 'insecure' && voiceError !== 'audio' && voiceError !== 'no-speech' && (
                <button className="btn btn-primary" onClick={() => switchEngine('ondevice')}>
                  Dictée sur l'appareil
                </button>
              )}
              {voiceError !== 'insecure' && voiceError !== 'unsupported' && (
                <button className={engine === 'browser' && voiceError !== 'no-speech' && voiceError !== 'permission' && voiceError !== 'audio' ? 'btn btn-ghost' : 'btn btn-primary'} onClick={() => startListening()}>
                  Réessayer
                </button>
              )}
              <button className="btn btn-ghost" onClick={goManual}>
                <Icon name="edit" size={18} /> Saisie manuelle
              </button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="review">
            <h3>{title}</h3>
            {heard && (
              <p className="phrase small">
                Entendu : « {heard.transcript} »{' '}
                {mode === 'voice' && (
                  <button className="link" onClick={() => startListening()}>
                    Redire
                  </button>
                )}
              </p>
            )}
            {missing.length > 0 && <p className="hint-warn">Je n'ai pas compris {missing.join(' ni ')} : complétez ci-dessous.</p>}

            {!expenseOnly && (
              <div className="segmented kind">
                <button className={kind === 'depense' ? 'on neg-on' : ''} onClick={() => setKind('depense')}>
                  Dépense
                </button>
                <button className={kind === 'recette' ? 'on pos-on' : ''} onClick={() => setKind('recette')}>
                  {account === 'professionnel' ? 'Encaissement' : 'Recette'}
                </button>
              </div>
            )}

            <label className="field">
              <span>Montant</span>
              <div className="amount-input">
                <input
                  inputMode="decimal"
                  placeholder="0,00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus={mode === 'manual' || (heard !== null && !heard.amountCents)}
                />
                <i>€</i>
              </div>
            </label>

            <label className="field">
              <span>Catégorie</span>
              <select value={effectiveCategory} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="" disabled>
                  Choisir une catégorie
                </option>
                {visibleCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="field">
              <span>Date</span>
              <div className="date-row">
                <div className="segmented">
                  <button className={dateStr === todayStr ? 'on' : ''} onClick={() => setDateStr(todayStr)}>
                    Aujourd'hui
                  </button>
                  <button className={dateStr === yesterdayStr ? 'on' : ''} onClick={() => setDateStr(yesterdayStr)}>
                    Hier
                  </button>
                </div>
                <input type="date" value={dateStr} max={todayStr} onChange={(e) => setDateStr(e.target.value)} aria-label="Date de l'opération" />
              </div>
              {futureDate && <small className="neg">La date ne peut pas être dans le futur.</small>}
            </div>

            <label className="field">
              <span>Libellé (facultatif)</span>
              <input placeholder="Ex. Plein Total" value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>

            {error && <p className="form-error">{error}</p>}

            <div className="actions">
              {mode === 'edit' && onDelete ? (
                confirmDelete ? (
                  <button className="btn btn-danger" disabled={busy} onClick={() => void run(onDelete)}>
                    Confirmer la suppression
                  </button>
                ) : (
                  <button className="btn btn-ghost danger-text" disabled={busy} onClick={() => setConfirmDelete(true)}>
                    Supprimer
                  </button>
                )
              ) : (
                <button className="btn btn-ghost" onClick={close}>
                  Annuler
                </button>
              )}
              <button className="btn btn-primary" disabled={!valid || busy} onClick={confirm}>
                <Icon name="check" size={18} />
                {busy ? 'Enregistrement…' : `Enregistrer${cents ? ` ${kind === 'depense' ? '−' : '+'}${formatEuros(cents)}` : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
