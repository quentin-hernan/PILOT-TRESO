import { useEffect, useState } from 'react';
import type { Category } from '../types';
import { addDaysKey, todayKey } from '../lib/forecast';
import { parseEurosToCents } from '../lib/money';
import { categoryChoices, describe, missingSlots, QUESTIONS, type Candidate, type SlotKey } from '../pilot/missing';
import type { PilotApi } from '../pilot/usePilot';
import { HELP_TEXT } from '../pilot/execute';
import {
  ONDEVICE_MODEL_MB,
  downloadOnDeviceModel,
  giveOnDeviceConsent,
  isMicAllowedContext,
  isOnDeviceModelCached,
  requestPersistentStorage,
} from '../voice/recognizer';
import { Icon } from './Icon';

const STATE_LABEL: Record<PilotApi['state'], string> = {
  off: 'Pilot désactivé',
  starting: 'Démarrage de l’écoute…',
  listening: 'À l’écoute — dites « Dis Pilot »',
  busy: 'Pilot réfléchit…',
  paused: 'En pause (fenêtre ouverte ou réponse en cours)',
  error: 'Pilot arrêté',
};

/** Bouton de l'en-tête : état de Pilot en un coup d'œil, ouvre les réglages. */
export function PilotPill({ pilot, onOpen }: { pilot: PilotApi; onOpen: () => void }) {
  return (
    <button className={`pilot-pill ${pilot.state}`} onClick={onOpen} aria-label={`Pilot : ${STATE_LABEL[pilot.state]}`} title={STATE_LABEL[pilot.state]}>
      <span className="pilot-dot" style={pilot.state === 'listening' ? { transform: `scale(${1 + pilot.level * 0.12})` } : undefined} />
      Pilot
    </button>
  );
}

/** Barre de Pilot en bas de l'écran : micro ouvert dès « Dis Pilot », ce qui est compris, puis la réponse. */
export function PilotPanelCard({ pilot }: { pilot: PilotApi }) {
  const p = pilot.panel;
  if (!p) return null;
  const phase = p.phase ?? 'result';
  return (
    <div className={`pilot-panel phase-${phase}`} role="status" aria-live="polite">
      {phase === 'listening' ? (
        <div className="pilot-listen">
          <span className="pilot-mic" aria-hidden="true">
            <Icon name="mic" size={18} />
          </span>
          <span className="pilot-bars" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} style={{ height: `${6 + (pilot.level >= i ? 8 + pilot.level * 4 : 0)}px` }} />
            ))}
          </span>
          <span className="pilot-listen-text">
            <strong>Je vous écoute…</strong>
            {p.interim && <small>« {p.interim} »</small>}
          </span>
          {pilot.talking && (
            <button className="btn btn-ghost btn-small" onClick={pilot.stopTalking}>
              Terminer
            </button>
          )}
        </div>
      ) : (
        <div className="pilot-panel-body">
          {p.heard && <small className="muted">« {p.heard} »</small>}
          {phase === 'thinking' ? (
            <span className="pilot-dots" aria-label="Pilot traite votre demande">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <strong>{p.say}</strong>
          )}
          {p.offer && (
            <div className="pilot-actions">
              <button className="btn btn-primary btn-small" onClick={() => pilot.acceptOffer()}>
                <Icon name="repeat" size={14} /> {p.offer}
              </button>
              <small className="muted">ou dites « répète »</small>
            </div>
          )}
          {p.undoable && (
            <div className="pilot-actions">
              <button className="btn btn-ghost btn-small" onClick={() => pilot.undo()}>
                Annuler
              </button>
              <small className="muted">ou dites « annule »</small>
            </div>
          )}
          {p.pending && (
            <div className="pilot-actions">
              <button className="btn btn-primary btn-small" onClick={() => pilot.confirm(true)}>
                <Icon name="check" size={14} /> Oui
              </button>
              <button className="btn btn-ghost btn-small" onClick={() => pilot.confirm(false)}>
                Non
              </button>
              <small className="muted">ou dites « oui » / « non »</small>
            </div>
          )}
        </div>
      )}
      <button className="pilot-close" onClick={pilot.dismiss} aria-label="Fermer">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

