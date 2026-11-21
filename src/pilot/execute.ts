import type { AccountType, Category, Invoice, Operation, Recurring } from '../types';
import type { Alert, Forecast } from '../lib/forecast';
import { answerAlerts, answerBalance, answerBudget, answerForecast, answerMonthly, answerSpent, answerUpcoming } from '../lib/answers';
import type { MonthlyBudget } from '../lib/monthly';
import { formatEuros } from '../lib/money';
import { normalize } from '../voice/parseCommand';
import type { Intent, InvoiceVoiceDraft, NavTarget } from '../voice/intents';

/** Exécute une commande Pilot : répond aux questions, navigue, ou prépare l'action (avec confirmation si elle est risquée). */

/** Résultat d'une action faite tout de suite : la phrase, et de quoi l'annuler pendant quelques secondes. */
export interface AutoResult {
  say: string;
  /** Version courte lue à voix haute (« C'est fait. ») ; le texte complet reste affiché. */
  spoken?: string;
  undo?: () => Promise<string>;
}

export interface PilotReply {
  /** Phrase affichée et lue à voix haute. */
  say: string;
  /** Action risquée : en attente d'un « oui » (voix ou bouton). `run` renvoie la phrase de résultat. */
  confirm?: { run: () => Promise<string> };
  /** Une fenêtre s'est ouverte à la place d'une réponse : rien à afficher. */
  silent?: boolean;
  /** Action sans confirmation, exécutée tout de suite ; renvoie la phrase de résultat (ou lève l'erreur à afficher). */
  auto?: () => Promise<string | AutoResult>;
}

export interface PilotEnv {
  account: AccountType;
  isEmployee: boolean;
  /** Identifiants des onglets disponibles pour ce compte. */
  navIds: string[];
  today: string;
  ops: Operation[];
  balanceCents: number;
  forecast: Forecast;
  alerts: Alert[];
  budgets: Map<string, number>;
  /** Budget du mois calculé (revenus − charges fixes). */
  monthly: MonthlyBudget;
  recurrings: Recurring[];
  invoices: Invoice[];
  categories: Category[];
  act: {
    navigate: (id: string) => void;
    editOp: (op: Operation) => void;
    deleteOp: (id: string) => Promise<void>;
    openInvoice: (draft: InvoiceVoiceDraft) => void;
    settleInvoice: (inv: Invoice) => Promise<void>;
    setRecurringActive: (id: string, active: boolean) => Promise<void>;
    removeRecurring: (id: string) => Promise<void>;
    openOpening: (cents: number | null) => void;
    setDirectSave: (on: boolean) => void;
  };
}

const eur = (c: number) => formatEuros(c);

const NAV_LABEL: Record<NavTarget, string> = {
  home: "l'accueil",
  month: 'le mois',
  categories: 'les catégories',
  recurring: 'les récurrences',
  invoices: 'les factures',
  flows: 'les flux',
  team: "l'équipe",
  matrix: 'la matrice',
  all: 'vos frais',
};

export const HELP_TEXT =
  "Je peux enregistrer une dépense (« j'ai dépensé 50 euros de carburant »), créer une récurrence (« tous les mois le 2 loyer 750 euros ») ou un budget (« budget alimentation 400 euros »), répondre (« quel est mon solde », « combien j'ai dépensé en courses ce mois-ci », « qu'est-ce qui tombe cette semaine »), ouvrir un écran (« ouvre les catégories »), annuler (« supprime la dernière opération ») et gérer vos factures et récurrences.";

/** Retrouve l'élément dont le nom apparaît dans la demande (« mets en pause le loyer » -> Loyer). */
function bestMatch<T>(query: string, items: T[], label: (x: T) => string): { found: T[]; score: number } {
  const q = new Set(normalize(query).split(' ').filter((w) => w.length >= 3));
  if (q.size === 0) return { found: [], score: 0 };
  let best = 0;
  let found: T[] = [];
  for (const item of items) {
    const words = normalize(label(item)).split(' ').filter((w) => w.length >= 3);
    const score = words.filter((w) => q.has(w)).length;
    if (score > best) {
      best = score;
      found = [item];
    } else if (score === best && score > 0) found.push(item);
  }
  return { found, score: best };
}

const describeOp = (o: Operation) => `${o.kind === 'depense' ? 'moins' : 'plus'} ${eur(o.amountCents)}, ${o.label || 'sans libellé'}`;

const NOT_FOR_EMPLOYEE = "Cette commande n'est pas disponible avec votre profil.";