/**
 * Informations manquantes : au milieu de l'écran, seulement ce qui manque (jamais le formulaire complet).
 * Réponse à voix haute (sans « Dis Pilot ») ou au toucher ; dès que tout est là, l'ajout se fait tout seul.
 */
export function PilotDialog({
  candidate,
  categories,
  onField,
  onCancel,
  status,
  level,
  lastHeard,
}: {
  candidate: Candidate;
  categories: Category[];
  onField: (key: SlotKey, value: string | number) => void;
  onCancel: () => void;
  /** État du micro : Pilot parle (sourdine), traite votre réponse, ou vous écoute. */
  status: 'speaking' | 'busy' | 'listening';
  level: number;
  /** Dernière réponse entendue, et si elle a été comprise. */
  lastHeard: { text: string; ok: boolean } | null;
}) {
  const slots = missingSlots(candidate);
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('');
  const [name, setName] = useState('');
  const [due, setDue] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submitAmount = () => {
    const c = parseEurosToCents(amount);
    if (c) {
      onField('amount', c);
      setAmount('');
    }
  };
  const submitDay = () => {
    const d = Number(day);
    if (Number.isInteger(d) && d >= 1 && d <= 31) {
      onField('day', d);
      setDay('');
    }
  };
  const quickDue = (n: number) => onField('dueDate', addDaysKey(todayKey(), n));
  const first = slots[0];

  return (
    <div className="pilot-dialog-backdrop" onClick={onCancel}>
      <div className="pilot-dialog" role="dialog" aria-modal="true" aria-label="Informations manquantes" onClick={(e) => e.stopPropagation()}>
        <small className="muted">« {candidate.heard} »</small>
        <p className="pilot-summary">{describe(candidate, categories)}</p>
        <div className={`pilot-status ${status}`} aria-live="polite">
          <span className="pilot-bars" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} style={{ height: `${6 + (status === 'listening' && level >= i ? 6 + level * 3 : 0)}px` }} />
            ))}
          </span>
          {status === 'speaking' ? 'Pilot parle… répondez juste après' : status === 'busy' ? 'J’analyse votre réponse…' : 'Je vous écoute : répondez maintenant'}
        </div>
        {lastHeard && (
          <p className={lastHeard.ok ? 'hint-ok' : 'hint-warn'}>
            J’ai entendu : « {lastHeard.text} »{lastHeard.ok ? ' — compris.' : ' — je n’ai pas compris. Redites-le ou touchez la réponse.'}
          </p>
        )}
        {candidate.kind === 'budget' && candidate.note && <p className="hint-warn">{candidate.note}</p>}

        {slots.map((slot) => (
          <div className="pilot-slot" key={slot}>
            <strong>{QUESTIONS[slot](candidate)}</strong>
            {slot === 'category' && (
              <div className="pilot-chips">
                {categoryChoices(candidate, categories).map((c) => (
                  <button key={c.id} className="chip" onClick={() => onField('category', c.id)}>
                    <Icon name={c.icon} size={14} /> {c.label}
                  </button>
                ))}
              </div>
            )}
            {slot === 'amount' && (
              <div className="pilot-try">
                <div className="amount-input">
                  <input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={amount}
                    autoFocus={first === 'amount'}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitAmount()}
                  />
                  <i>€</i>
                </div>
                <button className="btn btn-primary btn-small" disabled={!parseEurosToCents(amount)} onClick={submitAmount}>
                  OK
                </button>
              </div>
            )}
            {slot === 'day' && (
              <div className="pilot-try">
                <input
                  inputMode="numeric"
                  placeholder="1 à 31"
                  value={day}
                  autoFocus={first === 'day'}
                  onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  onKeyDown={(e) => e.key === 'Enter' && submitDay()}
                />
                <button className="btn btn-primary btn-small" disabled={!day} onClick={submitDay}>
                  OK
                </button>
              </div>
            )}
            {slot === 'counterparty' && (
              <div className="pilot-try">
                <input
                  placeholder="Nom"
                  value={name}
                  autoFocus={first === 'counterparty'}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && name.trim() && onField('counterparty', name.trim())}
                />
                <button className="btn btn-primary btn-small" disabled={!name.trim()} onClick={() => onField('counterparty', name.trim())}>
                  OK
                </button>
              </div>
            )}
            {slot === 'dueDate' && (
              <>
                <div className="pilot-chips">
                  <button className="chip" onClick={() => quickDue(0)}>
                    Aujourd'hui
                  </button>
                  <button className="chip" onClick={() => quickDue(7)}>
                    Dans 7 jours
                  </button>
                  <button className="chip" onClick={() => quickDue(30)}>
                    Dans 30 jours
                  </button>
                </div>
                <div className="pilot-try">
                  <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                  <button className="btn btn-primary btn-small" disabled={!due} onClick={() => onField('dueDate', due)}>
                    OK
                  </button>
                </div>
              </>
            )}
          </div>
        ))}

        <div className="pilot-dialog-foot">
          <small className="muted">Vous pouvez aussi répondre à voix haute, sans « Dis Pilot ».</small>
          <button className="btn btn-ghost btn-small" onClick={onCancel}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