export function runIntent(intent: Intent, env: PilotEnv): PilotReply {
  const { act } = env;
  const professional = env.account === 'professionnel';
  const catById = (id: string | null) => env.categories.find((c) => c.id === id);

  if (env.isEmployee && !['help', 'navigate', 'ask_spent', 'last_op', 'direct_save'].includes(intent.type)) return { say: NOT_FOR_EMPLOYEE };

  switch (intent.type) {
    case 'help':
      return { say: HELP_TEXT };

    case 'navigate': {
      let id: string = intent.target;
      if (!env.navIds.includes(id)) {
        if (professional && intent.target === 'recurring' && env.navIds.includes('invoices')) {
          act.navigate('invoices');
          return { say: "Les récurrences sont dans l'onglet Factures, rubrique Récurrents." };
        }
        return { say: env.isEmployee ? NOT_FOR_EMPLOYEE : `Il n'y a pas d'écran « ${NAV_LABEL[intent.target].replace(/^(le |la |les |l')/, '')} » sur ce compte.` };
      }
      act.navigate(id);
      id = NAV_LABEL[intent.target];
      return { say: `J'ouvre ${id}.` };
    }

    case 'ask_balance':
      return { say: answerBalance(env.balanceCents, env.forecast) };

    case 'ask_spent':
      return { say: answerSpent(env.ops, intent.kind, intent.period, env.today, catById(intent.categoryId), professional) };

    case 'ask_forecast':
      return { say: answerForecast(env.forecast, intent.days) };

    case 'ask_upcoming':
      return { say: answerUpcoming(env.forecast.events, env.today, intent.days) };

    case 'ask_budget':
      if (professional) return { say: "Les budgets par catégorie existent pour le compte particulier." };
      if (!intent.categoryId) return { say: answerMonthly(env.monthly) };
      return { say: answerBudget(env.budgets, env.ops, env.today, env.categories, catById(intent.categoryId)) };

    case 'ask_alerts':
      return { say: answerAlerts(env.alerts) };

    case 'direct_save':
      act.setDirectSave(intent.on);
      return { say: intent.on ? "Enregistrement direct activé : une phrase complète est enregistrée tout de suite, avec un bouton Annuler." : 'Enregistrement direct désactivé : vous validerez chaque opération.' };

    case 'opening':
      act.openOpening(intent.amountCents);
      return { say: '', silent: true };

    case 'last_op': {
      const op = env.ops[0];
      if (!op) return { say: "Il n'y a aucune opération." };
      if (intent.action === 'edit') {
        act.editOp(op);
        return { say: '', silent: true };
      }
      return {
        say: `Supprimer la dernière opération : ${describeOp(op)} ? Dites oui ou non.`,
        confirm: {
          run: async () => {
            await act.deleteOp(op.id);
            return 'Opération supprimée.';
          },
        },
      };
    }

    case 'invoice_new':
      act.openInvoice(intent.draft);
      return { say: '', silent: true };

    case 'invoice_settle': {
      const pool = env.invoices.filter((i) => i.status === 'en_attente' && (!intent.direction || i.direction === intent.direction));
      const { found } = bestMatch(intent.query, pool, (i) => `${i.counterparty} ${i.label}`);
      if (found.length === 0) return { say: intent.query ? `Je n'ai pas trouvé de facture en attente pour « ${intent.query} ».` : 'Quelle facture ? Dites par exemple : marque la facture Dupont payée.' };
      if (found.length > 1) return { say: `Plusieurs factures correspondent : ${found.map((i) => i.counterparty).join(', ')}. Précisez le nom.` };
      const inv = found[0];
      const incoming = inv.direction === 'a_encaisser';
      return {
        say: `Marquer ${incoming ? 'encaissée' : 'payée'} la facture ${inv.counterparty}, ${eur(inv.amountCents)} ? Dites oui ou non.`,
        confirm: {
          run: async () => {
            await act.settleInvoice(inv);
            return incoming ? 'Encaissement enregistré.' : 'Paiement enregistré.';
          },
        },
      };
    }

    case 'recurring': {
      const wantActive = intent.action === 'resume';
      const pool = intent.action === 'delete' ? env.recurrings : env.recurrings.filter((r) => r.active !== wantActive);
      const { found } = bestMatch(intent.query, pool.length ? pool : env.recurrings, (r) => r.label);
      if (found.length === 0) return { say: intent.query ? `Je n'ai pas trouvé de récurrence « ${intent.query} ».` : 'Quelle récurrence ? Dites par exemple : mets en pause le loyer.' };
      if (found.length > 1) return { say: `Plusieurs récurrences correspondent : ${found.map((r) => r.label).join(', ')}. Précisez le nom.` };
      const rec = found[0];
      if (intent.action === 'delete') {
        return {
          say: `Supprimer la récurrence ${rec.label}, ${eur(rec.amountCents)} le ${rec.dayOfMonth} ? Dites oui ou non.`,
          confirm: {
            run: async () => {
              await act.removeRecurring(rec.id);
              return `Récurrence ${rec.label} supprimée.`;
            },
          },
        };
      }
      return {
        say: 'Un instant…',
        auto: async () => {
          await act.setRecurringActive(rec.id, wantActive);
          return wantActive ? `Récurrence ${rec.label} reprise.` : `Récurrence ${rec.label} mise en pause.`;
        },
      };
    }
  }
}