/** Réglages de Pilot : activation (avec téléchargement du moteur si besoin), réponses vocales, exemples. */
export function PilotSheet({ pilot, onClose }: { pilot: PilotApi; onClose: () => void }) {
  const [cached, setCached] = useState(isOnDeviceModelCached());
  const [percent, setPercent] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const secure = isMicAllowedContext();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const downloadAndEnable = async () => {
    setDownloadError(null);
    setPercent(0);
    try {
      giveOnDeviceConsent();
      void requestPersistentStorage();
      await downloadOnDeviceModel(setPercent);
      setCached(true);
      pilot.setEnabled(true);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'Téléchargement impossible. Vérifiez votre connexion.');
    } finally {
      setPercent(null);
    }
  };

  const tryText = () => {
    if (!text.trim()) return;
    pilot.hear(`Dis Pilot, ${text.trim()}`);
    setText('');
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Pilot" onClick={(e) => e.stopPropagation()}>
        <div className="review">
          <h3>Pilot — commande vocale mains libres</h3>
          <p className="sim-note">
            Dites « Dis Pilot » puis votre demande, en une phrase : « Dis Pilot, j’ai dépensé 50 euros de carburant ». Pilot ne réagit qu’à « Dis Pilot ».
            Un bip confirme qu’il vous écoute, ce que vous dites s’affiche, puis l’ajout est fait tout de suite (« ding » et bouton Annuler). S’il manque une
            information, la fenêtre s’ouvre pour la compléter. Vous pouvez aussi dire « Dis Pilot », attendre le bip, puis votre demande.
          </p>

          {!secure && <p className="form-error">Le micro est bloqué sur cette page (adresse non sécurisée). Utilisez l’adresse https:// du site.</p>}

          {pilot.browserAvailable && (
            <div className="field">
              <span>Moteur de l’écoute permanente</span>
              <select value={pilot.listenEngine} onChange={(e) => pilot.setListenEngine(e.target.value as 'ondevice' | 'browser')}>
                <option value="ondevice">Sur l’appareil — privé (plus lent, surtout sur téléphone)</option>
                <option value="browser">Navigateur — rapide (le son passe par Google ou Apple)</option>
              </select>
              <small className="muted">
                {pilot.listenEngine === 'browser'
                  ? 'Rapide et précis : « Dis Pilot » est reconnu pendant que vous parlez. Tout ce qui est dit pendant que l’écoute est active est envoyé à Google (Chrome, Android) ou Apple (Safari) pour être transcrit. Sur Android, un petit bip peut accompagner chaque relance.'
                  : 'Le son reste sur l’appareil.'}
                {pilot.weakDevice && pilot.listenEngine === 'ondevice' && ' Sur téléphone, ce mode est lent : le bouton micro en bas de l’écran reste le plus rapide.'}
              </small>
            </div>
          )}

          {secure && !cached && pilot.listenEngine === 'ondevice' && (
            <>
              <p className="sim-note">
                Pour écouter en continu sans envoyer votre voix à personne, Pilot utilise le moteur vocal <b>sur l’appareil</b> : téléchargement unique d’environ{' '}
                {ONDEVICE_MODEL_MB} Mo, puis plus rien à télécharger.
              </p>
              <button className="btn btn-primary" disabled={percent !== null} onClick={() => void downloadAndEnable()}>
                {percent !== null ? `Téléchargement… ${percent} %` : `Télécharger le moteur et activer Pilot`}
              </button>
              {downloadError && <p className="form-error">{downloadError}</p>}
            </>
          )}

          {secure && (cached || pilot.listenEngine === 'browser') && (
            <label className="switch">
              <input type="checkbox" checked={pilot.enabled} onChange={(e) => pilot.setEnabled(e.target.checked)} />
              <span>Écoute permanente « Dis Pilot »</span>
            </label>
          )}
          {pilot.enabled && <p className="muted small">{STATE_LABEL[pilot.state]}</p>}
          {pilot.error && <p className="form-error">{pilot.error}</p>}

          <label className="switch">
            <input type="checkbox" checked={pilot.sounds} onChange={(e) => pilot.setSounds(e.target.checked)} />
            <span>Sons (bip quand Pilot vous entend, « ding » quand un ajout est fait)</span>
          </label>

          <label className="switch">
            <input type="checkbox" checked={pilot.speakReplies} onChange={(e) => pilot.setSpeakReplies(e.target.checked)} />
            <span>Réponses à voix haute</span>
          </label>

          {pilot.speakReplies && (
            <div className="field">
              <span>Voix de Pilot</span>
              <div className="pilot-try">
                <select value={pilot.voiceUri ?? ''} onChange={(e) => pilot.setVoiceUri(e.target.value || null)}>
                  <option value="">Automatique (voix masculine naturelle)</option>
                  {pilot.voices.map((v) => (
                    <option key={v.voice.voiceURI} value={v.voice.voiceURI}>
                      {v.label}
                      {v.male ? ' · masculine' : ''}
                      {v.natural ? ' · naturelle' : ''}
                    </option>
                  ))}
                </select>
                <button className="btn btn-ghost btn-small" onClick={pilot.sample}>
                  Écouter
                </button>
              </div>
              <small className="muted">
                {pilot.voices.length === 0
                  ? 'Aucune voix française détectée sur cet appareil.'
                  : 'Les voix proposées sont celles de votre appareil. Les plus naturelles : Windows/Edge, voix « Natural » (ex. Henri) ; iPhone, Réglages > Accessibilité > Contenu énoncé > Voix (ex. Thomas) ; Android, Réglages > Synthèse vocale.'}
              </small>
            </div>
          )}

          <p className="sim-note">
            <b>À savoir :</b> l’application doit rester ouverte et l’écran allumé (les navigateurs coupent le micro en veille). Le son est transcrit sur
            l’appareil, jamais envoyé ni conservé ; Pilot ne retient rien de ce qu’il entend. L’écoute permanente consomme de la batterie : désactivez-la quand vous n’en avez pas besoin. Sans elle, appuyez simplement sur le micro en bas de l’écran : Pilot écoute une commande tout de suite, avec les mêmes pouvoirs.
          </p>

          <label className="field">
            <span>Essayer une commande sans micro</span>
            <div className="pilot-try">
              <input placeholder="Ex. quel est mon solde" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && tryText()} />
              <button className="btn btn-ghost btn-small" disabled={!text.trim()} onClick={tryText}>
                Envoyer
              </button>
            </div>
          </label>

          <details className="pilot-help">
            <summary>Ce que Pilot sait faire</summary>
            <p>{HELP_TEXT}</p>
          </details>

          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
